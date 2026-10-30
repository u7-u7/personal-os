"""HTTP boundary: authenticate, validate, delegate and serialize."""
import hashlib
import json
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Annotated, Literal
from urllib.parse import urlencode

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from personalos.config import get_settings
from personalos.db import get_db, utcnow
from personalos.models import AuthSession, Automation, Execution, Message, Record, User
from personalos.schemas import (ApprovalInput, ResumeApprovalInput, AutomationInput, CalendarCreateInput, CalendarPatchInput,
                               ChatInput, Credentials, EventInput, ChatDiagnosticsInput, EmbeddingDiagnosticsInput,
                               IntegrationInput, MemoryInput, SettingsInput, TaskInput)
from personalos.security import (COOKIE_NAME, current_user, decrypt_config, encrypt_config,
                                new_session, password_hasher)
from personalos.services.agent import durable_graph_resources, generate_briefing, initialize_graph_storage, model_config, stream_agent
from personalos.services.automations import create_automation, list_automations, list_automation_runs
from personalos.services.accounts import account_lease, assert_account_writable
from personalos.services import notifications as reminders
from personalos.services.calendar import (calendar_view, create_calendar, create_event, delete_calendar, delete_event,
                                          list_calendars, list_event_views, update_calendar, update_event)
from personalos.services.memory import MemoryService
from personalos.services.memory_deletion import approval_views, RECOVERABLE
from personalos.services.network import validate_public_url
from personalos.services.records import (audit, cas_update, create_record, list_records, owned, patch_record,
                                         query_tasks, serialize)
from personalos.services.tools import execute_approval, mcp_tools, request_approval

logger = logging.getLogger(__name__)
@asynccontextmanager
async def lifespan(app):
    await initialize_graph_storage()
    yield


app = FastAPI(lifespan=lifespan, title="PersonalOS API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
DB = Annotated[Session, Depends(get_db)]
Viewer = Annotated[User, Depends(current_user)]


def allowed_origins() -> set[str]:
    # Operators reach the same UI as localhost and 127.0.0.1; the configured
    # origin list keeps both reachable without relaxing the guard for others.
    settings = get_settings()
    listed = ",".join((settings.web_origin, settings.app_url))
    return {item.strip().rstrip("/") for item in listed.split(",") if item.strip()}


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    # Browser mutations must originate from our UI; server/CLI clients without Origin still authenticate.
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in allowed_origins():
            return Response(content='{"detail":"Cross-origin mutation refused"}', status_code=403, media_type="application/json")
    return await call_next(request)


@app.exception_handler(ValidationError)
async def validation_error(request: Request, exc: ValidationError):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": json.loads(exc.json(include_url=False, include_input=False, include_context=False))})


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError):
    from fastapi.responses import JSONResponse

    # Registration/settings errors must never echo password or API-key input.
    errors = [{key: issue[key] for key in ("type", "loc", "msg") if key in issue} for issue in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


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
    return [serialize(r) for r in query_tasks(db, user.id, limit, offset)]


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
    approval = request_approval(db, user.id, tool, {"id": item_id, "version": version}, f"Delete {kind}: {row.title or row.id}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.delete("/api/tasks/{item_id}", status_code=202)
def delete_task(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "task")


@app.get("/api/memories")
def memories(user: Viewer, db: DB, q: str = Query("", max_length=200), topic: str | None = Query(None, max_length=500), limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    query = select(Record).where(Record.owner_id == user.id, Record.kind == "memory", Record.deleted_at.is_(None))
    if q:
        query = query.where(func.lower(Record.content).contains(q.lower(), autoescape=True))
    if topic is not None:
        # The owner/kind/deleted index bounds IO before JSON fact-key filtering.
        # Apply the topic predicate before pagination so older conflicts remain selectable.
        query = query.where(Record.extra["fact_key"].as_string() == topic)
    rows = db.scalars(query.order_by(Record.created_at.desc(), Record.id.desc()).limit(limit).offset(offset)).all()
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
    editable_keys = {"fact_key", "supersedes", "tags"}
    # Stored provider/index metadata is server-owned. It must neither break
    # input validation on retry nor be erased by a normal user edit.
    current = {**serialize(row), "status": "pending",
               "extra": {key: value for key, value in row.extra.items() if key in editable_keys}}
    values = MemoryInput.model_validate({**current, **payload}).model_dump()
    confirm = payload.get("status") == "confirmed"
    if any(key in payload for key in {"content", "category", "source", "extra"}):
        values["status"] = "pending"
        values["extra"] = {**{key: value for key, value in row.extra.items() if key not in editable_keys}, **values["extra"]}
        row = patch_record(db, user.id, "memory", item_id, version, values)
        version = row.version
    elif payload.get("status") == "pending":
        row = patch_record(db, user.id, "memory", item_id, version, {"status": "pending"})
    if confirm:
        async with durable_graph_resources() as (_, store):
            row = await MemoryService(db, user.id, store=store).confirm(item_id, version)
    return serialize(row)


@app.delete("/api/memories/{item_id}", status_code=202)
def delete_memory(item_id: str, user: Viewer, db: DB, version: int = Query(..., ge=1)):
    return delete_request(db, user, item_id, version, "memory")


@app.get("/api/calendars")
def calendars(user: Viewer, db: DB):
    return {"items": [calendar_view(row) for row in list_calendars(db, user.id)]}


@app.post("/api/calendars", status_code=201)
def add_calendar(payload: CalendarCreateInput, user: Viewer, db: DB):
    return calendar_view(create_calendar(db, user.id, payload))


@app.patch("/api/calendars/{calendar_id}")
def patch_calendar(calendar_id: str, payload: CalendarPatchInput, user: Viewer, db: DB):
    return calendar_view(update_calendar(db, user.id, calendar_id, payload))


@app.delete("/api/calendars/{calendar_id}", status_code=202)
def remove_calendar(calendar_id: str, user: Viewer, db: DB, move_to: str | None = Query(None, max_length=36)):
    return delete_calendar(db, user.id, calendar_id, move_to=move_to)


@app.get("/api/events")
def events(user: Viewer, db: DB, limit: int | None = Query(None, ge=1, le=500), offset: int = Query(0, ge=0),
           start: datetime | None = Query(None), end: datetime | None = Query(None),
           timezone: str | None = Query(None, max_length=100)):
    return list_event_views(db, user.id, start=start, end=end, timezone=timezone, limit=limit, offset=offset)


@app.post("/api/events", status_code=201)
def add_event(payload: EventInput, user: Viewer, db: DB):
    return create_event(db, user.id, payload)


@app.patch("/api/events/{item_id}")
def patch_event(item_id: str, user: Viewer, db: DB, payload: dict = Body(...),
                scope: Literal["this", "following", "all"] = Query("all"),
                occurrence_start: datetime | None = Query(None)):
    return update_event(db, user.id, item_id, payload, scope=scope, occurrence_start=occurrence_start)


@app.delete("/api/events/{item_id}", status_code=202)
def remove_event(item_id: str, user: Viewer, db: DB, scope: Literal["this", "following", "all"] = Query("all"),
                 occurrence_start: datetime | None = Query(None), version: int | None = Query(None, ge=1)):
    return delete_event(db, user.id, item_id, scope=scope, occurrence_start=occurrence_start, version=version)


@app.get("/api/notifications")
def notifications(user: Viewer, db: DB, status: Literal["unread", "read"] | None = Query(None),
                  limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    rows, unread = reminders.list_notifications(db, user.id, status, limit, offset)
    return {"items": [reminders.notification_view(row) for row in rows], "unread": unread}


@app.post("/api/notifications/read-all", status_code=202)
def read_all_notifications(user: Viewer, db: DB):
    return {"read": reminders.mark_all_read(db, user.id)}


@app.post("/api/notifications/{notification_id}/read", status_code=202)
def read_notification(notification_id: str, user: Viewer, db: DB):
    return {"read": reminders.mark_read(db, user.id, notification_id)}


@app.get("/api/automations")
def automations(user: Viewer, db: DB, limit: int = Query(200, ge=1, le=200), offset: int = Query(0, ge=0)):
    return [serialize(row) for row in list_automations(db, user.id, limit, offset)]


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
def automation_runs(item_id: str, user: Viewer, db: DB, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    return [serialize(row) for row in list_automation_runs(db, user.id, item_id, limit, offset)]


@app.get("/api/integrations")
def integrations(user: Viewer, db: DB):
    return [safe_integration(row) for row in list_records(db, user.id, "integration")]


def safe_integration(row):
    item = serialize(row)
    item["extra"] = {key: val for key, val in (item.get("extra") or {}).items() if key != "encrypted_tokens"}
    # serialize() flattens the data column, so the issued token envelope also lands at the top level.
    item.pop("encrypted_tokens", None)
    return item


@app.post("/api/integrations", status_code=201)
async def add_integration(payload: IntegrationInput, user: Viewer, db: DB):
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


class OAuthStartInput(BaseModel):
    """Optional scope override; an empty list means the read-only default."""

    scope: list[str] | None = Field(default=None, max_length=50)

    @field_validator("scope")
    @classmethod
    def trim_scope(cls, value):
        if value is None:
            return None
        scopes = [item.strip() for item in value if item.strip()]
        if any(len(item) > 120 for item in scopes):
            raise ValueError("OAuth scopes must be at most 120 characters")
        return scopes or None


# A connection must never gain write access implicitly: the default request is read-only.
READ_ONLY_OAUTH_SCOPES = ("read:user", "public_repo")
OAUTH_STATE_MINUTES = 10
OAUTH_TOKEN_KEYS = ("access_token", "token_type", "refresh_token", "expires_at", "scope")


def oauth_scope(scopes_supported: list[str], requested: list[str] | None) -> list[str]:
    """Explicit scopes win; otherwise only the read-only scopes the provider actually offers.

    An empty result sends no scope parameter, leaving the provider to apply its own minimal
    default. A provider that offers nothing read-only must not fall through to its first scope,
    because that is how a connection would silently gain write access.
    """
    if requested:
        return requested
    supported = {item for item in scopes_supported if item}
    return [item for item in READ_ONLY_OAUTH_SCOPES if item in supported]


def oauth_browser_redirect(**params: str) -> RedirectResponse:
    """Return the browser to the web settings page with short status codes and nothing else."""
    response = RedirectResponse(url=f"{get_settings().app_url.rstrip('/')}/settings?{urlencode(params)}",
                                status_code=302)
    response.headers["Cache-Control"] = "no-store"
    return response


def oauth_state_matches(stored: object, provided: str) -> bool:
    """Constant-time compare; a value we never issued cannot match."""
    return (isinstance(stored, str) and len(stored) == len(provided) and stored.isascii()
            and provided.isascii() and secrets.compare_digest(stored, provided))


def pending_oauth_state(db: Session, state: str) -> Record | None:
    """The one unexpired pending authorization whose state matches.

    The provider redirect carries no session cookie, so the ten-minute pending window bounds
    this read; an expired or spent row can never be claimed again.
    """
    if not state or not state.isascii():
        return None
    rows = db.scalars(select(Record).where(Record.kind == "oauth_state", Record.status == "pending",
                       Record.due_at > utcnow(), Record.deleted_at.is_(None))).all()
    return next((row for row in rows if oauth_state_matches(row.data.get("state"), state)), None)


def claim_oauth_state(db: Session, row: Record) -> bool:
    """Spend the state once: the claiming statement drops the encrypted verifier payload."""
    data = {key: value for key, value in row.data.items() if key != "encrypted"}
    result = db.execute(update(Record).where(Record.id == row.id, Record.kind == "oauth_state",
                         Record.status == "pending", Record.version == row.version,
                         Record.due_at > utcnow())
                         .values(status="used", version=row.version + 1, updated_at=utcnow(), data=data))
    if result.rowcount != 1:
        db.rollback()
        return False
    db.commit()
    return True


def store_oauth_tokens(db: Session, owner_id: str, integration: Record, tokens: dict,
                       scopes: list[str]) -> None:
    """Encrypt the token set onto the integration and audit the granted scope only."""
    stored = {key: tokens.get(key) for key in OAUTH_TOKEN_KEYS}
    integration.data = {**integration.data, "encrypted_tokens": encrypt_config(stored)}
    integration.version += 1
    integration.updated_at = utcnow()
    audit(db, owner_id, "oauth.linked", integration.id, {"scope": stored["scope"] or " ".join(scopes)})
    db.commit()


def oauth_failure_reason(exc: Exception) -> str:
    """Short reason code for the redirect; tokens, verifiers and remote text stay out of it."""
    from personalos.services.oauth import OAuthError

    if isinstance(exc, OAuthError):
        return "provider_failed"
    if isinstance(exc, HTTPException):
        return "storage"
    if isinstance(exc, (TimeoutError, httpx.TransportError)):
        return "network"
    return "failed"


@app.post("/api/integrations/{item_id}/oauth/start")
async def start_oauth(item_id: str, user: Viewer, db: DB, payload: OAuthStartInput | None = None):
    from personalos.services.oauth import (OAuthError, authorization_url, discover, new_pkce, new_state,
                                           register_client)

    row = owned(db, Record, user.id, item_id)
    if row.kind != "integration" or row.data.get("kind") != "mcp":
        raise HTTPException(404, "MCP connection not found")
    if row.data.get("trusted") is not True:
        raise HTTPException(403, "Explicitly trust this MCP connection before authorizing it")
    if not row.data.get("url"):
        raise HTTPException(409, "MCP connection has no server URL to authorize")
    assert_account_writable(db, user.id)
    settings = get_settings()
    redirect_uri = settings.oauth_callback_url
    try:
        discovery = await discover(row.data["url"])
        if settings.oauth_client_id:
            client_id, client_secret = settings.oauth_client_id, settings.oauth_client_secret or None
        else:
            registered = await register_client(discovery, redirect_uri=redirect_uri)
            client_id, client_secret = registered["client_id"], registered.get("client_secret")
        scopes = oauth_scope(discovery.scopes_supported, payload.scope if payload else None)
    except OAuthError as exc:
        if exc.error == "dcr_unsupported":
            raise HTTPException(409, "This provider cannot register itself dynamically. Register an OAuth "
                                     "app and set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET") from exc
        logger.warning("oauth_start_failed integration_id=%s error_code=%s", item_id, exc.error)
        raise HTTPException(502, f"OAuth metadata discovery failed ({exc.error})") from exc
    state = new_state()
    verifier, challenge = new_pkce()
    authorization = authorization_url(discovery, client_id=client_id, redirect_uri=redirect_uri, scope=scopes,
                                      state=state, challenge=challenge)
    # The verifier and the client secret exist at rest only inside this ciphertext.
    pending = encrypt_config({"verifier": verifier, "scopes": scopes, "client_id": client_id,
                              "client_secret": client_secret})
    db.add(Record(owner_id=user.id, kind="oauth_state", status="pending",
                  title=f"Authorize {row.title or 'MCP connection'}"[:500],
                  due_at=utcnow() + timedelta(minutes=OAUTH_STATE_MINUTES),
                  data={"integration_id": item_id, "state": state, "encrypted": pending,
                        "redirect_uri": redirect_uri, "created_at": utcnow().isoformat()}))
    db.commit()
    return {"authorization_url": authorization, "state": state, "scope": scopes}


@app.get("/api/oauth/callback")
async def oauth_callback(db: DB, code: str = Query(default=""), state: str = Query(default=""),
                         error: str = Query(default="")):
    from personalos.services.oauth import discover, exchange_code

    pending = pending_oauth_state(db, state)
    if pending is None:
        return oauth_browser_redirect(oauth="invalid_state")
    owner_id, data = pending.owner_id, dict(pending.data)
    if not claim_oauth_state(db, pending):
        return oauth_browser_redirect(oauth="invalid_state")
    try:
        if error or not code:
            return oauth_browser_redirect(oauth="failed", reason="denied")
        payload = decrypt_config(data.get("encrypted"))
        integration = db.scalar(select(Record).where(Record.id == data.get("integration_id"),
                                Record.owner_id == owner_id, Record.kind == "integration",
                                Record.deleted_at.is_(None)))
        linked = integration.data if integration is not None else {}
        if integration is None or linked.get("trusted") is not True or not linked.get("url"):
            return oauth_browser_redirect(oauth="failed", reason="revoked")
        discovery = await discover(linked["url"])
        tokens = await exchange_code(discovery, client_id=payload["client_id"],
                                    client_secret=payload.get("client_secret"), code=code,
                                    redirect_uri=data.get("redirect_uri") or "", verifier=payload["verifier"])
        store_oauth_tokens(db, owner_id, integration, tokens, payload.get("scopes") or [])
    except Exception as exc:
        db.rollback()
        reason = oauth_failure_reason(exc)
        logger.warning("oauth_callback_failed reason=%s error_type=%s", reason, type(exc).__name__)
        return oauth_browser_redirect(oauth="failed", reason=reason)
    return oauth_browser_redirect(oauth="ok")


@app.get("/api/approvals")
def approvals(user: Viewer, db: DB, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    rows = list(db.scalars(select(Record).where(Record.owner_id == user.id, Record.kind == "approval",
        Record.deleted_at.is_(None)).order_by(Record.created_at.desc(), Record.id.desc()).limit(limit).offset(offset)).all())
    return approval_views(db, user.id, rows)


@app.post("/api/approvals/{item_id}/resolve")
async def resolve_approval(item_id: str, payload: ApprovalInput, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.data.get("tool") == "memory.delete" and payload.decision == "approved":
        # Claim and final status share the same lease as erasure; a concurrent
        # recovery must not mark a genuinely running approval as failed.
        with account_lease(db, user.id, exclusive=True):
            return await _resolve_approval(item_id, payload, user, db)
    return await _resolve_approval(item_id, payload, user, db)


async def _resolve_approval(item_id: str, payload: ApprovalInput, user: User, db: Session):
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
    return await _finish_approval(db, user.id, row)


async def _finish_approval(db: Session, owner_id: str, row: Record):
    item_id = row.id
    try:
        result = await execute_approval(db, owner_id, row)
    except Exception as exc:
        db.rollback()
        row = owned(db, Record, owner_id, item_id)
        external_write = row.data.get("tool") in {"mcp.call", "code_hosting.write"}
        uncertain = isinstance(exc, (TimeoutError, httpx.TransportError)) or (external_write and isinstance(exc, HTTPException) and exc.status_code >= 500)
        row.status = "outcome_unknown" if uncertain else "failed"
        row.version += 1
        row.updated_at = utcnow()
        row.data = {**row.data, "error_type": type(exc).__name__}
        audit(db, owner_id, "approval.execution_failed", item_id, {"error_type": type(exc).__name__}, status=row.status)
        db.commit()
        if row.data.get("tool") == "memory.delete":
            code = exc.status_code if isinstance(exc, HTTPException) else 503
            detail = exc.detail if isinstance(exc, HTTPException) and code in {403, 404, 409, 410, 422} else "Memory cleanup interrupted; resume the original approval in Activity"
            raise HTTPException(code, detail) from exc
        if isinstance(exc, HTTPException):
            raise HTTPException(exc.status_code, f"Approved operation blocked: {exc.detail}. Request a new approval after resolving this condition") from exc
        raise HTTPException(502, "Approved operation failed. Inspect Activity before retrying") from exc
    row = owned(db, Record, owner_id, item_id)
    pending_cleanup = row.data.get("tool") == "memory.delete" and not result.get("cleanup_complete", False)
    row.status = "cleanup_pending" if pending_cleanup else "approved"
    row.version += 1
    row.updated_at = utcnow()
    row.data = {key: value for key, value in row.data.items() if key != "error_type"}
    row.data = {**row.data, "result": result, "executed_at": utcnow().isoformat()}
    if row.data.get("tool") == "account.delete":
        row.title, row.content, row.extra = "Account deletion completed", "", {}
        row.data = {"tool": "account.delete", "result": result, "executed_at": utcnow().isoformat()}
    audit(db, owner_id, "memory.cleanup_pending" if pending_cleanup else "approval.executed", item_id,
          {"tool": row.data["tool"]}, status="blocked" if pending_cleanup else "succeeded")
    db.commit()
    view = approval_views(db, owner_id, [row])[0]
    return JSONResponse(status_code=202, content=jsonable_encoder(view)) if pending_cleanup else view


@app.post("/api/approvals/{item_id}/resume")
async def resume_approval(item_id: str, payload: ResumeApprovalInput, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "approval" or row.data.get("tool") != "memory.delete":
        raise HTTPException(403, "Only an approved memory deletion can be resumed")
    with account_lease(db, user.id, exclusive=True):
        db.refresh(row)
        if row.version != payload.version:
            raise HTTPException(409, "Approval changed. Refresh before resuming")
        if row.status == "approved" and row.data.get("result", {}).get("cleanup_complete"):
            return approval_views(db, user.id, [row])[0]
        legacy_pending = row.status == "approved" and row.data.get("result", {}).get("status") == "deletion_pending"
        if row.status not in RECOVERABLE and not legacy_pending:
            raise HTTPException(409, "This approval has no authorized cleanup to resume")
        args = row.data["arguments"]
        target = db.scalar(select(Record).where(Record.id == args["id"], Record.owner_id == user.id, Record.kind == "memory"))
        if row.due_at and row.due_at < utcnow() and (target is None or target.deleted_at is None):
            raise HTTPException(409, "Approval expired before deletion started; request fresh approval")
        row = cas_update(db, Record, user.id, item_id, payload.version, {"status": "executing"})
        audit(db, user.id, "memory.cleanup_resumed", item_id)
        db.commit()
        return await _finish_approval(db, user.id, row)


@app.get("/api/activity")
def activity(user: Viewer, db: DB):
    rows = [serialize(row) for row in list_records(db, user.id, "activity")]
    executions = db.scalars(select(Execution).where(Execution.owner_id == user.id,
                           Execution.deleted_at.is_(None)).order_by(Execution.created_at.desc()).limit(100)).all()
    rows.extend({**serialize(row), "title": "Automation run", "kind": "execution"} for row in executions)
    return sorted(rows, key=lambda row: row["created_at"], reverse=True)[:200]


@app.get("/api/settings")
def settings(user: Viewer, db: DB):
    from personalos.services.embedding import EmbeddingConfiguration
    from personalos.services.model import ChatConfiguration

    config = get_settings()
    chat = ChatConfiguration.for_user(user)
    embedding = EmbeddingConfiguration.for_user(user)
    return {**chat.public_settings(), **embedding.public_settings(),
            "ai_setup_complete": chat.configured and embedding.configured,
            "missing_configuration_fields": {"chat": chat.missing_fields,
                "embedding": [name for name, value in (("embedding_base_url", embedding.base_url), ("embedding_api_key", embedding.api_key)) if not value]},
            "name": user.name, "email": user.email,
            "memory_enabled": user.preferences.get("memory_enabled", True), "theme": user.preferences.get("theme", "system"),
            "timezone": user.preferences.get("timezone", "Asia/Shanghai"), "version": user.version,
            "hy_memory_configured": False, "hy_memory_status": "awaiting_authorization", "jev_configured": bool(config.typesafe_api_key),
            "fast_model": user.preferences.get("fast_model", ""), "reasoning_model": user.preferences.get("reasoning_model", ""),
            "decision_provider": user.preferences.get("decision_provider", config.decision_provider)}


@app.patch("/api/settings")
async def update_settings(payload: SettingsInput, user: Viewer, db: DB):
    from personalos.services.embedding import EmbeddingConfiguration, validate_embedding_url

    changes = payload.model_dump(exclude_none=True, exclude={"version"})
    # Validate the effective pair before updating preferences: each model has
    # different dimension choices, including when only one field changes.
    EmbeddingConfiguration.for_user(user).with_draft(changes)
    private = decrypt_config(user.secret_config)
    if "base_url" in changes:
        await validate_public_url(changes["base_url"])
    if changes.get("embedding_base_url"):
        await validate_embedding_url(changes["embedding_base_url"])
    defaults = get_settings()
    for url_field, key_field, default_url in (
            ("base_url", "api_key", defaults.openai_base_url),
            ("embedding_base_url", "embedding_api_key", defaults.embedding_base_url)):
        if (url_field in changes and key_field not in changes and private.get(key_field)
                and changes[url_field].rstrip("/") != private.get(url_field, default_url).strip().rstrip("/")):
            message = ("Enter a new embedding API key when changing the endpoint" if url_field.startswith("embedding_")
                       else "Enter a new API key when changing the endpoint")
            raise HTTPException(422, message)
    for key in {"api_key", "base_url", "embedding_api_key", "embedding_base_url"} & changes.keys():
        private[key] = changes.pop(key)
    if private.get("embedding_api_key") and not private.get("embedding_base_url", get_settings().embedding_base_url):
        raise HTTPException(422, "Fill the Beijing workspace Embedding Base URL before saving its API key")
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
    return settings(user, db)


async def run_provider_diagnostic(payload, user: User, db: Session, *, action: str, probe, embedding: bool = False):
    from personalos.services.embedding import EmbeddingConfiguration
    from personalos.services.model import ChatConfiguration

    with account_lease(db, user.id):
        # Authentication may have loaded this row before another settings save.
        db.refresh(user)
        details = {"settings_version": user.version}
        try:
            if payload.version is not None and payload.version != user.version:
                raise HTTPException(409, "Settings changed. Refresh before testing")
            draft = payload.model_dump(exclude_none=True, exclude={"version"})
            configuration = (EmbeddingConfiguration if embedding else ChatConfiguration).for_user(user).with_draft(draft)
            details["model"] = configuration.model
            if embedding:
                details["dimensions"] = configuration.dimensions
            result = await probe(configuration)
        except HTTPException as exc:
            audit(db, user.id, action, details={**details, "http_status": exc.status_code}, status="failed")
            db.commit()
            raise
        audit(db, user.id, action, details=details)
        db.commit()
        return {**result, "settings_version": details["settings_version"]}


@app.post("/api/settings/chat/test")
async def test_chat_connection(user: Viewer, db: DB, payload: ChatDiagnosticsInput | None = None):
    from personalos.services.model import test_chat_connection as probe

    return await run_provider_diagnostic(payload or ChatDiagnosticsInput(), user, db,
                                         action="chat.connection_test", probe=probe)


@app.post("/api/settings/chat/models")
async def list_chat_models(user: Viewer, db: DB, payload: ChatDiagnosticsInput | None = None):
    from personalos.services.model import list_chat_models as probe

    return await run_provider_diagnostic(payload or ChatDiagnosticsInput(), user, db,
                                         action="chat.models_list", probe=probe)


@app.post("/api/settings/chat/balance")
async def chat_balance(user: Viewer, db: DB, payload: ChatDiagnosticsInput | None = None):
    from personalos.services.model import chat_balance as probe

    return await run_provider_diagnostic(payload or ChatDiagnosticsInput(), user, db,
                                         action="chat.balance_query", probe=probe)


@app.post("/api/settings/embedding/test")
async def test_embedding_connection(user: Viewer, db: DB, payload: EmbeddingDiagnosticsInput | None = None):
    from personalos.services.embedding import EmbeddingService

    async def probe(configuration):
        return await EmbeddingService(configuration).test_connection()

    return await run_provider_diagnostic(payload or EmbeddingDiagnosticsInput(), user, db,
                                         action="embedding.connection_test", probe=probe, embedding=True)


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
    tasks = [serialize(r) for r in query_tasks(db, user.id, 5, open_only=True)]
    start = utcnow()
    events = list_event_views(db, user.id, start=start, end=start + timedelta(days=7), limit=4)
    memories = [serialize(r) for r in list_records(db, user.id, "memory")]
    automation_rows = [serialize(row) for row in list_automations(db, user.id)]
    approval_rows = approvals(user, db, 100, 0)
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
    session_id = session.id

    async def events():
        pieces = []
        try:
            async for event in stream_agent(db, user, payload.message, session_id, payload.model):
                if event["type"] == "token":
                    pieces.append(event["content"])
                yield "data: " + json.dumps(event, ensure_ascii=False, default=str) + "\n\n"
            db.add(Message(owner_id=user.id, session_id=session_id, role="assistant", content="".join(pieces)))
            db.commit()
            yield "data: " + json.dumps({"type": "done", "session_id": session_id}) + "\n\n"
        except Exception as exc:
            db.rollback()
            logger.exception("chat_failed session_id=%s error_type=%s", session_id, type(exc).__name__)
            audit(db, user.id, "chat.failed", session_id, {"error_type": type(exc).__name__}, status="failed")
            db.commit()
            yield "data: " + json.dumps({"type": "error", "content": "Model or tool execution failed. Check Activity and model settings", "error_type": type(exc).__name__, "session_id": session_id}) + "\n\n"
    async def leased_events():
        # Publish the persisted session before model work so failure or browser
        # cancellation can recover the same conversation without duplicating it.
        yield "data: " + json.dumps({"type": "session", "session_id": session_id}) + "\n\n"
        try:
            with account_lease(db, user.id):
                async for event in events():
                    yield event
        except HTTPException as exc:
            yield "data: " + json.dumps({"type": "error", "content": exc.detail, "session_id": session_id}) + "\n\n"
    return StreamingResponse(leased_events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Session-ID": session_id})


@app.post("/api/integrations/{item_id}/disconnect", status_code=202)
def request_disconnect(item_id: str, user: Viewer, db: DB):
    row = owned(db, Record, user.id, item_id)
    if row.kind != "integration" or row.data.get("kind") != "mcp":
        raise HTTPException(404, "MCP connection not found")
    approval = request_approval(db, user.id, "record.delete", {"id": item_id, "version": row.version},
                                f"Disconnect MCP: {row.title or row.id}")
    return {"approval_required": True, "approval": serialize(approval)}


@app.post("/api/account/delete", status_code=202)
def request_account_delete(user: Viewer, db: DB, payload: dict = Body(...)):
    if payload.get("confirmation") != "DELETE":
        raise HTTPException(422, "Type DELETE to request account erasure")
    approval = request_approval(db, user.id, "account.delete", {}, "Delete account and personal data")
    return {"approval_required": True, "approval": serialize(approval)}
