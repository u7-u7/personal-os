"""Explicit protocol fixtures, not an external OpenAI/DeepSeek acceptance claim.

These tests use the official ChatOpenAI client, real LangGraph execution and a
real isolated PostgreSQL schema. Only the remote HTTP response bytes come from
an explicitly named OpenAI-compatible SSE fixture transport; no graph, tool,
checkpoint, application response or database write is mocked.
"""
import asyncio
import json

import httpx

from personalos.config import get_settings
from test_api import clients, register  # noqa: F401


def protocol_sse(deltas: list[dict], finish_reason: str) -> httpx.Response:
    chunks = []
    for delta in [*deltas, {}]:
        chunks.append({
            "id": "chatcmpl-explicit-protocol-fixture",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "protocol-fast-model",
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        })
    chunks[-1]["choices"][0]["finish_reason"] = finish_reason
    body = "".join("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n" for chunk in chunks)
    return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body + "data: [DONE]\n\n")


def parse_sse(response) -> list[dict]:
    assert response.status_code == 200, response.text
    events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line.startswith("data: ")]
    assert not any(event["type"] == "error" for event in events), events
    return events


def test_real_langgraph_tool_stream_checkpoint_and_memory_boundaries(clients, monkeypatch, request):  # noqa: F811
    import personalos.services.agent as agent

    first, foreign = clients
    register(first)
    register(foreign, "foreign-owner@example.com")
    confirmed_fact = "morning focus is preferred"
    pending_fact = "morning pending fact must stay private"
    foreign_fact = "morning foreign owner's fact must stay private"
    assert first.post("/api/memories", json={"content": confirmed_fact, "status": "confirmed"}).status_code == 201
    assert first.post("/api/memories", json={"content": pending_fact}).status_code == 201
    assert foreign.post("/api/memories", json={"content": foreign_fact, "status": "confirmed"}).status_code == 201
    saved = first.patch("/api/settings", json={"version": 1, "fast_model": "protocol-fast-model", "decision_provider": "rules"})
    assert saved.status_code == 200

    config = get_settings()
    monkeypatch.setattr(config, "openai_api_key", "explicit-protocol-fixture-key-not-live")
    monkeypatch.setattr(config, "openai_base_url", "https://protocol-fixture.example/v1")
    requests: list[dict] = []

    async def fixture_transport(request: httpx.Request):
        assert request.url.host == "protocol-fixture.example"
        assert request.url.path == "/v1/chat/completions"
        payload = json.loads(request.content)
        requests.append(payload)
        assert payload["stream"] is True
        assert payload["model"] == "protocol-fast-model"
        assert "create_task" in {item["function"]["name"] for item in payload["tools"]}
        serialized = json.dumps(payload["messages"], ensure_ascii=False)
        assert pending_fact not in serialized
        assert foreign_fact not in serialized
        assert confirmed_fact in payload["messages"][0]["content"]
        if len(requests) == 1:
            return protocol_sse([
                {"role": "assistant", "tool_calls": [{"index": 0, "id": "call_fixture_task", "type": "function", "function": {"name": "create_task", "arguments": '{"title":"Protocol task'}}]},
                {"tool_calls": [{"index": 0, "function": {"arguments": '","priority":"high"}'}}]},
            ], "tool_calls")
        if len(requests) == 2:
            results = [message for message in payload["messages"] if message["role"] == "tool"]
            assert len(results) == 1 and results[0]["tool_call_id"] == "call_fixture_task"
            assert json.loads(results[0]["content"])["title"] == "Protocol task"
            return protocol_sse([{"role": "assistant", "content": "Task "}, {"content": "created."}], "stop")
        assert len(requests) == 3
        assert any(message["role"] == "user" and message["content"] == "Create a task for morning focus" for message in payload["messages"])
        assert any(message["role"] == "assistant" and message.get("content") == "Task created." for message in payload["messages"])
        return protocol_sse([{"role": "assistant", "content": "History "}, {"content": "retained."}], "stop")

    transport = httpx.MockTransport(fixture_transport)
    async_client = httpx.AsyncClient(transport=transport)
    request.addfinalizer(lambda: asyncio.run(async_client.aclose()))
    original_model_config = agent.model_config

    def protocol_model_config(user, requested_model=None):
        # The production configuration logic remains in use; only the SDK's
        # injectable HTTP transport is replaced by this explicit fixture.
        return {**original_model_config(user, requested_model), "http_async_client": async_client}

    monkeypatch.setattr(agent, "model_config", protocol_model_config)
    events = parse_sse(first.post("/api/chat/stream", json={"message": "Create a task for morning focus"}))
    routing = next(event["decision"] for event in events if event["type"] == "status")
    assert routing["selected_model"] == "protocol-fast-model"
    running = [event for event in events if event["type"] == "tool" and event["status"] == "running"]
    completed = [event for event in events if event["type"] == "tool" and event["status"] == "completed"]
    assert running[0]["name"] == "create_task"
    assert running[0]["arguments"] == {"title": "Protocol task", "priority": "high"}
    assert json.loads(completed[0]["result"])["title"] == "Protocol task"
    assert "".join(event["content"] for event in events if event["type"] == "token") == "Task created."
    session_id = next(event["session_id"] for event in events if event["type"] == "done")
    tasks = first.get("/api/tasks").json()
    assert len(tasks) == 1 and tasks[0]["title"] == "Protocol task" and tasks[0]["priority"] == "high"
    assert foreign.get("/api/tasks").json() == []
    assert foreign.get(f"/api/chat/sessions/{session_id}/messages").status_code == 404
    assert foreign.post("/api/chat/stream", json={"message": "Access foreign session", "session_id": session_id}).status_code == 404

    # A new HTTP request creates a new graph and saver connection. The prior
    # conversation must therefore come back from PostgreSQL checkpoint storage.
    followup = parse_sse(first.post("/api/chat/stream", json={"message": "Recall the task for morning focus", "session_id": session_id}))
    assert "".join(event["content"] for event in followup if event["type"] == "token") == "History retained."
    assert len(requests) == 3
    history = first.get(f"/api/chat/sessions/{session_id}/messages").json()
    assert [message["role"] for message in history] == ["user", "assistant", "user", "assistant"]
    assert len(first.get("/api/tasks").json()) == 1
