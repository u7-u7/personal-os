"""Qwen protocol fixtures and real PostgreSQL configuration safety, not live acceptance."""
import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

from personalos.config import get_settings
from personalos.services.embedding import EmbeddingConfiguration, EmbeddingService, validate_embedding_url
from test_api import clients, register  # noqa: F401

BASE_URL = "https://protocol-fixture.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"


def test_settings_encrypt_isolate_clear_embedding_key_and_do_not_enable_index(clients, monkeypatch):  # noqa: F811
    from personalos.services import embedding

    monkeypatch.setattr(get_settings(), "embedding_api_key", "")
    first, second = clients
    register(first)
    register(second, "embedding-other@example.com")
    original = first.get("/api/settings").json()
    assert original["embedding_model"] == "qwen3.7-text-embedding-flash"
    assert original["embedding_dimensions"] == 1024
    assert original["embedding_api_key_configured"] is False
    assert first.post("/api/settings/embedding/test").status_code == 503
    saved = first.patch("/api/settings", json={
        "version": 1, "embedding_api_key": "explicit-embedding-fixture-secret",
        "api_key": "explicit-chat-fixture-secret", "embedding_base_url": BASE_URL,
        "embedding_dimensions": 768,
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["embedding_configured"] is True
    assert saved.json()["embedding_index_status"] == "hy_not_enabled"
    assert "explicit-embedding-fixture-secret" not in saved.text
    assert "explicit-chat-fixture-secret" not in saved.text
    exported = first.get("/api/export").text
    assert "explicit-embedding-fixture-secret" not in exported
    assert "explicit-chat-fixture-secret" not in exported
    assert second.get("/api/settings").json()["embedding_api_key_configured"] is False
    real_client = embedding.AsyncOpenAI

    async def probe_fixture(request):
        assert json.loads(request.content)["input"] == ["PersonalOS embedding connection check"]
        return httpx.Response(200, json={"object": "list", "model": "qwen3.7-text-embedding-flash",
                                       "data": [{"index": 0, "object": "embedding", "embedding": [0.25] * 768}],
                                       "usage": {"prompt_tokens": 1, "total_tokens": 1}})

    def fixture_sdk(**kwargs):
        return real_client(**{**kwargs, "http_client": httpx.AsyncClient(transport=httpx.MockTransport(probe_fixture))})

    monkeypatch.setattr(embedding, "AsyncOpenAI", fixture_sdk)
    receipt = first.post("/api/settings/embedding/test")
    assert receipt.status_code == 200, receipt.text
    assert receipt.json() == {"status": "ok", "provider": "dashscope", "model": "qwen3.7-text-embedding-flash",
                              "dimensions": 768, "settings_version": 2}
    assert "embedding\"" not in receipt.text and "explicit-embedding-fixture-secret" not in first.get("/api/activity").text
    # Saving only an unrelated field preserves the secret; explicit clear never
    # resurrects an administrator's global fallback credential.
    preserved = first.patch("/api/settings", json={"version": 2, "name": "Updated name"})
    assert preserved.json()["embedding_api_key_configured"] is True
    monkeypatch.setattr(get_settings(), "embedding_api_key", "global-fixture-key")
    cleared = first.patch("/api/settings", json={"version": 3, "embedding_api_key": ""})
    assert cleared.status_code == 200
    assert cleared.json()["embedding_api_key_configured"] is False
    assert cleared.json()["api_key_configured"] is True
    assert first.post("/api/settings/embedding/test").status_code == 503
    assert first.patch("/api/settings", json={"version": 4, "embedding_dimensions": 1536}).status_code == 422


def test_official_sdk_qwen_request_and_ordered_dimension_validation():
    seen = []

    async def fixture(request):
        payload = json.loads(request.content)
        seen.append(payload)
        assert request.url.path == "/compatible-mode/v1/embeddings"
        assert request.headers["authorization"] == "Bearer explicit-protocol-fixture-key"
        return httpx.Response(200, json={
            "object": "list", "model": "qwen3.7-text-embedding-flash",
            "data": [{"index": index, "object": "embedding", "embedding": [0.25] * 256}
                     for index in reversed(range(len(payload["input"])))],
            "usage": {"prompt_tokens": 2, "total_tokens": 2},
        })

    service = EmbeddingService(EmbeddingConfiguration(base_url=BASE_URL, api_key="explicit-protocol-fixture-key", dimensions=256),
                               transport=httpx.MockTransport(fixture))
    result = asyncio.run(service.embed(["explicit protocol input one", "explicit protocol input two"]))
    assert len(result) == 2 and len(result[0]) == 256
    assert seen[0]["model"] == "qwen3.7-text-embedding-flash"
    assert seen[0]["dimensions"] == 256 and seen[0]["encoding_format"] == "float"


@pytest.mark.parametrize("response", [
    {"data": [{"index": 0, "embedding": [0.2, 0.3]}]},
    {"data": [{"index": 1, "embedding": [0.2] * 256}]},
    {"data": [{"index": 0, "embedding": [float("inf")] * 256}]},
])
def test_bad_provider_vectors_are_never_reported_as_success(response):
    service = EmbeddingService(EmbeddingConfiguration(base_url=BASE_URL, api_key="protocol-fixture", dimensions=256),
                               transport=httpx.MockTransport(lambda request: httpx.Response(200, content=json.dumps(response),
                                                                                           headers={"content-type": "application/json"})))
    with pytest.raises(HTTPException) as failure:
        asyncio.run(service.embed(["explicit fixture"]))
    assert failure.value.status_code == 502


def test_foreign_endpoint_and_placeholder_rejected_before_sdk():
    for url in ("https://evil.example/compatible-mode/v1", "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
                "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", BASE_URL + "?api_key=unsafe",
                BASE_URL.replace("https:", "http:"), BASE_URL.replace("https://", "https://secret@"),
                BASE_URL.replace(".com/", ".com:8443/"),
                "https://127.0.0.1/compatible-mode/v1"):
        with pytest.raises(HTTPException) as failure:
            asyncio.run(validate_embedding_url(url))
        assert failure.value.status_code == 422


def test_hy_bridge_isolates_owner_and_space_without_enabling_runtime():
    config = EmbeddingConfiguration(base_url=BASE_URL, api_key="never-log-this-key", dimensions=1024)
    other_key = EmbeddingConfiguration(base_url=BASE_URL, api_key="rotated-key", dimensions=1024)
    changed = EmbeddingConfiguration(base_url=BASE_URL, api_key="rotated-key", dimensions=768)
    assert "never-log-this-key" not in repr(config)
    assert config.index_namespace == other_key.index_namespace
    assert config.index_namespace != changed.index_namespace
    first = config.hy_index_configuration("alice", Path("/controlled/hy-data"))
    second = config.hy_index_configuration("bob", Path("/controlled/hy-data"))
    assert first["embedder"]["embedding_dims"] == first["vector_store"]["embedding_dims"] == 1024
    assert first["vector_store"]["collection_name"] != second["vector_store"]["collection_name"]
    assert first["cache"]["db_path"] != second["cache"]["db_path"]
    assert len(first["vector_store"]["tag_index_collection_name"]) <= 63
