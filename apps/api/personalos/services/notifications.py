"""In-app reminders: one notification record per event occurrence and lead time."""
import hashlib
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Record
from personalos.services import recurrence

log = logging.getLogger("personalos.notifications")
HORIZON = timedelta(hours=1)
MAX_LEAD_MINUTES = 10080
SCAN_LIMIT = 200


def dedupe_key(event_id: str, occurrence_start: str, minutes: int) -> str:
    return hashlib.sha256(f"{event_id}|{occurrence_start}|{minutes}".encode()).hexdigest()


def notification_view(row: Record) -> dict:
    data = row.data or {}
    return {"id": row.id, "title": row.title, "body": row.content, "event_id": data.get("event_id"),
            "occurrence_start": data.get("occurrence_start"), "due_at": row.due_at, "status": row.status,
            "created_at": row.created_at}


def list_notifications(db: Session, owner_id: str, status: str | None = None, limit: int = 100,
                       offset: int = 0) -> tuple[list[Record], int]:
    query = select(Record).where(Record.owner_id == owner_id, Record.kind == "notification",
                                 Record.deleted_at.is_(None))
    if status:
        query = query.where(Record.status == status)
    rows = list(db.scalars(query.order_by(Record.due_at.desc(), Record.created_at.desc())
                           .limit(limit).offset(offset)).all())
    unread = db.scalar(select(func.count()).select_from(Record).where(
        Record.owner_id == owner_id, Record.kind == "notification", Record.deleted_at.is_(None),
        Record.status == "unread"))
    return rows, int(unread or 0)


def mark_read(db: Session, owner_id: str, notification_id: str) -> bool:
    row = db.scalar(select(Record).where(Record.id == notification_id, Record.owner_id == owner_id,
                                         Record.kind == "notification", Record.deleted_at.is_(None))
                    .with_for_update())
    if row is None:
        raise HTTPException(404, "Notification not found")
    if row.status != "read":
        row.status = "read"
        row.updated_at = utcnow()
        row.version += 1
    db.commit()
    return True


def mark_all_read(db: Session, owner_id: str) -> int:
    rows = list(db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "notification", Record.deleted_at.is_(None),
        Record.status == "unread").with_for_update()).all())
    now = utcnow()
    for row in rows:
        row.status = "read"
        row.updated_at = now
        row.version += 1
    db.commit()
    return len(rows)


def drop_notifications(db: Session, owner_id: str, event_id: str, *, from_moment: datetime | None = None,
                       occurrence: datetime | None = None) -> int:
    """Remove generated reminders of one event, optionally only one instance or a suffix.

    Callers commit together with the event change so a failed edit keeps its reminders.
    """
    rows = list(db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "notification", Record.deleted_at.is_(None),
        Record.data["event_id"].as_string() == event_id).with_for_update()).all())
    now, removed = utcnow(), 0
    for row in rows:
        stored = (row.data or {}).get("occurrence_start")
        if occurrence is not None:
            if not stored or recurrence.parse_moment(stored) != occurrence:
                continue
        elif from_moment is not None:
            if not stored or recurrence.parse_moment(stored) < from_moment:
                continue
        row.deleted_at = now
        row.version += 1
        removed += 1
    return removed


def _body(occurrence, data: dict, minutes: int) -> str:
    try:
        label = occurrence.start.astimezone(ZoneInfo(data.get("timezone") or "Asia/Shanghai")).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        label = occurrence.start.isoformat()
    location = (data.get("location") or "").strip()
    prefix = "All day" if data.get("all_day") else label
    return f"{prefix} · {minutes} min before" + (f" · {location}" if location else "")


def materialize(db: Session, now: datetime | None = None) -> int:
    """Create the reminders that become due inside the next hour.

    Event rows are claimed with SKIP LOCKED so concurrent workers never duplicate a
    notification that another worker is inserting for the same instance.
    """
    now = now or utcnow()
    due_horizon = now + HORIZON
    event_horizon = due_horizon + timedelta(minutes=MAX_LEAD_MINUTES)
    rows = list(db.scalars(select(Record).where(
        Record.kind == "event", Record.deleted_at.is_(None),
        Record.data["reminders"].as_string().is_not(None),
        Record.start_at < event_horizon,
    ).order_by(Record.start_at.desc()).with_for_update(skip_locked=True).limit(SCAN_LIMIT)).all())
    created = 0
    for row in rows:
        data = row.data or {}
        reminders = [int(minutes) for minutes in data.get("reminders") or []]
        if not reminders or row.start_at is None or row.end_at is None:
            continue
        try:
            occurrences = recurrence.expand(row.start_at, row.end_at, data, now, event_horizon, limit=100)
        except ValueError:
            log.warning("notification_expand_failed event_id=%s", row.id)
            continue
        for occurrence in occurrences:
            for minutes in reminders:
                due_at = occurrence.start - timedelta(minutes=minutes)
                if due_at < now or due_at > due_horizon:
                    continue
                key = dedupe_key(row.id, recurrence.occurrence_key(occurrence.occurrence_start), minutes)
                exists = db.scalar(select(Record.id).where(
                    Record.owner_id == row.owner_id, Record.kind == "notification", Record.deleted_at.is_(None),
                    Record.data["dedupe_key"].as_string() == key).limit(1))
                if exists:
                    continue
                db.add(Record(owner_id=row.owner_id, kind="notification", title=row.title,
                              content=_body(occurrence, data, minutes), status="unread", due_at=due_at,
                              data={"event_id": row.id,
                                    "occurrence_start": recurrence.occurrence_key(occurrence.occurrence_start),
                                    "minutes_before": minutes, "dedupe_key": key,
                                    "calendar_id": data.get("calendar_id")}))
                created += 1
    db.commit()
    return created
