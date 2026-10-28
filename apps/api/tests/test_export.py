"""Complete export regression using real PostgreSQL rows in an isolated schema."""
from datetime import datetime, timezone
import uuid

from sqlalchemy import create_engine, insert

from personalos.config import get_settings
from personalos.models import Automation, Execution, Message, Record
from test_api import clients, register  # noqa: F401


def test_export_has_no_record_or_automation_cap_and_excludes_foreign_data_and_credentials(clients):  # noqa: F811
    first, second = clients
    owner = register(first)
    foreign = register(second, "export-foreign@example.com")
    secret = "explicit-export-fixture-api-key-not-live"
    saved = first.patch("/api/settings", json={"version": 1, "api_key": secret})
    assert saved.status_code == 200
    engine = create_engine(get_settings().database_url)
    future = datetime(2035, 1, 1, tzinfo=timezone.utc)
    session_id = str(uuid.uuid4())
    own_automation_ids = [str(uuid.uuid4()) for _ in range(205)]
    foreign_automation_id = str(uuid.uuid4())
    with engine.begin() as connection:
        connection.execute(insert(Record), [
            {"owner_id": owner["id"], "kind": "task", "title": f"Export row {index}"}
            for index in range(10_007)
        ])
        connection.execute(insert(Record), [
            {"owner_id": foreign["id"], "kind": "task", "title": "FOREIGN_EXPORT_ROW"},
            {"owner_id": owner["id"], "kind": "oauth_state", "title": "OAUTH_STATE_MUST_NOT_EXPORT"},
        ])
        connection.execute(insert(Record), [{
            "owner_id": owner["id"], "kind": "integration", "title": "Export fixture calendar",
            "data": {"kind": "google_calendar", "trusted": True},
            "extra": {"encrypted_tokens": "ENCRYPTED_OAUTH_CREDENTIAL_MUST_NOT_EXPORT"},
        }])
        connection.execute(insert(Record), [{"id": session_id, "owner_id": owner["id"], "kind": "chat_session", "title": "Export history"}])
        connection.execute(insert(Message), [
            {"owner_id": owner["id"], "session_id": session_id, "role": "user", "content": f"Message {index}"}
            for index in range(1001)
        ])
        connection.execute(insert(Automation), [
            {"id": item_id, "owner_id": owner["id"], "title": f"Automation {index}", "prompt": "Explicit export fixture", "cron": "0 8 * * *", "next_run_at": future}
            for index, item_id in enumerate(own_automation_ids)
        ])
        connection.execute(insert(Automation), [{"id": foreign_automation_id, "owner_id": foreign["id"], "title": "FOREIGN_AUTOMATION", "prompt": "Foreign fixture", "cron": "0 8 * * *", "next_run_at": future}])
        connection.execute(insert(Execution), [
            {"owner_id": owner["id"], "automation_id": own_automation_ids[0], "scheduled_at": future, "run_key": f"export-fixture-{index}"}
            for index in range(3)
        ])
        connection.execute(insert(Execution), [{"owner_id": foreign["id"], "automation_id": foreign_automation_id, "scheduled_at": future, "run_key": "FOREIGN_EXECUTION"}])
    response = first.get("/api/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    payload = response.json()
    assert len([row for row in payload["records"] if row["kind"] == "task"]) == 10_007
    assert len(payload["automations"]) == 205
    assert len(payload["messages"]) == 1001
    assert len(payload["executions"]) == 3
    assert payload["user"]["id"] == owner["id"]
    for forbidden in (secret, "FOREIGN_EXPORT_ROW", "FOREIGN_AUTOMATION", "FOREIGN_EXECUTION", "OAUTH_STATE_MUST_NOT_EXPORT", "ENCRYPTED_OAUTH_CREDENTIAL_MUST_NOT_EXPORT", "password_hash", "secret_config", "token_hash"):
        assert forbidden not in response.text
    assert second.get("/api/export").json()["messages"] == []
    engine.dispose()
