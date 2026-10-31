from datetime import datetime, timezone
from contextlib import contextmanager
from zoneinfo import ZoneInfo

from croniter import croniter
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError

from personalos.db import utcnow
from personalos.models import Automation, Execution
from personalos.schemas import AutomationInput
from personalos.services.records import audit, owned
from personalos.services.accounts import assert_account_writable
from personalos.services.execution_safety import assert_replay_safe


@contextmanager
def lock_automation(db: Session, owner_id: str, automation_id: str):
    # Serialize replay checks with scheduler materialization and concurrent edits.
    # Never lock child executions here; claim_next locks children first.
    try:
        row = db.scalar(select(Automation).where(
            Automation.id == automation_id, Automation.owner_id == owner_id,
            Automation.deleted_at.is_(None),
        ).with_for_update(nowait=True).execution_options(populate_existing=True))
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) == "55P03":
            db.rollback()
            raise HTTPException(409, "Automation is being scheduled or changed. Refresh and retry") from exc
        raise
    if row is None:
        raise HTTPException(404, "Item not found")
    try:
        yield row
    except BaseException:
        db.rollback()
        raise


def validate_reschedule(db: Session, owner_id: str, row: Automation, values: dict) -> None:
    if values["status"] != "active":
        return
    timing_changed = any(values[key] != getattr(row, key) for key in ("cron", "next_run_at", "timezone"))
    definition_changed = (values["prompt"] != row.prompt or
                          values["extra"].get("kind") != row.extra.get("kind"))
    if timing_changed or definition_changed or row.status != "active":
        # A plain resume continues already queued work, rather than replaying it.
        # Timing changes still cannot create a second run beside pending work.
        assert_replay_safe(db, owner_id, row.id, allow_inflight=not timing_changed and not definition_changed)


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
