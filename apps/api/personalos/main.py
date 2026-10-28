"""HTTP boundary: authenticate, validate, delegate and serialize."""
import hashlib
import json
import logging
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from personalos.config import get_settings
from personalos.db import get_db, utcnow
from personalos.models import AuthSession, Automation, Execution, Message, Record, User
from personalos.schemas import (ApprovalInput, AutomationInput, ChatInput, Credentials, EventInput,
                               IntegrationInput, MemoryInput, SettingsInput, TaskInput)
from personalos.security import (COOKIE_NAME, current_user, decrypt_config, encrypt_config,
                                new_session, password_hasher)
from personalos.services.agent import durable_graph_resources, generate_briefing, initialize_graph_storage, model_config, stream_agent
from personalos.services.automations import create_automation
from personalos.services.accounts import account_lease, assert_account_writable
from personalos.services.calendar import ensure_google_no_conflict, get_google_event, list_google_events, oauth_complete, oauth_start
from personalos.services.memory import MemoryService
from personalos.services.network import validate_public_url
from personalos.services.records import (audit, cas_update, create_record, ensure_no_conflict,
                                        list_records, owned, patch_record, serialize)
from personalos.services.tools import execute_approval, mcp_tools, request_approval

logger = logging.getLogger(__name__)
@asynccontextmanager
async def lifespan(app):
    await initialize_graph_storage()
    yield


app = FastAPI(lifespan=lifespan, title="PersonalOS API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
DB = Annotated[Session, Depends(get_db)]
Viewer = Annotated[User, Depends(current_user)]


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    # Browser mutations must originate from our UI; server/CLI clients without Origin still authenticate.
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in {get_settings().web_origin.rstrip("/"), get_settings().app_url.rstrip("/")}:
            return Response(content='{"detail":"Cross-origin mutation refused"}', status_code=403, media_type="application/json")
    return await call_next(request)


@app.exception_handler(ValidationError)
async def validation_error(request: Request, exc: ValidationError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": json.loads(exc.json(include_url=False))})


@app.get("/api/health")
def health(db: DB):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "service": "personalos-api"}


def public_user(user: User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "version": user.version}


async def rate_auth(request: Request):
    from redis.asyncio import Redis
    client = Redis.from_url(get_settings().redis_url, socket_connect_timeout=2, socket_timeout=2)
    key = "auth_rate:" + hashlib.sha256((request.client.host if request.client else "unknown").encode()).hexdigest()
    try:
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, 60)
        if count > 30:
            raise HTTPException(429, "Too many authentication attempts. Try again in one minute")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("auth_rate_limiter_unavailable error_type=%s", type(exc).__name__)
        raise HTTPException(503, "Authentication rate limiter is unavailable") from exc
    finally:
        await client.aclose()


@app.post("/api/auth/register", status_code=201)
async def register(payload: Credentials, response: Response, request: Request, db: DB):
    await rate_auth(request)
    user = User(email=str(payload.email).lower(), name=payload.name,
                password_hash=password_hasher.hash(payload.password), preferences={"memory_enabled": True})
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "An account with this email already exists") from exc
    new_session(db, user, response)
    return public_user(user)


@app.post("/api/auth/login")
async def login(payload: Credentials, response: Response, request: Request, db: DB):
    await rate_auth(request)
    user = db.scalar(select(User).where(User.email == str(payload.email).lower(), User.deleted_at.is_(None)))
    # A dummy hash equalizes the expensive part of unknown-user and wrong-password paths.
    dummy = "$argon2id$v=19$m=65536,t=3,p=4$YXJiaXRyYXJ5c2FsdDEyMw$knMTF6ZQWnG0B+u5cykWZQdeEEd4W0eWJgYkHnS3IWM"
    try:
        valid = password_hasher.verify(payload.password, user.password_hash if user else dummy)
    except Exception:
        valid = False
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect")
    new_session(db, user, response)
    return public_user(user)


@app.get("/api/auth/me")
def me(user: Viewer):
    return public_user(user)


@app.post("/api/auth/logout")
def logout(response: Response, request: Request, user: Viewer, db: DB):
    token = request.cookies.get(COOKIE_NAME, "")
    db.execute(update(AuthSession).where(AuthSession.owner_id == user.id,
               AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest()).values(deleted_at=utcnow()))
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/tasks")
def tasks(user: Viewer, db: DB, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return [serialize(r) for r in list_records(db, user.id, "task", limit, offset)]


@app.post("/api/tasks", status_code=201)
def add_task(payload: TaskInput, user: Viewer, db: DB):
    return serialize(create_record(db, user.id, "task", payload.model_dump()))


@app.patch("/api/tasks/{item_id}")
def update_task(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Record, user.id, item_id)
    values = TaskInput.model_validate({**serialize(row), **payload}).model_dump()
    return serialize(patch_record(db, user.id, "task", item_id, require_version(payload), values))


def require_version(payload: dict) -> int:
    version = payload.get("version")
    if not isinstance(version, int) or version < 1:
        raise HTTPException(422, "A positive version is required")
    return version


def delete_request(db, user, item_id, version, kind):
    row = owned(db, Record, user.id, item_id)
    if row.kind != kind:
        raise HTTPException(404, "Item not found")
    if row.version != version:
        raise HTTPException(409, "Item changed. Refresh before requesting deletion")
    tool = "memory.delete" if kind == "memory" else "record.delete"
    if kind == "integration" and row.data.get("kind") == "google_calendar":
        approval = request_approval(db, user.id, "calendar.disconnect", {"integration_id": item_id}, "Revoke Google Calendar authorization")
        return {"approval_required": True, "approval": serialize(approval)}
    approval = request_approval(db, user.id, tool, {"id": item_id, "version": version}, f"Delete {kind}: {row.title or row.id}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.delete("/api/tasks/{item_id}", status_code=202)
def delete_task(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "task")


@app.get("/api/memories")
def memories(user: Viewer, db: DB, q: str = Query("", max_length=200), limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    query = select(Record).where(Record.owner_id == user.id, Record.kind == "memory", Record.deleted_at.is_(None))
    if q:
        query = query.where(func.lower(Record.content).contains(q.lower(), autoescape=True))
    rows = db.scalars(query.order_by(Record.created_at.desc()).limit(limit).offset(offset)).all()
    return [serialize(row) for row in rows]


@app.post("/api/memories", status_code=201)
async def add_memory(payload: MemoryInput, user: Viewer, db: DB):
    memory = MemoryService(db, user.id)
    row = await memory.propose(payload.content, payload.category, payload.source)
    row.extra = payload.extra
    db.commit()
    if payload.status == "confirmed":
        async with durable_graph_resources() as (_, store):
            row = await MemoryService(db, user.id, store=store).confirm(row.id, row.version)
    return serialize(row)


@app.patch("/api/memories/{item_id}")
async def update_memory(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Record, user.id, item_id)
    version = require_version(payload)
    if row.kind != "memory":
        raise HTTPException(404, "Memory not found")
    values = MemoryInput.model_validate({**serialize(row), **payload}).model_dump()
    confirm = values.pop("status") == "confirmed"
    if any(key in payload for key in {"content", "category", "source", "extra"}):
        values["status"] = "pending"
        row = patch_record(db, user.id, "memory", item_id, version, values)
        version = row.version
    if confirm:
        async with durable_graph_resources() as (_, store):
            row = await MemoryService(db, user.id, store=store).confirm(item_id, version)
    return serialize(row)


@app.delete("/api/memories/{item_id}", status_code=202)
def delete_memory(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "memory")


@app.get("/api/events")
def events(user: Viewer, db: DB, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return [serialize(r) for r in list_records(db, user.id, "event", limit, offset)]


@app.post("/api/events", status_code=201)
async def add_event(payload: EventInput, user: Viewer, db: DB):
    ensure_no_conflict(db, user.id, payload.start_at, payload.end_at)
    if payload.provider == "google":
        await ensure_google_no_conflict(db, user.id, payload.start_at.isoformat(), payload.end_at.isoformat())
        import uuid
        args = payload.model_dump(mode="json")
        args["external_id"] = uuid.uuid4().hex
        row = request_approval(db, user.id, "calendar.create_external", args, f"Create Google event: {payload.title}")
        return {"approval_required": True, "approval": serialize(row)}
    return serialize(create_record(db, user.id, "event", payload.model_dump()))


@app.patch("/api/events/{item_id}")
def update_event(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Record, user.id, item_id)
    values = EventInput.model_validate({**serialize(row), **payload})
    if values.provider == "google":
        raise HTTPException(409, "External event modification requires a provider event ID and an approval")
    ensure_no_conflict(db, user.id, values.start_at, values.end_at, item_id)
    return serialize(patch_record(db, user.id, "event", item_id, require_version(payload), values.model_dump()))


@app.delete("/api/events/{item_id}", status_code=202)
def delete_event(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "event")


@app.get("/api/calendar/oauth/start")
def calendar_start(user: Viewer, db: DB):
    return {"authorization_url": oauth_start(db, user.id)}


@app.get("/api/calendar/oauth/callback")
async def calendar_callback(user: Viewer, db: DB, state: str, code: str):
    await oauth_complete(db, user.id, state, code)
    return RedirectResponse(get_settings().app_url + "/integrations?calendar=connected", status_code=303)


@app.get("/api/calendar/google/events")
async def google_events(user: Viewer, db: DB, start: str, end: str):
    return await list_google_events(db, user.id, start, end)


@app.get("/api/automations")
def automations(user: Viewer, db: DB):
    return [serialize(row) for row in db.scalars(select(Automation).where(Automation.owner_id == user.id,
             Automation.deleted_at.is_(None)).order_by(Automation.created_at.desc()).limit(200)).all()]


@app.post("/api/automations", status_code=201)
def add_automation(payload: AutomationInput, user: Viewer, db: DB):
    return serialize(create_automation(db, user.id, payload))


@app.patch("/api/automations/{item_id}")
def update_automation(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Automation, user.id, item_id)
    values = AutomationInput.model_validate({**serialize(row), **payload}).model_dump()
    row = cas_update(db, Automation, user.id, item_id, require_version(payload), values)
    audit(db, user.id, "automation.updated", item_id)
    db.commit()
    return serialize(row)


@app.delete("/api/automations/{item_id}")
def cancel_automation(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    row = cas_update(db, Automation, user.id, item_id, version, {"status": "cancelled", "deleted_at": utcnow()})
    audit(db, user.id, "automation.cancelled", item_id)
    db.commit()
    return {"cancelled": True, "id": row.id}


@app.post("/api/automations/{item_id}/retry")
def retry_automation(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Automation, user.id, item_id)
    execution = db.scalar(select(Execution).where(Execution.owner_id == user.id, Execution.automation_id == item_id)
                          .order_by(Execution.created_at.desc()).limit(1))
    if execution and execution.status in {"outcome_unknown", "running", "queued", "pending"}:
        raise HTTPException(409, "Reconcile the existing execution before requesting a retry")
    row = cas_update(db, Automation, user.id, item_id, require_version(payload), {"status": "active", "next_run_at": utcnow()})
    audit(db, user.id, "automation.retry_requested", item_id)
    db.commit()
    return serialize(row)


@app.get("/api/automations/{item_id}/runs")
def automation_runs(item_id: str, user: Viewer, db: DB):
    owned(db, Automation, user.id, item_id)
    return [serialize(row) for row in db.scalars(select(Execution).where(Execution.owner_id == user.id,
             Execution.automation_id == item_id).order_by(Execution.created_at.desc()).limit(100)).all()]


@app.get("/api/integrations")
def integrations(user: Viewer, db: DB):
    return [safe_integration(row) for row in list_records(db, user.id, "integration")]


def safe_integration(row):
    item = serialize(row)
    item["extra"] = {key: val for key, val in item.get("extra", {}).items() if key != "encrypted_tokens"}
    return item


@app.post("/api/integrations", status_code=201)
async def add_integration(payload: IntegrationInput, user: Viewer, db: DB):
    if payload.kind == "google_calendar":
        raise HTTPException(409, "Connect Google Calendar through OAuth")
    allowed = {host.strip() for host in get_settings().mcp_allowed_hosts.split(",") if host.strip()}
    await validate_public_url(payload.url, allowed)
    values = payload.model_dump()
    values["status"] = "ready" if payload.trusted else "untrusted"
    return safe_integration(create_record(db, user.id, "integration", values))


@app.patch("/api/integrations/{item_id}")
async def update_integration(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "integration" or row.data.get("kind") != "mcp":
        raise HTTPException(409, "Only MCP permission configuration can be edited")
    values = IntegrationInput.model_validate({**serialize(row), **payload})
    allowed = {host.strip() for host in get_settings().mcp_allowed_hosts.split(",") if host.strip()}
    await validate_public_url(values.url, allowed)
    data = values.model_dump()
    data["status"] = "ready" if values.trusted else "untrusted"
    return safe_integration(patch_record(db, user.id, "integration", item_id, require_version(payload), data))


@app.delete("/api/integrations/{item_id}", status_code=202)
def delete_integration(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "integration")


@app.get("/api/integrations/{item_id}/tools")
async def list_tools(item_id: str, user: Viewer, db: DB):
    return await mcp_tools(db, user.id, item_id)


@app.post("/api/integrations/{item_id}/call", status_code=202)
def call_tool(item_id: str, user: Viewer, db: DB, payload: dict = Body(...)):
    row = owned(db, Record, user.id, item_id)
    tool = payload.get("tool")
    if row.kind != "integration" or not row.data.get("trusted") or tool not in row.data.get("permissions", []):
        raise HTTPException(403, "MCP tool permission is not granted")
    if not isinstance(payload.get("arguments", {}), dict):
        raise HTTPException(422, "Tool arguments must be an object")
    approval = request_approval(db, user.id, "mcp.call", {"integration_id": item_id, "tool": tool,
                                "arguments": payload.get("arguments", {})}, f"Call MCP tool: {tool}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.get("/api/approvals")
def approvals(user: Viewer, db: DB):
    return [serialize(row) for row in list_records(db, user.id, "approval")]


@app.post("/api/approvals/{item_id}/resolve")
async def resolve_approval(item_id: str, payload: ApprovalInput, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "approval" or row.status != "pending":
        raise HTTPException(409, "Approval has already been resolved")
    if row.due_at and row.due_at < utcnow():
        raise HTTPException(409, "Approval expired; request a new operation")
    status = "rejected" if payload.decision == "rejected" else "executing"
    row = cas_update(db, Record, user.id, item_id, payload.version, {"status": status})
    audit(db, user.id, "approval.resolved", item_id, {"decision": payload.decision})
    db.commit()
    if status == "rejected":
        return serialize(row)
    try:
        result = await execute_approval(db, user.id, row)
    except Exception as exc:
        db.rollback()
        row = owned(db, Record, user.id, item_id)
        external_write = row.data.get("tool") in {"calendar.create_external", "calendar.update_external", "calendar.delete_external", "mcp.call", "calendar.disconnect"}
        uncertain = isinstance(exc, (TimeoutError, httpx.TransportError)) or (external_write and isinstance(exc, HTTPException) and exc.status_code >= 500)
        row.status = "outcome_unknown" if uncertain else "failed"
        row.data = {**row.data, "error_type": type(exc).__name__}
        audit(db, user.id, "approval.execution_failed", item_id, {"error_type": type(exc).__name__}, status=row.status)
        db.commit()
        if isinstance(exc, HTTPException):
            raise HTTPException(exc.status_code, f"Approved operation blocked: {exc.detail}. Request a new approval after resolving this condition") from exc
        raise HTTPException(502, "Approved operation failed. Inspect Activity before retrying") from exc
    row = owned(db, Record, user.id, item_id)
    row.status = "approved"
    row.version += 1
    row.data = {**row.data, "result": result, "executed_at": utcnow().isoformat()}
    if row.data.get("tool") == "account.delete":
        row.title, row.content, row.extra = "Account deletion completed", "", {}
        row.data = {"tool": "account.delete", "result": result, "executed_at": utcnow().isoformat()}
    audit(db, user.id, "approval.executed", item_id, {"tool": row.data["tool"]})
    db.commit()
    return serialize(row)


@app.get("/api/activity")
def activity(user: Viewer, db: DB):
    rows = [serialize(row) for row in list_records(db, user.id, "activity")]
    executions = db.scalars(select(Execution).where(Execution.owner_id == user.id,
                           Execution.deleted_at.is_(None)).order_by(Execution.created_at.desc()).limit(100)).all()
    rows.extend({**serialize(row), "title": "Automation run", "kind": "execution"} for row in executions)
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)[:200]


@app.get("/api/settings")
def settings(user: Viewer):
    private = decrypt_config(user.secret_config)
    config = get_settings()
    return {"name": user.name, "email": user.email, "model": user.preferences.get("model", config.openai_model),
            "base_url": private.get("base_url", config.openai_base_url), "api_key_configured": bool(private.get("api_key") or config.openai_api_key),
            "memory_enabled": user.preferences.get("memory_enabled", True), "theme": user.preferences.get("theme", "system"),
            "timezone": user.preferences.get("timezone", "Asia/Shanghai"), "version": user.version,
            "google_oauth_configured": bool(config.google_client_id and config.google_client_secret),
            "hy_memory_configured": False, "hy_memory_status": "awaiting_authorization", "jev_configured": bool(config.typesafe_api_key),
            "fast_model": user.preferences.get("fast_model", ""), "reasoning_model": user.preferences.get("reasoning_model", ""),
            "decision_provider": user.preferences.get("decision_provider", config.decision_provider)}


@app.patch("/api/settings")
async def update_settings(payload: SettingsInput, user: Viewer, db: DB):
    changes = payload.model_dump(exclude_none=True, exclude={"version"})
    private = decrypt_config(user.secret_config)
    if "base_url" in changes:
        await validate_public_url(changes["base_url"])
    for key in {"api_key", "base_url"} & changes.keys():
        private[key] = changes.pop(key)
    encrypted = encrypt_config(private) if private else None
    name = changes.pop("name", user.name)
    assert_account_writable(db, user.id)
    result = db.execute(update(User).where(User.id == user.id, User.version == payload.version, User.deleted_at.is_(None)).values(
        name=name, secret_config=encrypted, preferences={**user.preferences, **changes},
        version=payload.version + 1, updated_at=utcnow()))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Settings changed. Refresh before saving")
    audit(db, user.id, "settings.updated")
    db.commit()
    db.refresh(user)
    return settings(user)


@app.get("/api/export")
def export_data(user: Viewer, db: DB):
    from fastapi.encoders import jsonable_encoder

    owner_id, bind = user.id, db.get_bind()

    def json_fragment(value):
        return json.dumps(jsonable_encoder(value), ensure_ascii=False, separators=(",", ":"))

    async def export_chunks():
        # A separate server-cursor session owns the complete response lifetime.
        # The shared lease prevents approved erasure from racing this snapshot;
        # repeatable-read makes all exported collections mutually consistent.
        with Session(bind=bind, expire_on_commit=False) as export_db:
            with account_lease(export_db, owner_id):
                export_db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
                export_db.execute(text("SET TRANSACTION READ ONLY"))
                snapshot_user = export_db.get(User, owner_id)
                yield '{"format_version":1,"exported_at":' + json_fragment(utcnow())
                yield ',"user":' + json_fragment(public_user(snapshot_user))
                resources = [
                    ("records", Record, safe_integration, [Record.kind != "oauth_state"]),
                    ("messages", Message, serialize, []),
                    ("automations", Automation, serialize, []),
                    ("executions", Execution, serialize, []),
                ]
                for name, model, encoder, extra_filters in resources:
                    yield ',"' + name + '":['
                    query = select(model).where(model.owner_id == owner_id, model.deleted_at.is_(None), *extra_filters).order_by(model.id)
                    rows = export_db.scalars(query.execution_options(yield_per=500, stream_results=True))
                    batch, emitted = [], False
                    try:
                        for row in rows:
                            batch.append(json_fragment(encoder(row)))
                            if len(batch) == 500:
                                yield ("," if emitted else "") + ",".join(batch)
                                emitted, batch = True, []
                        if batch:
                            yield ("," if emitted else "") + ",".join(batch)
                    finally:
                        rows.close()
                    yield "]"
                yield ',"notice":"Complete account export. Credentials and OAuth state are excluded."}'
    return StreamingResponse(export_chunks(), media_type="application/json", headers={
        "Content-Disposition": 'attachment; filename="personalos-export.json"', "Cache-Control": "no-store"})


@app.get("/api/briefings")
def briefings(user: Viewer, db: DB):
    return [serialize(r) for r in list_records(db, user.id, "briefing")]


@app.post("/api/briefings", status_code=201)
async def add_briefing(user: Viewer, db: DB):
    return await generate_briefing(db, user.id)


@app.get("/api/dashboard")
def dashboard(user: Viewer, db: DB):
    tasks = [serialize(r) for r in list_records(db, user.id, "task")]
    events = [serialize(r) for r in list_records(db, user.id, "event")]
    memories = [serialize(r) for r in list_records(db, user.id, "memory")]
    automation_rows = automations(user, db)
    approval_rows = approvals(user, db)
    briefing_rows = list_records(db, user.id, "briefing", 1)
    task_count = db.scalar(select(func.count()).select_from(Record).where(Record.owner_id == user.id, Record.kind == "task", Record.deleted_at.is_(None), Record.status.not_in(["done", "cancelled"])))
    memory_count = db.scalar(select(func.count()).select_from(Record).where(Record.owner_id == user.id, Record.kind == "memory", Record.deleted_at.is_(None), Record.status == "confirmed"))
    automation_count = db.scalar(select(func.count()).select_from(Automation).where(Automation.owner_id == user.id, Automation.deleted_at.is_(None), Automation.status == "active"))
    approval_count = db.scalar(select(func.count()).select_from(Record).where(Record.owner_id == user.id, Record.kind == "approval", Record.deleted_at.is_(None), Record.status == "pending"))
    return {"stats": {"tasks": task_count, "memories": memory_count, "automations": automation_count, "approvals": approval_count},
            "tasks": tasks, "events": events, "memories": memories, "automations": automation_rows,
            "approvals": approval_rows, "briefing": serialize(briefing_rows[0]) if briefing_rows else None}


@app.get("/api/chat/sessions")
def chat_sessions(user: Viewer, db: DB):
    return [serialize(row) for row in list_records(db, user.id, "chat_session")]


@app.get("/api/chat/sessions/{item_id}/messages")
def chat_messages(item_id: str, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "chat_session":
        raise HTTPException(404, "Session not found")
    return [serialize(r) for r in db.scalars(select(Message).where(Message.owner_id == user.id,
            Message.session_id == item_id, Message.deleted_at.is_(None)).order_by(Message.created_at).limit(500)).all()]


@app.post("/api/chat/stream")
async def chat(payload: ChatInput, user: Viewer, db: DB):
    model_config(user, payload.model)
    session = owned(db, Record, user.id, payload.session_id) if payload.session_id else create_record(
        db, user.id, "chat_session", {"title": payload.message[:80]})
    if session.kind != "chat_session":
        raise HTTPException(404, "Session not found")
    assert_account_writable(db, user.id)
    db.add(Message(owner_id=user.id, session_id=session.id, role="user", content=payload.message))
    db.commit()

    async def events():
        pieces = []
        try:
            async for event in stream_agent(db, user, payload.message, session.id, payload.model):
                if event["type"] == "token":
                    pieces.append(event["content"])
                yield "data: " + json.dumps(event, ensure_ascii=False, default=str) + "\n\n"
            db.add(Message(owner_id=user.id, session_id=session.id, role="assistant", content="".join(pieces)))
            db.commit()
            yield "data: " + json.dumps({"type": "done", "session_id": session.id}) + "\n\n"
        except Exception as exc:
            db.rollback()
            logger.exception("chat_failed session_id=%s error_type=%s", session.id, type(exc).__name__)
            audit(db, user.id, "chat.failed", session.id, {"error_type": type(exc).__name__}, status="failed")
            db.commit()
            yield "data: " + json.dumps({"type": "error", "content": "Model or tool execution failed. Check Activity and model settings", "error_type": type(exc).__name__}) + "\n\n"
    async def leased_events():
        try:
            with account_lease(db, user.id):
                async for event in events():
                    yield event
        except HTTPException as exc:
            yield "data: " + json.dumps({"type": "error", "content": exc.detail}) + "\n\n"
    return StreamingResponse(leased_events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.patch("/api/calendar/google/events/{event_id}", status_code=202)
async def update_google_event(event_id: str, payload: EventInput, user: Viewer, db: DB):
    current = await get_google_event(db, user.id, event_id)
    await ensure_google_no_conflict(db, user.id, payload.start_at.isoformat(), payload.end_at.isoformat(), event_id)
    args = {**payload.model_dump(mode="json"), "external_id": event_id, "etag": current["etag"]}
    approval = request_approval(db, user.id, "calendar.update_external", args, f"Modify Google event: {payload.title}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.delete("/api/calendar/google/events/{event_id}", status_code=202)
async def delete_google_event(event_id: str, user: Viewer, db: DB):
    current = await get_google_event(db, user.id, event_id)
    approval = request_approval(db, user.id, "calendar.delete_external", {"external_id": event_id, "etag": current["etag"]},
                                f"Delete Google event: {current.get('summary', event_id)}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.post("/api/calendar/google/events/{event_id}/undo", status_code=202)
async def undo_google_event(event_id: str, user: Viewer, db: DB):
    return await delete_google_event(event_id, user, db)


@app.post("/api/integrations/{item_id}/disconnect", status_code=202)
def request_disconnect(item_id: str, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "integration" or row.data.get("kind") != "google_calendar":
        raise HTTPException(404, "Google Calendar connection not found")
    approval = request_approval(db, user.id, "calendar.disconnect", {"integration_id": item_id}, "Revoke Google Calendar authorization")
    return {"approval_required": True, "approval": serialize(approval)}


@app.post("/api/account/delete", status_code=202)
def request_account_delete(user: Viewer, db: DB, payload: dict = Body(...)):
    if payload.get("confirmation") != "DELETE":
        raise HTTPException(422, "Type DELETE to request account erasure")
    approval = request_approval(db, user.id, "account.delete", {}, "Delete account and personal data")
    return {"approval_required": True, "approval": serialize(approval)}
