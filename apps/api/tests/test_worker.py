"""Real PostgreSQL transaction tests; never operate on application tables.

Set TEST_DATABASE_URL to a disposable Postgres database. Each test uses its own
schema; no mock can validate SKIP LOCKED or cross-connection fencing semantics.
"""

import asyncio
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import sessionmaker

from personalos import worker
from personalos.db import Base, utcnow
from personalos.models import Automation, Execution, User


@pytest.fixture
def database():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or not url.startswith("postgresql"):
        pytest.skip("Real PostgreSQL TEST_DATABASE_URL required for worker locking tests")
    schema = "worker_test_" + uuid.uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"}, pool_size=10)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        user = User(email="worker@example.test", name="Worker test", password_hash="unused-in-worker")
        db.add(user)
        db.commit()
        owner = user.id
    yield factory, owner
    engine.dispose()
    with admin.begin() as conn:
        conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


def add_automation(factory, owner, **values):
    with factory() as db:
        row = Automation(owner_id=owner, title="Test schedule", prompt="Read today's tasks",
                         cron=values.pop("cron", "0 9 * * *"), timezone="Asia/Shanghai",
                         next_run_at=values.pop("next_run_at", utcnow() - timedelta(days=7)), **values)
        db.add(row)
        db.commit()
        return row.id


def test_concurrent_schedulers_materialize_one_coalesced_occurrence(database):
    factory, owner = database
    automation_id = add_automation(factory, owner)
    now = utcnow()

    def schedule():
        with factory() as db:
            return worker.schedule_due(db, now)

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: schedule(), range(6)))
    assert len([result for result in results if result]) == 1
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Execution)) == 1
        row = db.get(Automation, automation_id)
        assert row.next_run_at > now
        assert row.status == "active"


def test_concurrent_claims_and_expired_lease_fence_late_completion(database):
    factory, owner = database
    add_automation(factory, owner, cron=None)
    with factory() as db:
        run_id = worker.schedule_due(db)

    def claim():
        with factory() as db:
            return worker.claim_next(db)

    with ThreadPoolExecutor(max_workers=6) as pool:
        claims = [item for item in pool.map(lambda _: claim(), range(6)) if item]
    assert len(claims) == 1
    claimed_id, token = claims[0]
    assert claimed_id == run_id
    with factory() as db:
        assert worker.recover_expired(db, utcnow() + timedelta(minutes=10)) == 1
    with factory() as db:
        assert not worker.finish_run(db, run_id, token, "succeeded", {}, None)
        assert db.get(Execution, run_id).status == "outcome_unknown"


def test_paused_run_does_not_starve_active_work_and_cancelled_never_runs(database):
    factory, owner = database
    paused_id = add_automation(factory, owner, cron=None)
    active_id = add_automation(factory, owner, cron=None)
    cancelled_id = add_automation(factory, owner, cron=None)
    with factory() as db:
        run_ids = [worker.schedule_due(db) for _ in range(3)]
        db.get(Automation, paused_id).status = "paused"
        db.get(Automation, cancelled_id).status = "cancelled"
        db.commit()
        claim = worker.claim_next(db)
        assert claim
        assert db.get(Execution, claim[0]).automation_id == active_id
        cancelled = db.scalar(select(Execution).where(Execution.automation_id == cancelled_id))
        assert cancelled.status == "cancelled"
        assert len(set(run_ids)) == 3


@pytest.mark.asyncio
async def test_timeout_persists_unknown_outcome_without_blind_retry(database, monkeypatch):
    from personalos.services import agent

    factory, owner = database
    add_automation(factory, owner, cron=None)
    with factory() as db:
        worker.schedule_due(db)
        run_id, token = worker.claim_next(db)

    async def stalled_provider(*args):
        await asyncio.sleep(10)
        return {"unexpected": "late success"}

    monkeypatch.setattr(worker, "SessionLocal", factory)
    monkeypatch.setattr(worker, "RUN_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(agent, "run_automation", stalled_provider)
    await worker.execute_claim(run_id, token)
    with factory() as db:
        row = db.get(Execution, run_id)
        assert row.status == "outcome_unknown"
        assert row.attempts == 1
        assert worker.claim_next(db) is None


def test_erased_execution_rejects_late_worker_result(database):
    factory, owner = database
    add_automation(factory, owner, cron=None)
    with factory() as db:
        worker.schedule_due(db)
        run_id, token = worker.claim_next(db)
        run = db.get(Execution, run_id)
        run.deleted_at = utcnow()
        run.result = {}
        db.commit()
    with factory() as db:
        assert not worker.finish_run(db, run_id, token, "succeeded", {"private": "late result"}, None)
        assert db.get(Execution, run_id).result == {}


def test_more_than_one_page_of_paused_runs_does_not_hide_runnable_work(database):
    factory, owner = database
    paused_id = add_automation(factory, owner, status="paused")
    active_id = add_automation(factory, owner, next_run_at=utcnow() + timedelta(days=1))
    with factory() as db:
        for index in range(101):
            db.add(Execution(owner_id=owner, automation_id=paused_id, run_key=f"paused:{index}",
                             scheduled_at=utcnow() - timedelta(hours=2), status="queued"))
        runnable = Execution(owner_id=owner, automation_id=active_id, run_key="active:1",
                             scheduled_at=utcnow(), status="queued")
        db.add(runnable)
        db.commit()
        claim = worker.claim_next(db)
        assert claim and claim[0] == runnable.id
