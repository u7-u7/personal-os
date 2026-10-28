"""Older topic conflicts remain addressable beyond the default memory page."""
from sqlalchemy import create_engine, insert

from personalos.config import get_settings
from personalos.models import Record
from test_api import clients, register  # noqa: F401


def test_topic_filter_before_pagination(clients):  # noqa: F811
    first, foreign = clients
    owner = register(first)
    register(foreign, "topic-foreign@example.com")
    old = first.post("/api/memories", json={
        "content": "Prefers working in the morning", "status": "confirmed", "extra": {"fact_key": "work-hours"},
    }).json()
    foreign.post("/api/memories", json={
        "content": "Foreign fact is not a replacement candidate", "status": "confirmed", "extra": {"fact_key": "work-hours"},
    })
    engine = create_engine(get_settings().database_url)
    with engine.begin() as connection:
        connection.execute(insert(Record), [
            {"owner_id": owner["id"], "kind": "memory", "content": f"Unrelated fact {index}",
             "status": "confirmed", "extra": {"fact_key": f"other-topic-{index}"},
             "data": {"category": "fact", "source": "explicit-test-fixture"}}
            for index in range(205)
        ])
    latest = first.get("/api/memories", params={"limit": 200}).json()
    assert old["id"] not in {row["id"] for row in latest}
    candidates = first.get("/api/memories", params={"topic": "work-hours", "limit": 200}).json()
    assert [row["id"] for row in candidates] == [old["id"]]
    proposal = first.post("/api/memories", json={
        "content": "Prefers working in the evening", "extra": {"fact_key": "work-hours", "supersedes": [candidates[0]["id"]]},
    }).json()
    result = first.patch(f'/api/memories/{proposal["id"]}', json={"status": "confirmed", "version": proposal["version"]})
    assert result.status_code == 200, result.text
    after = first.get("/api/memories", params={"topic": "work-hours", "limit": 200}).json()
    assert {row["id"]: row["status"] for row in after} == {old["id"]: "superseded", proposal["id"]: "confirmed"}
    engine.dispose()
