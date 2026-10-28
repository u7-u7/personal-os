# PersonalOS verification report · 2026-10-28

Status: runnable development candidate, **not a completed credentialed external-service acceptance**. Full original scope remains in the PRD and seven-day plan. Local test fixtures are identified below and are never product responses.

## Verified facts

| Layer | Actual result | Evidence / command |
|---|---|---|
| Repository | Independent public `u7-u7/personal-os`; no existing code overwritten; feature branch; no merge | Git history and PR |
| Python safety/protocol suite | **43 passed, no skips, 5.18s** with the optional real Jev SDK installed | `TEST_DATABASE_URL=... uv run --no-sync --project apps/api --env-file .env pytest apps/api/tests -q` |
| Backend checks | Ruff passes for services, providers and tests | `apps/api/.venv/bin/ruff check apps/api/personalos apps/api/tests` |
| API PostgreSQL checks | 15 safety scenarios plus full export and topic-before-pagination regressions with per-test isolated real PostgreSQL schemas | `tests/test_api.py`: isolation, CAS, approval replay, secrets, memory conflict/search/erasure, active leases, account erasure, MCP binding and calendar concurrency |
| Full export | Real PostgreSQL: 10,007 task records, 205 schedules, 1,001 messages and execution history exported completely; owner isolation and credential exclusion pass | `tests/test_export.py`; no hard row-count caps |
| Agent protocol | Real official ChatOpenAI, LangGraph tools and PostgreSQL saver/store; **only HTTP SSE bytes are a named test fixture** | `tests/test_agent_protocol.py`: actual task persistence, route selection, confirmed owner-only memory, checkpoint restoration across requests |
| Worker transactions | 6 real PostgreSQL checks | `tests/test_worker.py`: concurrent scheduling/claim, stale-token fencing, timeout, erased run late result, and >100 paused jobs |
| Provider contracts | 19 pass with actual installed TypeSafe SDK; named HTTP fixtures | `tests/test_providers.py`; [upstream evidence](integrations.md) |
| Web source | TypeScript, ESLint and Next production build pass | `npm run typecheck`, `npm run lint`, `npm run build` in `apps/web` |
| Browser | One real-API Playwright scenario passes (17.5s latest local run); screenshots stable and visually inspected | `apps/web/e2e/workspace.spec.ts`; [screenshots](evidence/dashboard.png) |
| Migration | Frozen Alembic 0001 runs on isolated local and fresh Docker PostgreSQL17 | `alembic upgrade head` |
| API image | Actual Linux production image built, unprivileged API runs healthy | Final Docker API image `c84fe30d9967`; hash-pinned dependency export, mirror used after official downloads timed out |
| Compose backend | Fresh Postgres/Redis/API/Worker healthy; migration exits 0 | [container smoke](evidence/container-smoke.json) |
| Real independent Worker | Two process runs leave one failed occurrence with attempt=1; no made-up answer | [worker smoke](evidence/worker-smoke.json) |
| Query IO evidence | Four real EXPLAIN ANALYZE/BUFFERS plans plus actual index definitions | [query plans](evidence/query-plans.json); tiny development data, not a production load benchmark |
| Web image | Linux Node24 production build passes; unprivileged standalone image starts | Final Docker Web image `cdd9b4391e15` |
| Complete Compose browser | Final full isolated stack on port 3300: **1 passed (17.3s)** | Real containers and actual cookie/API/database workflows |
| GitHub Actions | Workflow provided; remote result must be read from the PR | Local checks do not establish hosted CI success |

The browser uses actual registered fixture accounts and API/database writes: task create/complete/approved delete, memory pending/confirm/topic conflict and explicit supersession, local event creation, automation pause/resume and briefing type persistence, nine routes, server-side query search, unsaved DeepSeek preset, explicit missing-model error, theme persistence and 390px overflow checks. The screenshot account is synthetic test input, not preloaded product data. A model response is never inserted when credentials are absent.

## Remaining external gates

- **DeepSeek/OpenAI-compatible model:** no user API key supplied. Preset, SDK protocol and streaming/tool contracts are implemented and locally checked; real streaming completion, live tool selection, quality, quota and latency remain unverified.
- **Google Calendar:** OAuth app credentials and user consent absent. Real token exchange/refresh/list/create/update/delete/undo/revoke code exists; successful real provider effects and conflict readback remain unverified.
- **Hy-Memory 2.0:** user deferred authorization. Official release imported and signatures inspected; optional adapter implemented. Complete SDK dependencies/data plane, LLM+embedding authorization, vector recall, Working tool experience and storage-level purge are not accepted. Application canonical memory currently uses PostgreSQL/Store, not a fabricated Hy connection.
- **Jev:** official SDK installation/serialization tested. User deferred service credentials; actual Jev judgment quality/availability remains unverified. Rules and ordinary LLM are explicit replacements; decisions never authorize actions.
- **MCP:** discovery/calls, host allowlist, user trust, per-tool permission and bound approvals exist. No authorized public server supplied, so no credentialed external call is claimed.

## Privacy and reliability limits

Approved memory deletion suppresses canonical recall, removes its Store entry and resets graph checkpoints. Visible chat transcripts remain under the user's control; old user/assistant text is not silently rewritten. Hy's precise-ID absence alone cannot establish full index/cache/history erasure. Account deletion is separately approved, uses a nonblocking exclusive account lease, revokes connected Google tokens, clears account content/secrets/sessions/checkpoints and leaves a nonpersonal receipt. Operator backups follow the deployment's retention policy.

Timeout or expired lease becomes `outcome_unknown`, with blind retry blocked. External write approvals freeze parameters and connector/provider versions; no generic remote service can be promised exactly-once effects without its own idempotency support. SMTP/email sending is available only through an explicitly connected, approved MCP tool; there is no built-in mailbox connection to pretend is working.

## Bugs found and fixed in this run

- Moving LangGraph setup to startup removed a request's concurrent-index migration self-lock.
- Binding MCP approvals to connector version and endpoint hash prevented post-approval destination changes.
- Redacting legacy proposal audit content and clearing Store/checkpoints prevented local recall copies from surviving approved deletion.
- Account leases, fresh SQL write checks and nonblocking row locks prevented in-flight account erasure from accepting late writes or blocking the event loop.
- Calendar transaction fences closed concurrent overlap checks; token refresh no longer commits away the write fence.
- Filtering paused schedules before queue LIMIT removed starvation beyond the first hundred jobs.
- Screenshot waits removed fade-animation and sidebar transition frames; source test success alone was not treated as visual proof.
- Dependency mirror support preserves lock versions and hashes after the first official-registry container download timed out.
- Streaming export removed legacy record/message/schedule caps and preserves a read-only consistent snapshot across its full download.

## Reproduce

Follow the README using a disposable test database. Install `--extra dev --extra jev` before running the full suite. Run `scripts/smoke_worker.py` only against a disposable local instance without a model key. Never use its expected failure as evidence that a real model succeeded. Provider acceptance above requires the user's own authorized services.
