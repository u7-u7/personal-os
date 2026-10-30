"""Local calendar service: calendars, events and recurrence scopes.

One Record table stays the only business table: a calendar is a ``calendar`` row and
an event is an ``event`` row whose ``data`` carries recurrence, reminders and the
per-occurrence overrides produced by scoped edits.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Record
from personalos.schemas import EventInput
from personalos.services import notifications, recurrence
from personalos.services.records import (audit, create_record, ensure_no_conflict, list_records, serialize)

PALETTE = ("blue", "green", "orange", "red", "purple", "yellow", "pink", "teal", "brown", "gray")
DEFAULT_CALENDAR_NAME = "个人"
DEFAULT_TIMEZONE = "Asia/Shanghai"
OVERRIDE_FIELDS = ("title", "content", "location", "all_day")


def _zone(name: str | None) -> ZoneInfo:
    try:
        return recurrence.resolve_timezone(name)
    except recurrence.RecurrenceError as exc:
        raise HTTPException(422, str(exc)) from exc


def _moment(value) -> datetime:
    try:
        return recurrence.parse_moment(value)
    except recurrence.RecurrenceError as exc:
        raise HTTPException(422, str(exc)) from exc


def calendar_view(row: Record) -> dict:
    data = row.data or {}
    return {"id": row.id, "name": row.title or data.get("name", ""), "color": data.get("color") or PALETTE[0],
            "position": int(data.get("position") or 0), "is_default": bool(data.get("is_default")),
            "visible": bool(data.get("visible", True)), "version": row.version}


def _calendar_rows(db: Session, owner_id: str) -> list[Record]:
    return list(db.scalars(select(Record).where(Record.owner_id == owner_id, Record.kind == "calendar",
                                                Record.deleted_at.is_(None)).order_by(Record.created_at)).all())


def default_calendar(db: Session, owner_id: str) -> Record | None:
    return next((row for row in _calendar_rows(db, owner_id) if (row.data or {}).get("is_default")), None)


def ensure_default_calendar(db: Session, owner_id: str) -> Record:
    existing = default_calendar(db, owner_id)
    if existing is not None:
        return existing
    return create_record(db, owner_id, "calendar", {"name": DEFAULT_CALENDAR_NAME, "color": PALETTE[0],
                                                   "position": 0, "is_default": True, "visible": True})


def list_calendars(db: Session, owner_id: str) -> list[Record]:
    ensure_default_calendar(db, owner_id)
    return sorted(_calendar_rows(db, owner_id),
                  key=lambda row: (int((row.data or {}).get("position") or 0), row.created_at))


def _owned_calendar(db: Session, owner_id: str, calendar_id: str, *, lock: bool = False) -> Record:
    query = select(Record).where(Record.id == calendar_id, Record.owner_id == owner_id,
                                 Record.kind == "calendar", Record.deleted_at.is_(None))
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, "Calendar not found")
    return row


def _color(value: str | None) -> str:
    color = (value or "").strip().lower()
    if color not in PALETTE:
        raise HTTPException(422, "Use one of the calendar colors: " + ", ".join(PALETTE))
    return color


def create_calendar(db: Session, owner_id: str, payload) -> Record:
    color = _color(payload.color)
    ensure_default_calendar(db, owner_id)
    position = int(db.scalar(select(func.count()).select_from(Record).where(
        Record.owner_id == owner_id, Record.kind == "calendar", Record.deleted_at.is_(None))) or 0)
    return create_record(db, owner_id, "calendar", {"name": payload.name.strip(), "color": color,
                                                   "position": position, "is_default": False, "visible": True})


def update_calendar(db: Session, owner_id: str, calendar_id: str, payload) -> Record:
    row = _owned_calendar(db, owner_id, calendar_id, lock=True)
    data = dict(row.data or {})
    if payload.name is not None:
        data["name"] = payload.name.strip()
        row.title = data["name"]
    if payload.color is not None:
        data["color"] = _color(payload.color)
    if payload.position is not None:
        data["position"] = payload.position
    if payload.visible is not None:
        data["visible"] = payload.visible
    row.data = data
    row.updated_at = utcnow()
    row.version += 1
    audit(db, owner_id, "calendar.updated", row.id)
    db.commit()
    return row


def delete_calendar(db: Session, owner_id: str, calendar_id: str, *, move_to: str | None = None) -> dict:
    row = _owned_calendar(db, owner_id, calendar_id, lock=True)
    if (row.data or {}).get("is_default"):
        raise HTTPException(409, "The default calendar cannot be deleted")
    if len(_calendar_rows(db, owner_id)) <= 1:
        raise HTTPException(409, "Keep at least one calendar")
    events = list(db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "event", Record.deleted_at.is_(None),
        Record.data["calendar_id"].as_string() == row.id)).all())
    moved = 0
    if events:
        if not move_to:
            raise HTTPException(409, {"message": "Calendar is not empty; pass move_to=<calendar_id>",
                                      "events": len(events)})
        if move_to == row.id:
            raise HTTPException(422, "move_to must reference another calendar")
        target = _owned_calendar(db, owner_id, move_to, lock=True)
        now = utcnow()
        for event in events:
            event.data = {**(event.data or {}), "calendar_id": target.id}
            event.updated_at = now
            event.version += 1
            moved += 1
    now = utcnow()
    row.deleted_at = now
    row.updated_at = now
    row.version += 1
    audit(db, owner_id, "calendar.deleted", row.id, {"moved_events": moved})
    db.commit()
    return {"deleted": True, "moved_events": moved}


def resolve_calendar(db: Session, owner_id: str, calendar_id: str | None) -> Record:
    if calendar_id:
        return _owned_calendar(db, owner_id, calendar_id)
    return ensure_default_calendar(db, owner_id)


def _clean_exdates(raw) -> list[str]:
    return sorted({recurrence.occurrence_key(_moment(value)) for value in raw or []})


def _canonical_overrides(raw) -> dict:
    result = {}
    for key, value in (raw or {}).items():
        item = value if isinstance(value, dict) else value.model_dump()
        if not item.get("start_at") or not item.get("end_at"):
            raise HTTPException(422, "An event override needs start_at and end_at")
        entry = {field: item[field] for field in OVERRIDE_FIELDS if item.get(field) is not None}
        entry["start_at"] = recurrence.occurrence_key(_moment(item["start_at"]))
        entry["end_at"] = recurrence.occurrence_key(_moment(item["end_at"]))
        result[recurrence.occurrence_key(_moment(key))] = entry
    return result


def _event_data(values: dict, calendar_id: str, *, overrides=None, exdates=None) -> dict:
    return {"calendar_id": calendar_id, "location": values.get("location") or "",
            "all_day": bool(values.get("all_day")), "timezone": values.get("timezone") or DEFAULT_TIMEZONE,
            "rrule": values.get("rrule"),
            "exdates": _clean_exdates(values.get("exdates")) if exdates is None else exdates,
            "overrides": _canonical_overrides(values.get("overrides")) if overrides is None else overrides,
            "reminders": sorted({int(minutes) for minutes in values.get("reminders") or []}),
            "provider": "local"}


def event_view(row: Record, occurrence: recurrence.Occurrence | None = None,
               fallback_timezone: str = DEFAULT_TIMEZONE) -> dict:
    data = row.data or {}
    recurring = bool(data.get("rrule"))
    view = serialize(row)
    if occurrence is not None:
        view["start_at"], view["end_at"] = occurrence.start, occurrence.end
    overridden = bool(occurrence and occurrence.override)
    moved = overridden and occurrence.start != occurrence.occurrence_start
    view.update({
        "calendar_id": data.get("calendar_id"), "location": data.get("location") or "",
        "all_day": bool(data.get("all_day")), "timezone": data.get("timezone") or fallback_timezone,
        "rrule": data.get("rrule"), "exdates": list(data.get("exdates") or []),
        "overrides": dict(data.get("overrides") or {}),
        "reminders": [int(minutes) for minutes in data.get("reminders") or []], "provider": "local",
        "recurring": recurring, "occurrence_start": occurrence.occurrence_start if occurrence else row.start_at,
        "recurrence_id": row.id if recurring else None, "is_override": overridden,
        # An exception is an instance whose edited time no longer matches its rule position.
        "is_exception": moved,
    })
    if overridden:
        # A single edited occurrence presents its own title, text, place and length.
        for field in OVERRIDE_FIELDS:
            if occurrence.override.get(field) is not None:
                view[field] = occurrence.override[field]
    return view


def list_event_views(db: Session, owner_id: str, *, start: datetime | None = None, end: datetime | None = None,
                     timezone: str | None = None, limit: int | None = None, offset: int = 0) -> list[dict]:
    if start is None and end is None:
        rows = list_records(db, owner_id, "event", 100 if limit is None else limit, offset)
        return [event_view(row) for row in rows]
    if start is None or end is None:
        raise HTTPException(422, "Provide both calendar window start and end")
    if start.utcoffset() is None or end.utcoffset() is None:
        raise HTTPException(422, "Calendar window start and end must include a timezone")
    if start >= end:
        raise HTTPException(422, "Calendar window start must be before end")
    fallback = (_zone(timezone).key if timezone else DEFAULT_TIMEZONE)
    rows = db.scalars(select(Record).where(
        Record.owner_id == owner_id, Record.kind == "event", Record.deleted_at.is_(None),
        Record.start_at < end,
        # A series that began long before the window still owns instances inside it.
        or_(Record.end_at > start, Record.data["rrule"].as_string().is_not(None)),
    ).order_by(Record.start_at, Record.id)).all()
    views: list[dict] = []
    for row in rows:
        data = row.data or {}
        if not data.get("rrule"):
            if row.end_at is not None and row.end_at > start:
                views.append(event_view(row, fallback_timezone=fallback))
            continue
        try:
            occurrences = recurrence.expand(row.start_at, row.end_at or row.start_at, data, start, end,
                                            fallback_timezone=fallback)
        except recurrence.RecurrenceError as exc:
            raise HTTPException(422, f"Event {row.id} has an unusable recurrence: {exc}") from exc
        views.extend(event_view(row, occurrence, fallback_timezone=fallback) for occurrence in occurrences)
    views.sort(key=lambda item: (item["start_at"], item["id"]))
    return views[:limit] if limit is not None else views


def create_event(db: Session, owner_id: str, payload: EventInput) -> dict:
    values = payload.model_dump()
    zone = _zone(values.get("timezone"))
    start_at, end_at = recurrence.normalize_range(values["start_at"], values["end_at"], zone, values["all_day"])
    calendar = resolve_calendar(db, owner_id, values.get("calendar_id"))
    ensure_no_conflict(db, owner_id, start_at, end_at)
    row = create_record(db, owner_id, "event", {
        "title": values["title"], "content": values["content"], "start_at": start_at, "end_at": end_at,
        "extra": values.get("extra") or {},
        **_event_data({**values, "timezone": zone.key}, calendar.id)})
    return event_view(row)


def _locked_event(db: Session, owner_id: str, event_id: str) -> Record:
    row = db.scalar(select(Record).where(Record.id == event_id, Record.owner_id == owner_id,
                                         Record.kind == "event", Record.deleted_at.is_(None)).with_for_update())
    if row is None:
        raise HTTPException(404, "Event not found")
    return row


def _check_version(row: Record, payload: dict) -> None:
    version = payload.get("version")
    if version is None:
        return
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise HTTPException(422, "A positive version is required")
    if version != row.version:
        raise HTTPException(409, "Item changed. Refresh before saving again")


def _update_base(db: Session, owner_id: str, row: Record, payload: dict) -> Record:
    values = EventInput.model_validate({**serialize(row), **payload}).model_dump()
    zone = _zone(values.get("timezone"))
    start_at, end_at = recurrence.normalize_range(values["start_at"], values["end_at"], zone, values["all_day"])
    calendar = resolve_calendar(db, owner_id, values.get("calendar_id"))
    ensure_no_conflict(db, owner_id, start_at, end_at, row.id)
    row.title, row.content = values["title"], values["content"]
    row.start_at, row.end_at = start_at, end_at
    row.extra = values.get("extra") or {}
    row.data = _event_data({**values, "timezone": zone.key}, calendar.id)
    row.updated_at = utcnow()
    row.version += 1
    audit(db, owner_id, "event.updated", row.id)
    db.commit()
    return row


def _split_duration(row: Record, zone: ZoneInfo) -> timedelta:
    if (row.data or {}).get("all_day"):
        days = (row.end_at.astimezone(zone).date() - row.start_at.astimezone(zone).date()).days
        return timedelta(days=max(days, 1))
    return row.end_at - row.start_at


def _apply_override(db: Session, owner_id: str, row: Record, payload: dict, split: datetime, zone: ZoneInfo) -> dict:
    data = dict(row.data or {})
    key = recurrence.occurrence_key(split)
    if key in set(data.get("exdates") or []):
        raise HTTPException(409, "This occurrence was deleted; edit the series instead")
    occurrences = recurrence.instance_at(row.start_at, row.end_at, data, split)
    if occurrences is None:
        raise HTTPException(404, "Occurrence is not part of this event")
    current = occurrences
    edited = dict(current.override or {})
    for field in OVERRIDE_FIELDS:
        if field in payload:
            edited[field] = payload[field]
    all_day = bool(edited.get("all_day", data.get("all_day")))
    start_at = _moment(payload["start_at"]) if payload.get("start_at") else current.start
    end_at = _moment(payload["end_at"]) if payload.get("end_at") else current.end
    start_at, end_at = recurrence.normalize_range(start_at, end_at, zone, all_day)
    if end_at <= start_at:
        raise HTTPException(422, "end_at must be after start_at")
    ensure_no_conflict(db, owner_id, start_at, end_at, row.id)
    overrides = dict(data.get("overrides") or {})
    overrides[key] = {"title": edited.get("title", row.title),
                      "content": edited.get("content", row.content),
                      "location": edited.get("location", data.get("location") or ""),
                      "all_day": all_day,
                      "start_at": recurrence.occurrence_key(start_at),
                      "end_at": recurrence.occurrence_key(end_at)}
    data["overrides"] = overrides
    row.data = data
    row.updated_at = utcnow()
    row.version += 1
    audit(db, owner_id, "event.occurrence_updated", row.id, {"occurrence_start": key})
    db.commit()
    return event_view(row, recurrence.Occurrence(start_at, end_at, current.occurrence_start, overrides[key]))


def _split_following(db: Session, owner_id: str, row: Record, payload: dict, split: datetime,
                     zone: ZoneInfo, index: int) -> dict:
    data = dict(row.data or {})
    parts = recurrence.parse_rrule(data.get("rrule"))
    merged = {**serialize(row), **payload}
    if payload.get("start_at") is None:
        merged["start_at"] = split
    if payload.get("end_at") is None:
        merged["end_at"] = split + _split_duration(row, zone)
    merged["rrule"] = recurrence.rule_text(recurrence.remainder_parts(parts, index)) or None
    merged["exdates"] = [value for value in (data.get("exdates") or []) if _moment(value) >= split]
    merged["overrides"] = {key: value for key, value in (data.get("overrides") or {}).items()
                           if _moment(key) >= split}
    values = EventInput.model_validate(merged).model_dump()
    new_zone = _zone(values.get("timezone"))
    start_at, end_at = recurrence.normalize_range(values["start_at"], values["end_at"], new_zone, values["all_day"])
    calendar = resolve_calendar(db, owner_id, values.get("calendar_id"))
    ensure_no_conflict(db, owner_id, start_at, end_at, row.id)
    data["rrule"] = recurrence.rule_text(recurrence.truncated_parts(parts, split))
    data["exdates"] = [value for value in (data.get("exdates") or []) if _moment(value) < split]
    data["overrides"] = {key: value for key, value in (data.get("overrides") or {}).items()
                         if _moment(key) < split}
    row.data = data
    row.updated_at = utcnow()
    row.version += 1
    notifications.drop_notifications(db, owner_id, row.id, from_moment=split)
    created = create_record(db, owner_id, "event", {
        "title": values["title"], "content": values["content"], "start_at": start_at, "end_at": end_at,
        "extra": values.get("extra") or {},
        **_event_data({**values, "timezone": new_zone.key}, calendar.id)})
    audit(db, owner_id, "event.split", row.id, {"occurrence_start": recurrence.occurrence_key(split),
                                               "new_event_id": created.id})
    db.commit()
    return event_view(created)


def update_event(db: Session, owner_id: str, event_id: str, payload: dict, *, scope: str = "all",
                 occurrence_start: datetime | None = None) -> dict:
    row = _locked_event(db, owner_id, event_id)
    _check_version(row, payload)
    data = row.data or {}
    recurring = bool(data.get("rrule"))
    if scope in {"this", "following"} and occurrence_start is None:
        raise HTTPException(422, "occurrence_start is required for this scope")
    if scope == "all" or not recurring:
        return event_view(_update_base(db, owner_id, row, payload))
    zone = _zone(data.get("timezone"))
    split = _moment(occurrence_start)
    index = recurrence.occurrence_index(row.start_at, data, split, zone)
    if index < 0:
        raise HTTPException(404, "Occurrence is not part of this event")
    if scope == "this":
        return _apply_override(db, owner_id, row, payload, split, zone)
    if index == 0:
        return event_view(_update_base(db, owner_id, row, payload))
    return _split_following(db, owner_id, row, payload, split, zone, index)


def _delete_series(db: Session, owner_id: str, row: Record) -> dict:
    now = utcnow()
    row.deleted_at = now
    row.updated_at = now
    row.version += 1
    notifications.drop_notifications(db, owner_id, row.id)
    audit(db, owner_id, "event.deleted", row.id)
    db.commit()
    return {"deleted": True}


def delete_event(db: Session, owner_id: str, event_id: str, *, scope: str = "all",
                 occurrence_start: datetime | None = None, version: int | None = None) -> dict:
    row = _locked_event(db, owner_id, event_id)
    if version is not None and version != row.version:
        raise HTTPException(409, "Item changed. Refresh before deleting")
    data = dict(row.data or {})
    recurring = bool(data.get("rrule"))
    if scope in {"this", "following"} and occurrence_start is None:
        raise HTTPException(422, "occurrence_start is required for this scope")
    if scope == "all" or not recurring:
        return _delete_series(db, owner_id, row)
    zone = _zone(data.get("timezone"))
    split = _moment(occurrence_start)
    index = recurrence.occurrence_index(row.start_at, data, split, zone)
    if index < 0:
        raise HTTPException(404, "Occurrence is not part of this event")
    key = recurrence.occurrence_key(split)
    if scope == "this":
        data["exdates"] = sorted({*(data.get("exdates") or []), key})
        overrides = dict(data.get("overrides") or {})
        overrides.pop(key, None)
        data["overrides"] = overrides
        now = utcnow()
        row.data = data
        row.updated_at = now
        row.version += 1
        notifications.drop_notifications(db, owner_id, row.id, occurrence=split)
        audit(db, owner_id, "event.occurrence_deleted", row.id, {"occurrence_start": key})
        db.commit()
        return {"deleted": True}
    if index == 0:
        return _delete_series(db, owner_id, row)
    parts = recurrence.parse_rrule(data.get("rrule"))
    data["rrule"] = recurrence.rule_text(recurrence.truncated_parts(parts, split))
    data["exdates"] = [value for value in (data.get("exdates") or []) if _moment(value) < split]
    data["overrides"] = {item: value for item, value in (data.get("overrides") or {}).items()
                         if _moment(item) < split}
    now = utcnow()
    row.data = data
    row.updated_at = now
    row.version += 1
    notifications.drop_notifications(db, owner_id, row.id, from_moment=split)
    audit(db, owner_id, "event.truncated", row.id, {"occurrence_start": key})
    db.commit()
    return {"deleted": True}
