# Integration evidence and boundaries

Verified from upstream on 2026-10-28. No external service API credentials were present; **credentialed service acceptance remains blocked**. Contract tests use explicitly named local test doubles and do not establish a real model or calendar connection.

## Hy Memory 2.0

Official sources: [repository](https://github.com/Tencent-Hunyuan/Hy-Memory), [usage API](https://github.com/Tencent-Hunyuan/Hy-Memory/blob/main/docs/usage.md), [client implementation](https://github.com/Tencent-Hunyuan/Hy-Memory/blob/main/hy_memory/client.py). Inspected upstream commit `1086f4d5827dcd5a37b354c6e1f30cded5d1f4c1`; PyPI reports `hy-memory==2.0.7`. The README currently recommends 2.0.4, so source and published README are not fully synchronized.

`HyMemoryService` is an optional independent boundary. It calls the official `HyMemoryClient` async APIs in `pro` mode, explicitly choosing `chat` or `working`. Chat extracts and reconciles long-term facts; Working requires actual tool traces. Provenance is passed in persistent `meta`, since the SDK's similarly named `metadata` is not guaranteed to persist. Caller consent is required before SDK indexing. The application must persist consent and SDK results in its memory ledger, reconcile ambiguous write timeouts, and prevent retrieval while deletion is pending. Supply a stable, persisted `operation_id` for each immutable memory write. The adapter scopes its SDK `request_id` to owner + operation ID, raises `MemoryWriteOutcomeUnknown` on timeout, and provides `write_outcome` for reconciliation. Never automatically replay timed-out writes.

Source review confirms SDK async methods bridge to a background event loop using a shielded future. Cancellation/timeouts in the ASGI caller therefore do not guarantee cancellation of the underlying write; it can finish later. SDK construction is offloaded from the ASGI loop and its in-flight initialization task is retained after caller timeout to prevent duplicate constructors. Update/delete timeouts likewise require readback before retry.

Supply server-side LLM and embedding configuration to the service via `HyMemoryClient.from_config` shape (`llm`, `embedder`, `vector_store` with matching embedding dimensions). Use durable SDK data directories on a mounted volume; the SDK keeps its own vector/graph and productivity metadata, separately from PersonalOS PostgreSQL. Multi-process writers against local SDK storage need deployment-specific validation before scaling.

### Deletion is not equivalent to complete privacy erasure

The inspected SDK client attempts vector, graph and retrieval clause removal; it also repairs evolution chains. Some auxiliary cleanup exceptions are logged and suppressed. Deletion history can retain the old content. A previously superseded fact may become current after its successor is removed. Therefore a successful SDK delete response alone is insufficient proof that all original or derived content, indexes, history, and cache copies have been purged.

The adapter verifies exact ID readback and returns `index_cleanup_verified=false` and `cache_cleanup_verified=false`. These flags intentionally remain false until storage-level evidence exists. The current implementation **does not claim complete SDK privacy erasure**. Before enabling SDK-backed memory for real private data, acceptance must include vector search absence, graph/evidence absence, tag/retrieval indexes, history/log payloads, caches, raw source and derived records, plus restart readback. Any failed component must leave deletion pending. SQL soft deletion by itself is also insufficient for a privacy purge.

User isolation: search always includes one authenticated `user_ids` entry. SDK ID-based get/update/delete do not grant authorization; the adapter checks the stored owner before mutation and hides missing/foreign IDs alike.

## TypeSafe AI Jev

Official sources: [quickstart](https://docs.typesafe.ai/introduction/quickstart), [Python SDK](https://docs.typesafe.ai/sdk/python), [source](https://github.com/typesafe-ai/typesafe-sdk-python). Inspected commit `f36e68549ceca3191e5791e5f99ea1baa1a258b5`; PyPI reports `typesafe-sdk==0.7.5` (Python >=3.10).

The verified API is `AsyncTypeSafeClient.system_one`, using `Choice` and `Noul`. `JevDecisionProvider` classifies task intent, chooses a model tier, and scores memory relevance. An explicit `RuleDecisionProvider` fallback can be configured. If fallback is used, the returned provider and degradation reason identify it. Without explicit fallback, configuration/auth/network errors surface to the caller. There are no fake Jev responses in product code.

`DecisionProvider` results are judgments only. The deterministic authorization and approval boundary must still validate user scope, tool allowlists, granted capabilities, immutable approved arguments and current approval state. Neither confidence nor the Jev result authorizes a side effect.

Routing logs record provider, route, model tier and confidence without prompt contents. Persist those fields in the application activity ledger for execution correlation. Do not enable SDK HTTP body debug logging for private conversations.

## Required real acceptance

1. Configure approved LLM and embedding credentials; install the pinned optional dependencies.
2. Confirm a memory in the Web UI, observe upstream request IDs and stored provenance, restart services, and verify long-term recall plus owner isolation.
3. Record a real tool trace, index as Working Memory, and inspect fact/experience recall.
4. Exercise conflicting facts and reconcile the shown current value; never silently overwrite user-confirmed provenance.
5. Run the complete storage-level deletion checks above; report incomplete erasure honestly.
6. Supply `TYPESAFE_API_KEY`, make a minimal real System One request, evaluate labeled Chinese/English task, calendar, memory and automation examples, then check routes against approved actions. A package import or successful HTTP connection is not model-quality acceptance.

## Local verification evidence

- Python 3.12.12 on macOS arm64. Official `typesafe-sdk==0.7.5` installed and imported successfully.
- `PYTHONPATH=apps/api python -m pytest apps/api/tests/test_providers.py -q -o asyncio_default_fixture_loop_scope=function`: 19 passed in an isolated Python 3.12 environment, including actual TypeSafe SDK request serialization/response parsing and ordinary LLM HTTP JSON contracts with explicitly labeled local HTTP fixtures.
- These tests cover owner isolation, consent, real-trace requirement, truthful deletion flags, deterministic fallback, and ambiguous write timeout reconciliation. They do not establish live Jev/Hy model behavior or complete SDK erasure.
- Full `hy-memory==2.0.7` dependency installation was attempted in the isolated Python 3.12 environment. It failed after three retries fetching `build-1.6.1-py3-none-any.whl.metadata` from `files.pythonhosted.org` (network operation timed out). The official 2.0.7 wheel was subsequently installed with `--no-deps`; real `from hy_memory import HyMemoryClient` and `inspect.signature` checks passed for every adapter method. The release wheel source also confirms `async_get` owner fields, Working trace requirements, CRUD namespace arguments and `async_get_write_outcome`. However, `chromadb`, `kuzu`, `numpy` and `openai` are absent in that isolated environment. Complete SDK data-plane initialization, vector persistence and live extraction/recall remain **blocked and unverified**. A successful lightweight SDK import does not establish a working memory engine.

## Ordinary LLM decisions / DeepSeek

`LLMDecisionProvider` implements the same `DecisionProvider` boundary through an actual OpenAI-compatible `POST /chat/completions` request. It accepts server-side `api_key`, `base_url` and `model`; a caller can reuse its decrypted per-user model configuration. Responses must satisfy a strict Pydantic schema (extra fields forbidden), contain only supplied memory IDs, and finish normally. Missing credentials, timeouts, incomplete JSON and schema errors surface unless a rule fallback was explicitly selected. No decision output grants authorization.

DeepSeek's [official Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/) confirms JSON output via `response_format={"type":"json_object"}` and instructing the model to emit JSON. Model names are configurable rather than assumed. The optional model-specific `thinking` setting is forwarded; arbitrary extra fields cannot override messages or inject tools. Provider URL validation reuses the shared public HTTPS policy, redirects are disabled, and API keys/prompt content are absent from decision logs.

This lets one DeepSeek configuration serve both conversation generation and routing judgments when explicitly selected. Hy Memory can also use an OpenAI-compatible DeepSeek LLM endpoint for extraction/reconciliation, but still needs a separately authorized embedding model endpoint. Jev remains an optional specialized provider. None of these external services has passed credentialed live acceptance in this run.

The 19 provider checks include successful ordinary-LLM JSON serialization/parsing, invalid route rejection, unknown memory ID rejection, forbidden authorization field rejection and truncated response rejection. All HTTP response fixtures are explicitly test-only; these checks do not claim a live DeepSeek inference.
