"""Durable scheduler. Run separately from the API with ``python -m personalos.worker``.

PostgreSQL owns scheduling and leases. Redis availability never determines whether
a job exists. An expired run is deliberately not replayed: the previous process
may have committed an effect just before it died.
"""

import argparse
import asyncio
import logging
import signal
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from personalos.db import SessionLocal, utcnow
from personalos.models import Automation, Execution, Record

log = logging.getLogger("personalos.worker")
RUN_TIMEOUT_SECONDS = 120
LEASE_SECONDS = 150


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def schedule_due(db: Session, now: datetime | None = None) -> str | None:
    """Atomically materialize one scheduled occurrence and advance its schedule."""
    now = now or utcnow()
    automation = db.scalar(
        select(Automation)
        .where(
            Automation.deleted_at.is_(None),
            Automation.status == "active",
            Automation.next_run_at <= now,
        )
        .order_by(Automation.next_run_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if automation is None:
        db.rollback()
        return None
    scheduled = as_utc(automation.next_run_at)
    run_key = f"{automation.id}:{scheduled.isoformat()}"
    execution = db.scalar(select(Execution).where(Execution.run_key == run_key))
    if execution is None:
        execution = Execution(
            owner_id=automation.owner_id,
            automation_id=automation.id,
            scheduled_at=scheduled,
            run_key=run_key,
            status="queued",
            # Freeze the reviewed input: later editing cannot alter an already queued run.
            extra={"prompt": automation.prompt, "title": automation.title,
                   "handler": "briefing" if automation.extra.get("kind") == "briefing" else "agent"},
        )
        db.add(execution)
    if automation.cron:
        local_now = now.astimezone(ZoneInfo(automation.timezone))
        # Coalesce missed intervals after an outage instead of producing a burst of effects.
        automation.next_run_at = croniter(automation.cron, local_now).get_next(datetime).astimezone(timezone.utc)
    else:
        automation.status = "completed"
    automation.version += 1
    db.commit()
    return execution.id


def recover_expired(db: Session, now: datetime | None = None) -> int:
    """Fence stale workers without claiming that an unknown effect was rolled back."""
    now = now or utcnow()
    expired = list(db.scalars(
        select(Execution)
        .where(Execution.status == "running", Execution.lease_until < now)
        .with_for_update(skip_locked=True)
        .limit(100)
    ))
    for run in expired:
        run.status = "outcome_unknown"
        run.error = "Worker lease expired. Review activity and external effects before retrying."
        run.claim_token = None
        run.lease_until = None
        run.version += 1
    db.commit()
    return len(expired)


def claim_next(db: Session, now: datetime | None = None) -> tuple[str, str] | None:
    now = now or utcnow()
    candidates = list(db.scalars(
        select(Execution)
        .where(
            Execution.status.in_(["queued", "pending"]),
            Execution.deleted_at.is_(None),
            # Filter before LIMIT so any number of paused occurrences cannot
            # hide runnable work. This uses a two-table indexed subquery, no JOIN.
            Execution.automation_id.in_(select(Automation.id).where(Automation.status != "paused")),
        )
        .order_by(Execution.scheduled_at)
        .with_for_update(skip_locked=True)
        .limit(100)
    ))
    if not candidates:
        db.rollback()
        return None
    # Fetch indexed primary keys in one batch; paused jobs cannot starve unrelated work.
    automation_ids = {run.automation_id for run in candidates}
    automations = {row.id: row for row in db.scalars(
        select(Automation).where(Automation.id.in_(automation_ids))
    )}
    execution = None
    for candidate in candidates:
        automation = automations.get(candidate.automation_id)
        if automation is None or automation.deleted_at or automation.status == "cancelled":
            candidate.status = "cancelled"
            candidate.version += 1
        elif automation.status != "paused" and execution is None:
            execution = candidate
    if execution is None:
        db.commit()
        return None
    claim_token = str(uuid.uuid4())
    execution.status = "running"
    execution.claim_token = claim_token
    execution.attempts += 1
    execution.lease_until = now + timedelta(seconds=LEASE_SECONDS)
    execution.version += 1
    db.commit()
    return execution.id, claim_token


def finish_run(db: Session, run_id: str, token: str, status: str, result: dict, error: str | None) -> bool:
    # A reclaimed lease invalidates the old token; a late process cannot overwrite recovery.
    statement = (
        update(Execution)
        .where(Execution.id == run_id, Execution.claim_token == token, Execution.status == "running",
               Execution.deleted_at.is_(None))
        .values(status=status, result=result, error=error, claim_token=None, lease_until=None,
                updated_at=utcnow(), version=Execution.version + 1)
    )
    changed = db.execute(statement).rowcount == 1
    if changed:
        run = db.get(Execution, run_id)
        db.add(Record(owner_id=run.owner_id, kind="activity", title="Automation execution",
                      content=error or "Automation completed", status=status,
                      data={"execution_id": run_id, "automation_id": run.automation_id}))
    db.commit()
    return changed


async def execute_claim(run_id: str, token: str) -> None:
    from personalos.services.agent import generate_briefing, run_automation

    with SessionLocal() as db:
        run = db.get(Execution, run_id)
        if run is None or run.deleted_at or run.claim_token != token or run.status != "running":
            return
        automation = db.get(Automation, run.automation_id)
        if automation is None or automation.deleted_at or automation.status == "cancelled":
            finish_run(db, run_id, token, "cancelled", {}, "Automation was cancelled before execution")
            return
        prompt = run.extra.get("prompt", automation.prompt)
        handler = run.extra.get("handler", "agent")
        owner_id = run.owner_id
    status, result, error = "succeeded", {}, None
    try:
        with SessionLocal() as action_db:
            action = generate_briefing(action_db, owner_id) if handler == "briefing" else run_automation(action_db, owner_id, prompt)
            result = await asyncio.wait_for(
                action, timeout=RUN_TIMEOUT_SECONDS
            )
    except TimeoutError:
        status, error = "outcome_unknown", "Execution timed out; review effects before retrying."
    except asyncio.CancelledError:
        # Shutdown leaves the lease durable; recovery records unknown outcome on restart.
        raise
    except Exception:
        # User-visible records intentionally omit provider exception text (it can contain keys).
        log.exception("Automation failed run_id=%s", run_id)
        status, error = "failed", "Execution failed. See server logs using the execution id."
    with SessionLocal() as db:
        finish_run(db, run_id, token, status, result, error)


async def tick() -> bool:
    with SessionLocal() as db:
        recover_expired(db)
        schedule_due(db)
        claim = claim_next(db)
    if claim:
        await execute_claim(*claim)
        return True
    return False


async def serve(once: bool = False) -> None:
    from personalos.services.agent import initialize_graph_storage

    # DDL runs before business transactions; concurrent-index setup during a
    # memory confirmation can otherwise wait on that request's own open read.
    await initialize_graph_storage()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    while not stop.is_set():
        try:
            worked = await tick()
        except Exception:
            log.exception("Scheduler iteration failed")
            worked = False
        if once:
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=0.05 if worked else 1.0)
        except TimeoutError:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Process one scheduler iteration and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    asyncio.run(serve(args.once))
