"""High-risk HTTP integration boundaries against disposable real PostgreSQL schemas.

The authentication rate limiter is isolated here; Redis availability is verified by
service smoke checks separately. No model/calendar provider response is fabricated.
"""
import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from personalos.config import get_settings
from personalos.db import Base, get_db
from personalos.main import app


@pytest.fixture
def clients(monkeypatch):
    import personalos.main as main
    config = get_settings()
    database_url = os.getenv("TEST_DATABASE_URL", config.database_url)
    if not database_url.startswith("postgresql"):
        pytest.skip("Real PostgreSQL is required; set TEST_DATABASE_URL")
    schema = "test_api_" + uuid.uuid4().hex
    admin = create_engine(database_url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(database_url, connect_args={"options": f"-csearch_path={schema}"})
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    original_url = config.database_url
    from sqlalchemy.engine import make_url
    config.database_url = str(make_url(database_url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False))

    def db_override():
        with factory() as db:
            yield db

    async def no_rate_limit(request):
        pass

    app.dependency_overrides[get_db] = db_override
    monkeypatch.setattr(main, "rate_auth", no_rate_limit)
    config.encryption_key = "9M26xw7-C9QXK44GuK0HDrB_9K9DJB6G0WO5kyArC-Q="
    config.openai_api_key = ""
    with TestClient(app) as first, TestClient(app) as second:
        yield first, second
    app.dependency_overrides.clear()
    config.database_url = original_url
    engine.dispose()
    with admin.begin() as conn:
        conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    admin.dispose()


def register(client, email="alice@example.com"):
    result = client.post("/api/auth/register", json={"email": email, "password": "test-password-strong", "name": "Alice"})
    assert result.status_code == 201, result.text
    return result.json()


def test_cookie_auth_and_data_isolation(clients):
    first, second = clients
    assert first.get("/api/tasks").status_code == 401
    register(first)
    task = first.post("/api/tasks", json={"title": "Private task"}).json()
    register(second, "bob@example.com")
    assert second.get("/api/tasks").json() == []
    assert second.patch(f'/api/tasks/{task["id"]}', json={"version": 1, "status": "done"}).status_code == 404
    assert "password_hash" not in first.get("/api/auth/me").text
    assert "HttpOnly" in first.cookies.jar._cookies["testserver.local"]["/"]["personalos_session"]._rest or first.cookies.get("personalos_session")
    assert first.post("/api/auth/logout").status_code == 200
    assert first.get("/api/auth/me").status_code == 401
    login = first.post("/api/auth/login", json={"email": "alice@example.com", "password": "test-password-strong"})
    assert login.status_code == 200


def test_cas_and_approval_cannot_replay(clients):
    first, _ = clients
    register(first)
    task = first.post("/api/tasks", json={"title": "Keep safe"}).json()
    url = f'/api/tasks/{task["id"]}'
    updated = first.patch(url, json={"version": 1, "status": "done"})
    assert updated.status_code == 200
    assert first.patch(url, json={"version": 1, "title": "stale"}).status_code == 409
    request = first.delete(url + "?version=2")
    assert request.status_code == 202
    assert len(first.get("/api/tasks").json()) == 1
    approval = request.json()["approval"]
    approve_url = f'/api/approvals/{approval["id"]}/resolve'
    assert first.post(approve_url, json={"decision": "approved", "version": 1}).status_code == 200
    assert first.get("/api/tasks").json() == []
    assert first.post(approve_url, json={"decision": "approved", "version": 1}).status_code == 409


def test_settings_secret_never_in_response_or_export(clients):
    first, _ = clients
    register(first)
    response = first.patch("/api/settings", json={"version": 1, "api_key": "test-secret-never-output", "model": "deepseek-chat"})
    assert response.status_code == 200, response.text
    assert response.json()["api_key_configured"] is True
    assert "test-secret-never-output" not in response.text
    assert "test-secret-never-output" not in first.get("/api/export").text
    assert first.patch("/api/settings", json={"version": 2, "base_url": "https://127.0.0.1/v1"}).status_code == 403


def test_memory_requires_consent_and_clear_provider_metadata(clients):
    first, _ = clients
    register(first)
    pending = first.post("/api/memories", json={"content": "Prefers mornings", "category": "preference"})
    assert pending.status_code == 201
    row = pending.json()
    assert row["status"] == "pending"
    assert first.get("/api/dashboard").json()["stats"]["memories"] == 0
    confirmed = first.patch(f'/api/memories/{row["id"]}', json={"status": "confirmed", "version": row["version"]})
    assert confirmed.status_code == 200, confirmed.text
    assert first.get("/api/dashboard").json()["stats"]["memories"] == 1
    version = confirmed.json()["version"]
    deletion = first.delete(f'/api/memories/{row["id"]}?version={version}').json()["approval"]
    response = first.post(f'/api/approvals/{deletion["id"]}/resolve', json={"decision": "approved", "version": deletion["version"]})
    assert response.status_code == 200, response.text
    assert first.get("/api/memories").json() == []
    assert "Prefers mornings" not in first.get("/api/export").text
    bad = first.post("/api/memories", json={"content": "inject", "extra": {"hy_memory_id": "foreign-id"}})
    assert bad.status_code == 422


def test_calendar_conflict_and_automation_validation(clients):
    first, _ = clients
    register(first)
    event = {"title": "Planning", "start_at": "2030-01-01T09:00:00+08:00", "end_at": "2030-01-01T10:00:00+08:00"}
    assert first.post("/api/events", json=event).status_code == 201
    assert first.post("/api/events", json=event).status_code == 409
    assert first.post("/api/automations", json={"title": "Invalid", "prompt": "briefing", "cron": "bad"}).status_code == 422
    assert first.post("/api/automations", json={"title": "Invalid", "prompt": "briefing", "timezone": "not/a-zone"}).status_code == 422
    assert first.post("/api/chat/stream", json={"message": "Hello"}).status_code == 503
    assert first.get("/api/calendar/oauth/start").status_code == 503


def test_cross_origin_mutations_refused(clients):
    first, _ = clients
    register(first)
    response = first.post("/api/tasks", json={"title": "CSRF attempt"}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_memory_conflict_requires_explicit_complete_replacement(clients):
    first, _ = clients
    register(first)
    old = first.post("/api/memories", json={"content": "Prefers morning", "status": "confirmed", "extra": {"fact_key": "work-hours"}}).json()
    pending = first.post("/api/memories", json={"content": "Prefers evening", "extra": {"fact_key": "work-hours", "supersedes": ["wrong-id"]}}).json()
    url = f'/api/memories/{pending["id"]}'
    assert first.patch(url, json={"version": pending["version"], "status": "confirmed"}).status_code == 409
    response = first.patch(url, json={"version": pending["version"], "status": "confirmed", "extra": {"fact_key": "work-hours", "supersedes": [old["id"]]}})
    assert response.status_code == 200, response.text
    rows = first.get("/api/memories").json()
    assert len([r for r in rows if r["status"] == "confirmed"]) == 1
    assert len([r for r in rows if r["status"] == "superseded"]) == 1


def test_account_erasure_invalidates_session_and_scrubs_all_data(clients):
    from personalos.models import AuthSession, Record, User
    from sqlalchemy import select
    first, _ = clients
    account = register(first)
    first.post("/api/tasks", json={"title": "Sensitive private task"})
    first.post("/api/memories", json={"content": "Private preference", "status": "confirmed"})
    first.patch("/api/settings", json={"version": 1, "api_key": "private-provider-secret"})
    assert first.post("/api/account/delete", json={"confirmation": "no"}).status_code == 422
    request = first.post("/api/account/delete", json={"confirmation": "DELETE"})
    assert request.status_code == 202
    assert first.get("/api/auth/me").status_code == 200
    approval = request.json()["approval"]
    result = first.post(f'/api/approvals/{approval["id"]}/resolve', json={"decision": "approved", "version": 1})
    assert result.status_code == 200, result.text
    assert result.json()["result"]["canonical_data_erased"] is True
    assert first.get("/api/auth/me").status_code == 401
    assert first.get("/api/export").status_code == 401
    engine = create_engine(get_settings().database_url)
    with engine.connect() as conn:
        user = conn.execute(select(User.__table__).where(User.id == account["id"])).mappings().one()
        assert user["deleted_at"] is not None and user["secret_config"] is None
        assert user["email"].endswith("@invalid.local")
        assert user["name"] == "Deleted account"
        records = conn.execute(select(Record.__table__).where(Record.owner_id == account["id"])).mappings().all()
        assert "Sensitive private task" not in str(records)
        assert "Private preference" not in str(records)
        sessions = conn.execute(select(AuthSession.__table__).where(AuthSession.owner_id == account["id"])).mappings().all()
        assert all(row["deleted_at"] is not None for row in sessions)
    engine.dispose()


def test_account_erasure_refuses_inflight_lease_and_stale_writes(clients):
    from contextvars import Context
    from sqlalchemy.orm import Session
    from personalos.models import User
    from personalos.services.accounts import account_lease, assert_account_writable
    from fastapi import HTTPException
    first, _ = clients
    owner = register(first)
    approval = first.post("/api/account/delete", json={"confirmation": "DELETE"}).json()["approval"]
    engine = create_engine(get_settings().database_url)
    with Session(engine) as stale_db:
        stale_user = stale_db.get(User, owner["id"])
        assert stale_user.deleted_at is None
        with account_lease(stale_db, owner["id"]):
            response = Context().run(lambda: first.post(f'/api/approvals/{approval["id"]}/resolve', json={"decision": "approved", "version": 1}))
            assert response.status_code == 409, response.text
        assert first.get("/api/auth/me").status_code == 200
        fresh = first.post("/api/account/delete", json={"confirmation": "DELETE"}).json()["approval"]
        erased = first.post(f'/api/approvals/{fresh["id"]}/resolve', json={"decision": "approved", "version": 1})
        assert erased.status_code == 200, erased.text
        with pytest.raises(HTTPException) as stale:
            assert_account_writable(stale_db, owner["id"])
        assert stale.value.status_code == 410
    engine.dispose()


def test_pending_external_memory_tombstone_prevents_false_account_purge(clients):
    from sqlalchemy import update
    from personalos.db import utcnow
    from personalos.models import Record
    first, _ = clients
    register(first)
    memory = first.post("/api/memories", json={"content": "External index pending"}).json()
    engine = create_engine(get_settings().database_url)
    with engine.begin() as connection:
        connection.execute(update(Record).where(Record.id == memory["id"]).values(
            content="", deleted_at=utcnow(), status="deletion_pending", extra={"hy_memory_id": "external-entry"}))
    request = first.post("/api/account/delete", json={"confirmation": "DELETE"}).json()["approval"]
    response = first.post(f'/api/approvals/{request["id"]}/resolve', json={"decision": "approved", "version": 1})
    assert response.status_code == 409
    assert first.get("/api/auth/me").status_code == 200
    engine.dispose()


def test_memory_erasure_scrubs_legacy_proposal_audit(clients):
    from sqlalchemy.orm import Session
    from personalos.models import Record
    first, _ = clients
    owner = register(first)
    secret = "Private long term preference needle"
    memory = first.post("/api/memories", json={"content": secret, "status": "confirmed"}).json()
    engine = create_engine(get_settings().database_url)
    with Session(engine) as db:
        db.add(Record(owner_id=owner["id"], kind="activity", title="tool.executed", data={
            "action": "tool.executed", "details": {"tool": "propose_memory", "arguments": {"content": secret}}}))
        db.commit()
    approval = first.delete(f'/api/memories/{memory["id"]}?version={memory["version"]}').json()["approval"]
    result = first.post(f'/api/approvals/{approval["id"]}/resolve', json={"decision": "approved", "version": 1})
    assert result.status_code == 200, result.text
    assert secret not in first.get("/api/export").text
    engine.dispose()


def test_mcp_approval_binds_connection_version_and_endpoint(clients):
    from sqlalchemy.orm import Session
    from personalos.models import Record
    first, _ = clients
    owner = register(first)
    engine = create_engine(get_settings().database_url)
    with Session(engine, expire_on_commit=False) as db:
        row = Record(owner_id=owner["id"], kind="integration", title="Granted MCP", status="ready", data={
            "kind": "mcp", "url": "https://approved.example/mcp", "trusted": True, "permissions": ["write"]})
        db.add(row)
        db.commit()
        connection_id = row.id
    request = first.post(f'/api/integrations/{connection_id}/call', json={"tool": "write", "arguments": {"value": "approved"}})
    assert request.status_code == 202
    approval = request.json()["approval"]
    assert approval["arguments"]["integration_version"] == 1
    with Session(engine) as db:
        row = db.get(Record, connection_id)
        row.data = {**row.data, "url": "https://different.example/mcp"}
        row.version += 1
        db.commit()
    # Rejection occurs before network/DNS/tool initialization, so the approved
    # arguments can never be silently sent to the subsequently edited endpoint.
    response = first.post(f'/api/approvals/{approval["id"]}/resolve', json={"decision": "approved", "version": 1})
    assert response.status_code == 409, response.text
    engine.dispose()


def test_memory_search_filters_before_pagination(clients):
    first, _ = clients
    register(first)
    match = first.post("/api/memories", json={"content": "Rare needle from an older conversation"}).json()
    first.post("/api/memories", json={"content": "Newer unrelated information"})
    results = first.get("/api/memories", params={"q": "needle", "limit": 1}).json()
    assert [row["id"] for row in results] == [match["id"]]


def test_calendar_conflict_check_holds_transaction_fence(clients):
    from datetime import datetime
    from sqlalchemy.orm import Session
    from fastapi import HTTPException
    from personalos.services.records import create_record, ensure_no_conflict
    first, _ = clients
    owner = register(first)
    start = datetime.fromisoformat("2035-01-01T09:00:00+08:00")
    end = datetime.fromisoformat("2035-01-01T10:00:00+08:00")
    engine = create_engine(get_settings().database_url)
    with Session(engine) as left, Session(engine) as right:
        ensure_no_conflict(left, owner["id"], start, end)
        with pytest.raises(HTTPException) as concurrent:
            ensure_no_conflict(right, owner["id"], start, end)
        assert concurrent.value.status_code == 409
        right.rollback()
        create_record(left, owner["id"], "event", {"title": "Protected range", "start_at": start, "end_at": end})
        with pytest.raises(HTTPException) as overlap:
            ensure_no_conflict(right, owner["id"], start, end)
        assert overlap.value.status_code == 409
    assert len(first.get("/api/events").json()) == 1
    engine.dispose()


def test_account_write_guard_never_blocks_on_erasure_row_lock(clients):
    from fastapi import HTTPException
    from sqlalchemy import select
    from sqlalchemy.orm import Session
    from personalos.models import User
    from personalos.services.accounts import assert_account_writable
    first, _ = clients
    owner = register(first)
    engine = create_engine(get_settings().database_url)
    with Session(engine) as deleting, Session(engine) as writing:
        deleting.scalar(select(User).where(User.id == owner["id"]).with_for_update())
        with pytest.raises(HTTPException) as blocked:
            assert_account_writable(writing, owner["id"])
        assert blocked.value.status_code == 409
    engine.dispose()
