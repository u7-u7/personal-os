"""Provider contract checks; these are not credentialed integration acceptance."""
import asyncio

import pytest

from personalos.integrations.decision import JevDecisionProvider, RuleDecisionProvider
from personalos.integrations.hy_memory import HyMemoryService, IntegrationUnavailable, MemoryNotFound


class ContractClient:
    def __init__(self):
        self.record = {"memory_id": "m1", "user_id": "alice", "kind": "chat", "content": "tea"}
        self.deleted = False

    async def async_get(self, memory_id, **kwargs):
        return None if self.deleted else self.record

    async def async_delete(self, memory_id, **kwargs):
        self.deleted = True
        return {"success": True, "partial": False}

    async def async_search(self, query, **kwargs):
        return kwargs


def service():
    value = HyMemoryService({})
    value._client = ContractClient()
    return value


def test_missing_credentials_are_explicit():
    with pytest.raises(IntegrationUnavailable):
        HyMemoryService({})._get_client()


def test_ownership_prevents_cross_user_delete():
    value = service()
    with pytest.raises(MemoryNotFound):
        asyncio.run(value.delete("bob", "m1"))
    assert not value._client.deleted


def test_consent_and_working_trace_required_before_sdk():
    value = HyMemoryService({})
    with pytest.raises(PermissionError):
        asyncio.run(value.add_confirmed("alice", "private", source_id="session"))
    with pytest.raises(ValueError, match="real tool execution trace"):
        asyncio.run(value.add_confirmed("alice", "private", source_id="session", scene="working", consent=True))
    assert value._client is None


def test_search_scope_is_mandatory():
    value = service()
    result = asyncio.run(value.search("alice", "tea"))
    assert result["user_ids"] == ["alice"]
    with pytest.raises(ValueError):
        asyncio.run(value.search("", "tea"))


def test_exact_readback_does_not_claim_cache_or_index_purge():
    result = asyncio.run(service().delete("alice", "m1"))
    assert result.record_absent and result.sdk_success
    assert not result.cache_cleanup_verified
    assert not result.index_cleanup_verified


@pytest.mark.parametrize("text,intent", [("每天早上生成简报", "automation"), ("安排会议", "calendar"), ("记住我喜欢茶", "memory"), ("创建任务", "task"), ("你好", "chat")])
def test_rules_routing(text, intent):
    result = asyncio.run(RuleDecisionProvider().decide(text))
    assert result.intent == intent
    assert result.provider == "rules"
    assert not hasattr(result, "authorized")


def test_jev_failure_requires_explicit_fallback():
    with pytest.raises(IntegrationUnavailable):
        asyncio.run(JevDecisionProvider("").decide("任务"))
    result = asyncio.run(JevDecisionProvider("", fallback=RuleDecisionProvider()).decide("任务"))
    assert result.provider == "rules"
    assert result.degraded_reason == "jev:IntegrationUnavailable"


def test_real_typesafe_sdk_serialization_and_parsing(monkeypatch):
    """Real installed SDK, explicit HTTP fixture: not a live Jev acceptance."""
    import json
    sdk = pytest.importorskip("typesafe_sdk")
    httpx2 = pytest.importorskip("httpx2")
    real_client = sdk.AsyncTypeSafeClient
    seen = []

    async def fixture(request):
        seen.append(json.loads(request.content))
        assert request.url.host == "api.typesafe.ai"
        assert request.headers["authorization"] == "Bearer contract-test-key"
        return httpx2.Response(200, json={
            "model": "jev-latest", "usage": {"input_tokens": 1, "output_tokens": 1},
            "answers": {
                "intent": {"type": "choice", "choice": "task", "confidence": 0.9, "probabilities": {"task": 0.9, "chat": 0.1}},
                "tier": {"type": "choice", "choice": "fast", "confidence": 0.9, "probabilities": {"fast": 0.9, "reasoning": 0.1}},
                "memory_0": {"type": "noul", "noul": 0.9},
            },
        })

    monkeypatch.setattr(sdk, "AsyncTypeSafeClient", lambda **kwargs: real_client(**kwargs, transport=httpx2.MockTransport(fixture), compression=False))
    result = asyncio.run(JevDecisionProvider("contract-test-key").decide("创建任务", {"m1": "偏好上午工作"}))
    assert result.provider == "jev"
    assert result.intent == "task"
    assert result.relevant_memory_ids == ["m1"]
    assert seen[0]["questions"]["intent"]["type"] == "choice"


def test_timed_out_write_is_unknown_and_reconciled_without_replay():
    from personalos.integrations.hy_memory import MemoryWriteOutcomeUnknown

    class SlowClient(ContractClient):
        writes = 0
        request_id = None

        async def async_add(self, messages, **kwargs):
            self.writes += 1
            self.request_id = kwargs["request_id"]
            await asyncio.sleep(0.05)
            return {"success": True}

        async def async_get_write_outcome(self, request_id):
            assert request_id == self.request_id
            return {"status": "unknown"}

    async def check():
        value = service()
        value._client = SlowClient()
        value.timeout_seconds = 0.001
        with pytest.raises(MemoryWriteOutcomeUnknown) as failure:
            await value.add_confirmed("alice", "tea", source_id="source", consent=True, operation_id="stable-operation")
        assert failure.value.operation_id == "stable-operation"
        outcome = await value.write_outcome("alice", "stable-operation")
        assert outcome["status"] == "unknown"
        assert value._client.writes == 1

    asyncio.run(check())


def test_provider_operation_ids_are_scoped_without_delimiter_collisions():
    class OutcomeClient(ContractClient):
        async def async_get_write_outcome(self, request_id):
            return {"request_id": request_id}

    async def check():
        value = service()
        value._client = OutcomeClient()
        left = await value.write_outcome("a:b", "c")
        right = await value.write_outcome("a", "b:c")
        assert left["request_id"] != right["request_id"]

    asyncio.run(check())


def test_llm_deepseek_json_request_and_strict_routing():
    import json
    httpx = pytest.importorskip("httpx")
    from personalos.integrations.decision import LLMDecisionProvider

    async def fixture(request):
        body = json.loads(request.content)
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer contract-test-key"
        assert body["response_format"] == {"type": "json_object"}
        assert body["thinking"] == {"type": "disabled"}
        assert "tools" not in body
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "intent": "task", "model_tier": "fast", "relevant_memory_ids": ["m1"], "confidence": 0.8,
        })}}]})

    provider = LLMDecisionProvider(api_key="contract-test-key", base_url="https://api.deepseek.com", model="deepseek-flash",
                                   extra_body={"thinking": {"type": "disabled"}, "tools": ["injected"]},
                                   transport=httpx.MockTransport(fixture))
    result = asyncio.run(provider.decide("创建任务", {"m1": "偏好早上完成"}))
    assert result.provider == "llm"
    assert result.intent == "task"
    assert result.relevant_memory_ids == ["m1"]
    assert not hasattr(result, "authorized")


@pytest.mark.parametrize("payload,finish", [
    ({"intent": "delete_everything", "model_tier": "fast", "relevant_memory_ids": [], "confidence": 0.9}, "stop"),
    ({"intent": "task", "model_tier": "fast", "relevant_memory_ids": ["foreign"], "confidence": 0.9}, "stop"),
    ({"intent": "task", "model_tier": "fast", "relevant_memory_ids": [], "confidence": 0.9, "authorized": True}, "stop"),
    ({"intent": "task", "model_tier": "fast", "relevant_memory_ids": [], "confidence": 0.9}, "length"),
])
def test_llm_rejects_invalid_routes_unknown_memories_permissions_and_truncation(payload, finish):
    import json
    httpx = pytest.importorskip("httpx")
    from personalos.integrations.decision import LLMDecisionProvider

    async def fixture(request):
        return httpx.Response(200, json={"choices": [{"finish_reason": finish, "message": {"content": json.dumps(payload)}}]})

    provider = LLMDecisionProvider(api_key="contract-test-key", base_url="https://api.deepseek.com", model="deepseek-flash",
                                   transport=httpx.MockTransport(fixture))
    with pytest.raises(ValueError):
        asyncio.run(provider.decide("任务"))
    provider.fallback = RuleDecisionProvider()
    result = asyncio.run(provider.decide("任务"))
    assert result.provider == "rules"
    assert result.degraded_reason.startswith("llm:")
