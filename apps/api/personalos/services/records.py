from datetime import datetime
import hashlib
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Record
from personalos.services.accounts import assert_account_writable


def serialize(row: Any) -> dict:
    result = {column.name: getattr(row, column.name) for column in row.__table__.columns}
    data = result.pop("data", {})
    result.pop("owner_id", None)
    result.update(data)
    return result


def owned(db: Session, model, owner_id: str, record_id: str):
    row = db.scalar(select(model).where(model.id == record_id, model.owner_id == owner_id,
                                        model.deleted_at.is_(None)))
    if row is None:
        raise HTTPException(404, "Item not found")
    return row


def list_records(db: Session, owner_id: str, kind: str, limit: int = 100, offset: int = 0):
    return db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == kind,
                     Record.deleted_at.is_(None)).order_by(Record.created_at.desc()).limit(limit).offset(offset)).all()


def list_events(db: Session, owner_id: str, limit: int = 100, offset: int = 0, *,
                start: datetime | None = None, end: datetime | None = None) -> list[Record]:
    if start is None and end is None:
        return list_records(db, owner_id, "event", limit, offset)
    if start is None or end is None:
        raise HTTPException(422, "Provide both calendar window start and end")
    if start.utcoffset() is None or end.utcoffset() is None:
        raise HTTPException(422, "Calendar window start and end must include a timezone")
    if start >= end:
        raise HTTPException(422, "Calendar window start must be before end")
    # Filter before pagination so older-created events inside the visible window
    # are not hidden by unrelated recent records. Endpoints are half-open.
    return list(db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "event", Record.deleted_at.is_(None),
        Record.start_at < end, Record.end_at > start,
    ).order_by(Record.start_at, Record.id).limit(limit).offset(offset)).all())


def audit(db: Session, owner_id: str, action: str, target_id: str = "", details: dict | None = None,
          status: str = "succeeded") -> Record:
    try:
        assert_account_writable(db, owner_id)
    except HTTPException as exc:
        if exc.status_code == 410:
            return None
        raise
    row = Record(owner_id=owner_id, kind="activity", title=action, status=status,
                 data={"action": action, "target_id": target_id, "details": details or {}})
    db.add(row)
    return row


def cas_update(db: Session, model, owner_id: str, item_id: str, version: int, changes: dict):
    assert_account_writable(db, owner_id)
    row = owned(db, model, owner_id, item_id)
    changes.update(version=version + 1, updated_at=utcnow())
    # Version comparison is in the database UPDATE so parallel requests cannot silently overwrite.
    result = db.execute(update(model).where(model.id == item_id, model.owner_id == owner_id,
                         model.version == version, model.deleted_at.is_(None)).values(**changes))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Item changed. Refresh before saving again")
    db.expire(row)
    return row


def create_record(db: Session, owner_id: str, kind: str, values: dict):
    assert_account_writable(db, owner_id)
    columns = {"title", "content", "status", "priority", "due_at", "start_at", "end_at", "extra"}
    row = Record(owner_id=owner_id, kind=kind,
                 **{key: value for key, value in values.items() if key in columns},
                 data={key: value for key, value in values.items() if key not in columns})
    db.add(row)
    db.flush()
    audit(db, owner_id, f"{kind}.created", row.id)
    db.commit()
    return row


def patch_record(db: Session, owner_id: str, kind: str, record_id: str, version: int, values: dict):
    row = owned(db, Record, owner_id, record_id)
    if row.kind != kind:
        raise HTTPException(404, "Item not found")
    columns = {"title", "content", "status", "priority", "due_at", "start_at", "end_at", "extra"}
    changes = {key: value for key, value in values.items() if key in columns}
    changes["data"] = {**row.data, **{key: value for key, value in values.items() if key not in columns}}
    row = cas_update(db, Record, owner_id, record_id, version, changes)
    audit(db, owner_id, f"{kind}.updated", record_id)
    db.commit()
    return row


def ensure_no_conflict(db: Session, owner_id: str, start_at: datetime, end_at: datetime,
                       exclude_id: str = "") -> None:
    # The conflict read and subsequent write share a per-owner transaction fence.
    # A nonblocking try avoids an async route waiting synchronously on a sibling
    # request that is currently checking a remote calendar on the same event loop.
    key = int.from_bytes(hashlib.sha256(f"personalos-calendar:{owner_id}".encode()).digest()[:8], "big", signed=True)
    if not db.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": key}):
        raise HTTPException(409, "Calendar is being modified. Refresh and retry")
    conflict = db.scalar(select(Record.id).where(Record.owner_id == owner_id, Record.kind == "event",
                         Record.deleted_at.is_(None), Record.id != exclude_id,
                         Record.start_at < end_at, Record.end_at > start_at).limit(1))
    if conflict:
        raise HTTPException(409, {"message": "Calendar conflict", "event_id": conflict})
