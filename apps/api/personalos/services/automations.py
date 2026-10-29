from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from personalos.db import utcnow
from personalos.models import Automation, Execution
from personalos.schemas import AutomationInput
from personalos.services.records import audit, owned
from personalos.services.accounts import assert_account_writable


def list_automations(db: Session, owner_id: str, limit: int = 200, offset: int = 0) -> list[Automation]:
    # 同一创建时间也保持稳定顺序，避免分页边界重复或漏掉记录。
    return list(db.scalars(
        select(Automation)
        .where(Automation.owner_id == owner_id, Automation.deleted_at.is_(None))
        .order_by(Automation.created_at.desc(), Automation.id.desc())
        .limit(limit).offset(offset)
    ).all())


def list_automation_runs(db: Session, owner_id: str, automation_id: str,
                         limit: int = 100, offset: int = 0) -> list[Execution]:
    # 历史为空与无权访问自动化不同；先复用所有权检查保留原有 404 契约。
    owned(db, Automation, owner_id, automation_id)
    return list(db.scalars(
        select(Execution)
        .where(Execution.owner_id == owner_id, Execution.automation_id == automation_id,
               Execution.deleted_at.is_(None))
        .order_by(Execution.created_at.desc(), Execution.id.desc())
        .limit(limit).offset(offset)
    ).all())


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
