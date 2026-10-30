"""RFC5545 recurrence subset: validation, expansion and scoped-edit helpers.

Recurrence math runs in the event's own IANA timezone so wall-clock times survive
DST transitions: a 09:00 daily meeting stays at 09:00 local time.
"""
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dateutil.rrule import rrulestr

FREQUENCIES = ("DAILY", "WEEKLY", "MONTHLY", "YEARLY")
SUPPORTED_PARTS = ("FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY")
WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
UTC = timezone.utc
# Guard against a client asking for a window it cannot render.
MAX_INSTANCES = 500


class RecurrenceError(ValueError):
    """Raised when a rule or timestamp cannot be interpreted."""


@dataclass(frozen=True)
class Occurrence:
    start: datetime
    end: datetime
    occurrence_start: datetime
    override: dict | None = None

    @property
    def is_override(self) -> bool:
        return self.override is not None


def occurrence_key(moment: datetime) -> str:
    """Stable identifier for one instance of a series."""
    return as_utc(moment).isoformat()


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        # Naive input is treated as UTC rather than the server's local zone.
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_moment(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return as_utc(value)
    try:
        return as_utc(datetime.fromisoformat(str(value).strip().replace("Z", "+00:00")))
    except ValueError as exc:
        raise RecurrenceError("Occurrence timestamps must be ISO datetimes") from exc


def resolve_timezone(name: str | None, fallback: str = "Asia/Shanghai") -> ZoneInfo:
    try:
        return ZoneInfo(name or fallback)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise RecurrenceError("Unknown IANA timezone") from exc


def parse_rrule(value: str | None) -> dict[str, str]:
    """Validate the supported subset and return its uppercase parts."""
    if value is None or not str(value).strip():
        return {}
    text = str(value).strip()
    if text.upper().startswith("RRULE:"):
        text = text[6:]
    parts: dict[str, str] = {}
    for chunk in text.split(";"):
        if not chunk.strip():
            continue
        key, _, raw = chunk.partition("=")
        key, raw = key.strip().upper(), raw.strip().upper()
        if key not in SUPPORTED_PARTS:
            raise RecurrenceError("rrule supports only FREQ, INTERVAL, COUNT, UNTIL and BYDAY")
        if key in parts:
            raise RecurrenceError("rrule repeats a part")
        parts[key] = raw
    if parts.get("FREQ") not in FREQUENCIES:
        raise RecurrenceError("rrule FREQ must be DAILY, WEEKLY, MONTHLY or YEARLY")
    if "INTERVAL" in parts:
        parts["INTERVAL"] = str(_positive_int(parts["INTERVAL"], "INTERVAL"))
    if "COUNT" in parts:
        parts["COUNT"] = str(_positive_int(parts["COUNT"], "COUNT"))
    if "COUNT" in parts and "UNTIL" in parts:
        raise RecurrenceError("rrule cannot combine COUNT and UNTIL")
    if "UNTIL" in parts:
        parts["UNTIL"] = compact_until(parse_until(parts["UNTIL"]))
    if "BYDAY" in parts:
        if parts["FREQ"] != "WEEKLY":
            raise RecurrenceError("rrule BYDAY is supported only for WEEKLY rules")
        days = [day.strip() for day in parts["BYDAY"].split(",") if day.strip()]
        if not days or any(day not in WEEKDAYS for day in days):
            raise RecurrenceError("rrule BYDAY accepts weekday codes such as MO,WE")
        parts["BYDAY"] = ",".join(days)
    return parts


def _positive_int(raw: str, name: str) -> int:
    try:
        number = int(raw)
    except ValueError as exc:
        raise RecurrenceError(f"rrule {name} must be a positive integer") from exc
    if number < 1:
        raise RecurrenceError(f"rrule {name} must be a positive integer")
    return number


def parse_until(raw: str) -> datetime:
    text = raw.strip().upper()
    if text.endswith("Z") and "T" in text and "-" not in text:
        try:
            return datetime.strptime(text, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        except ValueError as exc:
            raise RecurrenceError("rrule UNTIL must be a UTC timestamp such as 20300101T000000Z") from exc
    try:
        return as_utc(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError as exc:
        raise RecurrenceError("rrule UNTIL must be a UTC timestamp such as 20300101T000000Z") from exc


def compact_until(moment: datetime) -> str:
    return as_utc(moment).strftime("%Y%m%dT%H%M%SZ")


def rule_text(parts: dict[str, str]) -> str:
    order = ("FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY")
    return ";".join(f"{key}={parts[key]}" for key in order if key in parts)


def truncated_parts(parts: dict[str, str], before: datetime) -> dict[str, str]:
    """Keep occurrences strictly before ``before`` by closing the rule with UNTIL."""
    closed = {key: value for key, value in parts.items() if key != "COUNT"}
    closed["UNTIL"] = compact_until(as_utc(before) - timedelta(seconds=1))
    return closed


def remainder_parts(parts: dict[str, str], consumed: int) -> dict[str, str]:
    """Remaining rule for a continuation event split at ``consumed`` instances."""
    remaining = dict(parts)
    if "COUNT" in remaining:
        left = int(remaining["COUNT"]) - consumed
        if left < 1:
            left = 1
        remaining["COUNT"] = str(left)
    return remaining


def local_start(moment: datetime, zone: ZoneInfo, all_day: bool) -> datetime:
    local = as_utc(moment).astimezone(zone)
    if not all_day:
        return local
    # All-day rows occupy whole local days and start at local midnight.
    return datetime.combine(local.date(), time.min, tzinfo=zone)


def all_day_range(start_at: datetime, end_at: datetime, zone: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(as_utc(start_at).astimezone(zone).date(), time.min, tzinfo=zone)
    end_date = as_utc(end_at).astimezone(zone).date()
    if end_date <= start.date():
        end_date = start.date() + timedelta(days=1)
    end = datetime.combine(end_date, time.min, tzinfo=zone)
    return start, end


def normalize_range(start_at: datetime, end_at: datetime, zone: ZoneInfo, all_day: bool) -> tuple[datetime, datetime]:
    if all_day:
        return all_day_range(start_at, end_at, zone)
    return as_utc(start_at), as_utc(end_at)


def _duration(start_local: datetime, end_local: datetime, all_day: bool) -> timedelta:
    if all_day:
        return timedelta(days=(end_local.date() - start_local.date()).days)
    # Nominal wall-clock length: an 09:00-10:00 meeting stays one hour across DST.
    return end_local.replace(tzinfo=None) - start_local.replace(tzinfo=None)


def _instance(occ_local: datetime, zone: ZoneInfo, duration: timedelta, all_day: bool) -> tuple[datetime, datetime]:
    if all_day:
        start = datetime.combine(occ_local.date(), time.min, tzinfo=zone)
        end = datetime.combine(occ_local.date() + timedelta(days=max(duration.days, 1)), time.min, tzinfo=zone)
        return as_utc(start), as_utc(end)
    # Wall-clock arithmetic keeps the nominal length across a DST change.
    end_local = (occ_local.replace(tzinfo=None) + duration).replace(tzinfo=zone)
    return as_utc(occ_local), as_utc(end_local)


def build_rule(rule_parts: dict[str, str], dtstart_local: datetime):
    return rrulestr(f"RRULE:{rule_text(rule_parts)}", dtstart=dtstart_local)


def occurrence_index(start_at: datetime, data: dict, moment: datetime, zone: ZoneInfo) -> int:
    """Position of ``moment`` inside the series, or -1 when it is not an instance."""
    rule_parts = parse_rrule(data.get("rrule"))
    if not rule_parts:
        return 0 if occurrence_key(start_at) == occurrence_key(moment) else -1
    all_day = bool(data.get("all_day"))
    dtstart_local = local_start(start_at, zone, all_day)
    target = as_utc(moment)
    rule = build_rule(rule_parts, dtstart_local)
    for index, occ in enumerate(rule.between(dtstart_local, target.astimezone(zone), inc=True)):
        if occurrence_key(occ) == occurrence_key(target):
            return index
    return -1


def _series_shape(start_at: datetime, end_at: datetime, data: dict, fallback_timezone: str):
    zone = resolve_timezone(data.get("timezone") or fallback_timezone)
    all_day = bool(data.get("all_day"))
    start_local = local_start(start_at, zone, all_day)
    end_local = local_start(end_at, zone, all_day) if all_day else as_utc(end_at).astimezone(zone)
    return zone, all_day, start_local, _duration(start_local, end_local, all_day)


def _override_map(data: dict) -> tuple[dict, set[str]]:
    overrides = {occurrence_key(parse_moment(key)): value for key, value in (data.get("overrides") or {}).items()}
    exdates = {occurrence_key(parse_moment(value)) for value in (data.get("exdates") or [])}
    return overrides, exdates


def instance_at(start_at: datetime, end_at: datetime, data: dict, moment: datetime,
                fallback_timezone: str = "Asia/Shanghai") -> Occurrence | None:
    """The rule instance positioned exactly at ``moment``, with any override applied."""
    zone, all_day, start_local, duration = _series_shape(start_at, end_at, data, fallback_timezone)
    overrides, _ = _override_map(data)
    target = as_utc(moment)
    key = occurrence_key(target)
    rule_parts = parse_rrule(data.get("rrule"))
    if not rule_parts:
        start, end = _instance(start_local, zone, duration, all_day)
        return Occurrence(start, end, start) if occurrence_key(start) == key else None
    for occ_local in build_rule(rule_parts, start_local).between(start_local, target.astimezone(zone), inc=True):
        if occurrence_key(occ_local) != key:
            continue
        base_start, base_end = _instance(occ_local, zone, duration, all_day)
        override = overrides.get(key)
        if override:
            return Occurrence(parse_moment(override["start_at"]), parse_moment(override["end_at"]),
                              base_start, override)
        return Occurrence(base_start, base_end, base_start)
    return None


def expand(start_at: datetime, end_at: datetime, data: dict, window_start: datetime, window_end: datetime,
           *, fallback_timezone: str = "Asia/Shanghai", limit: int = MAX_INSTANCES) -> list[Occurrence]:
    """Instances intersecting the half-open window, overrides applied, exdates removed."""
    zone, all_day, start_local, duration = _series_shape(start_at, end_at, data, fallback_timezone)
    window_from, window_to = as_utc(window_start), as_utc(window_end)
    overrides, exdates = _override_map(data)
    rule_parts = parse_rrule(data.get("rrule"))
    if not rule_parts:
        start, end = _instance(start_local, zone, duration, all_day)
        if end <= window_from or start >= window_to:
            return []
        return [Occurrence(start, end, start)]
    # A long instance may begin before the window; widen the search by its own length.
    searched_from = (window_from - abs(duration)).astimezone(zone)
    rule = build_rule(rule_parts, start_local)
    occurrences: list[Occurrence] = []
    for occ_local in rule.between(searched_from, window_to.astimezone(zone), inc=True):
        key = occurrence_key(occ_local)
        if key in exdates:
            continue
        base_start, base_end = _instance(occ_local, zone, duration, all_day)
        override = overrides.get(key)
        start, end = base_start, base_end
        if override:
            start = parse_moment(override["start_at"])
            end = parse_moment(override["end_at"])
        if end <= window_from or start >= window_to:
            continue
        occurrences.append(Occurrence(start, end, base_start, override))
        if len(occurrences) >= limit:
            break
    return occurrences

