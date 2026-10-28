from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from fastapi import HTTPException
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Automation
from personalos.schemas import AutomationInput
from personalos.services.records import audit
from personalos.services.accounts import assert_account_writable


def create_automation(db: Session, owner_id: str, payload: AutomationInput) -> Automation:
    assert_account_writable(db, owner_id)
    values = payload.model_dump()
    next_run_at = values.get("next_run_at")
    if next_run_at is None and payload.cron:
        base = utcnow().astimezone(ZoneInfo(payload.timezone))
        next_run_at = croniter(payload.cron, base).get_next(datetime).astimezone(timezone.utc)
    if next_run_at is None or not next_run_at.tzinfo:
        raise HTTPException(422, "One-time automation requires next_run_at with a timezone")
    values["next_run_at"] = next_run_at
    row = Automation(owner_id=owner_id, **values)
    db.add(row)
    db.flush()
    audit(db, owner_id, "automation.created", row.id)
    db.commit()
    return row
