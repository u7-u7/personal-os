"""Execution-bound write intent. Unknown effects are never safe prompt replays."""
import json
import re
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Execution, Record


@dataclass(frozen=True)
class ExecutionScope:
    owner_id: str
    execution_id: str
    claim_token: str


_current: ContextVar[ExecutionScope | None] = ContextVar("personalos_execution_scope", default=None)
MAX_EFFECT_EVENTS = 64


@contextmanager
def execution_scope(owner_id: str, execution_id: str, claim_token: str):
    scope = ExecutionScope(owner_id, execution_id, claim_token)
    existing = _current.get()
    if existing is not None and existing != scope:
        raise HTTPException(409, "Execution scope cannot change during an action")
    token = _current.set(scope)
    try:
        yield
    finally:
        _current.reset(token)


def _scope(owner_id: str) -> ExecutionScope | None:
    scope = _current.get()
    if scope is not None and scope.owner_id != owner_id:
        raise HTTPException(409, "Execution does not belong to this account")
    return scope


def _run(db: Session, scope: ExecutionScope) -> Execution:
    # A caller's identity cache may predate lease recovery or account erasure.
    with db.no_autoflush:
        row = db.scalar(select(Execution).where(
            Execution.id == scope.execution_id, Execution.owner_id == scope.owner_id,
            Execution.claim_token == scope.claim_token, Execution.status == "running",
            Execution.deleted_at.is_(None),
        ).execution_options(populate_existing=True))
    if row is None:
        raise HTTPException(409, "Execution is no longer authorized to write")
    return row


def _save(db: Session, scope: ExecutionScope, row: Execution, extra: dict) -> None:
    changed = db.execute(update(Execution).where(
        Execution.id == scope.execution_id, Execution.owner_id == scope.owner_id,
        Execution.claim_token == scope.claim_token, Execution.status == "running",
        Execution.deleted_at.is_(None), Execution.version == row.version,
    ).values(extra=extra, updated_at=utcnow(), version=Execution.version + 1)
        .execution_options(synchronize_session=False)).rowcount
    if changed != 1:
        db.rollback()
        raise HTTPException(409, "Execution changed before the write was authorized")
    db.commit()
    db.expire(row)


def _valid(marker) -> bool:
    return (isinstance(marker, dict) and type(marker.get("schema")) is int and marker["schema"] == 1
            and marker.get("state") in {"none", "possible", "completed"}
            and type(marker.get("uncertain")) is bool and isinstance(marker.get("events"), list)
            and all(isinstance(event, dict) and event.get("state") in {"started", "completed", "uncertain"}
                    and isinstance(event.get("call_id"), str) and isinstance(event.get("tool"), str)
                    for event in marker["events"]))


def no_effects_proven(extra: dict) -> bool:
    marker = extra.get("effect_safety")
    return (_valid(marker) and marker["state"] == "none" and marker["uncertain"] is False
            and not marker["events"])


def effects_uncertain(extra: dict) -> bool:
    marker = extra.get("effect_safety")
    if not _valid(marker):
        return True
    if marker["uncertain"] or marker["state"] == "possible":
        return True
    if marker["state"] == "none":
        return bool(marker["events"])
    return not marker["events"] or any(event.get("state") != "completed" for event in marker["events"])


def initialize_execution(db: Session, owner_id: str) -> None:
    scope = _scope(owner_id)
    if scope is None:
        return
    row = _run(db, scope)
    marker = row.extra.get("effect_safety")
    if marker is not None:
        if not _valid(marker):
            raise HTTPException(409, "Execution write history is not trustworthy")
        return
    _save(db, scope, row, {**row.extra, "effect_safety": {
        "schema": 1, "state": "none", "uncertain": False, "events": [],
    }})


def _progress(db: Session, scope: ExecutionScope) -> tuple[Execution, dict]:
    row = _run(db, scope)
    marker = row.extra.get("effect_safety")
    if not _valid(marker):
        raise HTTPException(409, "Execution write tracking was not initialized")
    return row, {**marker, "events": [dict(event) for event in marker["events"]]}


def effect_started(db: Session, owner_id: str, tool_name: str, call_id: str) -> None:
    scope = _scope(owner_id)
    if scope is None:
        return
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,200}", call_id) or not re.fullmatch(r"[A-Za-z0-9_]{1,100}", tool_name):
        raise HTTPException(409, "Execution action identifiers are invalid")
    row, marker = _progress(db, scope)
    if len(marker["events"]) >= MAX_EFFECT_EVENTS:
        raise HTTPException(409, "Execution action history is full; no further effects are allowed")
    if any(event.get("call_id") == call_id for event in marker["events"]):
        raise HTTPException(409, "An execution action cannot be replayed")
    marker["state"] = "possible"
    marker["events"].append({"tool": tool_name, "call_id": call_id, "state": "started",
                             "started_at": utcnow().isoformat()})
    # Commit intent before any tool can commit its own independent transaction.
    _save(db, scope, row, {**row.extra, "effect_safety": marker})


def _references(result: str | dict | None) -> dict:
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (ValueError, TypeError):
            return {}
    if not isinstance(result, dict):
        return {}
    refs = {}
    for name in ("id", "approval_id"):
        value = result.get(name)
        if isinstance(value, str):
            try:
                refs[name] = str(uuid.UUID(value))
            except ValueError:
                continue
    return refs


def effect_finished(db: Session, owner_id: str, call_id: str, result: str | dict | None = None,
                    failed: bool = False) -> None:
    scope = _scope(owner_id)
    if scope is None:
        return
    row, marker = _progress(db, scope)
    event = next((item for item in marker["events"] if item.get("call_id") == call_id), None)
    if event is None:
        raise HTTPException(409, "Execution action has no durable write intent")
    event.update(state="uncertain" if failed else "completed", finished_at=utcnow().isoformat())
    event["refs"] = {**event.get("refs", {}), **_references(result)}
    marker["uncertain"] = marker["uncertain"] or failed
    marker["state"] = "completed" if all(item["state"] == "completed" for item in marker["events"]) else "possible"
    _save(db, scope, row, {**row.extra, "effect_safety": marker})


def link_session(db: Session, owner_id: str, session_id: str) -> None:
    scope = _scope(owner_id)
    if scope is None:
        return
    row = _run(db, scope)
    session = db.scalar(select(Record.id).where(Record.id == session_id, Record.owner_id == owner_id,
                                              Record.kind == "chat_session", Record.deleted_at.is_(None)))
    if session is None:
        raise HTTPException(409, "Execution conversation does not belong to this account")
    if row.extra.get("session_id") not in (None, session_id):
        raise HTTPException(409, "Execution conversation cannot change during an action")
    _save(db, scope, row, {**row.extra, "session_id": session_id})


def assert_replay_safe(db: Session, owner_id: str, automation_id: str, *, retry: bool = False,
                       allow_inflight: bool = False) -> None:
    # The API owns the parent NOWAIT lock. Never lock executions here: the
    # Worker may already hold one while examining its parent schedule.
    query = select(Execution.status, Execution.extra["effect_safety"].label("safety")).where(
        Execution.owner_id == owner_id, Execution.automation_id == automation_id,
        Execution.deleted_at.is_(None),
    ).order_by(Execution.created_at.desc(), Execution.id.desc())
    latest = None
    with db.execute(query.execution_options(yield_per=200)) as rows:
        for row in rows:
            if latest is None:
                latest = row
            safe = no_effects_proven({"effect_safety": row.safety})
            if (row.status == "outcome_unknown" or
                    (not allow_inflight and row.status in {"pending", "queued", "running"}) or
                    (row.status == "failed" and not safe)):
                raise HTTPException(409, "Reconcile existing execution effects before scheduling another run")
    if retry and (latest is None or latest.status != "failed" or not no_effects_proven({"effect_safety": latest.safety})):
        raise HTTPException(409, "Only a failed execution with no business effects can be retried")
