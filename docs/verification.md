# PersonalOS verification report · 2026-10-28

## Configuration and Agent reliability follow-up

Fixed stale settings drafts rebasing onto a newer server version; early/persisted chat session recovery; same-origin tab identity/cache synchronization; malformed service URL errors; redirect following in actual Agent calls; and total connection-probe deadlines. No table, migration or test case file was added. The full original feature plan and external authorization gates remain in place.

- Existing backend suite: **51 passed (6.31s)**. Existing real-runtime browser E2E: **1 passed (18.5s)**. Web TypeScript, ESLint, isolated production build and backend Ruff passed.
- An isolated loopback QA Web/API pair used separate browser cookies and dedicated QA accounts. Its administrator model endpoint was explicitly a **failure-only local HTTP fixture**, with no genuine provider credentials. Two real UI sends both failed, retained both messages in one saved conversation, and refreshed the history list. The fixture recorded two chat requests and zero redirect-target requests. This proves local failure handling and redirect refusal, not a successful model integration.
- A continuous slow-response fixture caused the real saved-chat probe to return 502 after **20.01 seconds**. A settings write immediately afterwards returned 200. Three malformed URL/port/IPv6 requests returned 422. No external service was called.
- Two actual QA tabs reproduced a stale draft: the newer tab saved successfully; the old draft received **409**, retained its local value and disabled save/key removal/probes. Cancelling the reload prompt kept the draft; a full page reload then read the newer server value. The affirmative native-confirm branch was code-reviewed, not exercised through the browser tool.
- Same-origin QA tab logout removed the old workspace in the other tab; registering a second QA account replaced both the account name and its model configuration there. The original user's localhost cookies, account and secrets were untouched. The no-broadcast focus fallback was reviewed; the broadcast path was exercised in the real browser.
- Temporary QA tabs and all three local fixture/QA services were stopped after acceptance. Screenshot: `docs/evidence/settings-version-conflict.png`. Existing evidence images and generated Next.js type-path changes were restored.
- Runtime DNS validation and redirect refusal do not pin resolved addresses; deployment egress controls remain required against DNS rebinding. Real chat/tool/embedding quality and Google/Hy/Jev/MCP acceptance still require the authorized external services described below.

## System language and eight-character passwords · 2026-10-28

The interface now defaults to `system` and supports Simplified Chinese/English. The server resolves the browser's `Accept-Language` plus a validated preference cookie; the client observes `navigator.languages`, `languagechange` and explicit choices. Login and Settings share a persistent language selector. Explicit dictionaries cover the nine pages, configuration screens, accessibility labels, statuses, prompts, known errors and locale-aware dates. User content, model output, model IDs, API enum values and tool arguments remain original. No table/migration or external translation service was added.

- Existing backend tests: **51 passed (7.35s), no skips**; Ruff passed. Existing full real-runtime Playwright E2E: **1 passed (19.5s)**. No test case files were added or modified.
- Web TypeScript, ESLint and isolated production build passed. Dynamic rendering of the layout is intentional, so the initial language is resolved for each request.
- Manual SSR requests confirmed Chinese/English selection, unsupported-language English fallback, explicit English override over a Chinese preference, and exclusion of `q=0` languages. Both `<html lang>` and the document title matched.
- Real browser: Chinese system preference rendered the workspace in Chinese; manual English changed text/accessibility labels immediately and survived reload; switching back to system restored Chinese. The original user name and model IDs remained unchanged. At 390px, document width remained 390px; the viewport override was reset afterwards. Desktop and mobile evidence: `docs/evidence/language-*.png`.
- Disposable QA account: seven-character registration returned 422 without input/context echo; eight-character registration returned 201 and login returned 200 with a matching authenticated account. Existing user passwords were not changed. Credentials remain hashed and rate limiting is unchanged.
- Static translation review found no untranslated fixed JSX text or missing literal translation keys in the workspace/configuration components. Unknown provider diagnostics remain visible in their original text; configuring a language does not claim successful external model/Calendar/Hy/Jev acceptance.

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

## Qwen embedding configuration change · 2026-10-28

Full Python suite after this change: **51 passed (5.02s), no skips**. Seven added checks use official SDK HTTP fixtures and real PostgreSQL configuration/isolation; they do not establish live Bailian availability. Settings select the Beijing Qwen3.7 Flash model with a separately encrypted key, strict dimensions, a fixed-input connection probe and an official Hy configuration bridge. UI and container evidence for this revision is recorded in the PR. User explicitly chose to enter workspace URL/key later; Hy indexing remains disabled and requires its own accepted data plane. Prior image IDs/screenshots in the baseline report describe the preceding candidate, not this revision.

Qwen revision UI/container checks: TypeScript, ESLint and production builds passed. Actual browser inspection verified isolated settings, dimension persistence, no key echo, a rejected missing-URL save and the real missing-credential 503. Updated full Docker E2E: **1 passed (18.6s)**, including the fixed provider ID, password field and real 503 probe response. No successful live model call is claimed.

## AI configuration onboarding · 2026-10-28

The workspace now exposes two independent setup steps: chat Model ID/Base URL/API key and Beijing Qwen embedding Base URL/key/dimensions. Settings completeness is distinct from real saved-connection checks. Missing chat configuration is intercepted before submitting a conversation or briefing; manual workspace features remain usable. Chat and embedding credentials remain separately encrypted, never echoed. Administrator keys are bound to their administrator endpoint, and explicitly cleared personal keys disable fallback.

- Existing backend suite: **51 passed (4.83s), no skips**; Ruff passes. No test files were added or changed for this revision, following the user's latest instructions.
- Manual HTTP acceptance against the hot-reloaded API used a separate disposable QA account: registration 201, incomplete statuses, unconfigured chat probe 503, saved/cleared configuration round-trip 200, trimmed model ID, no secret fields in responses, and zero conversations created by the probe. Synthetically named configuration values exercised persistence only; they were cleared and never sent to a provider.
- Local configuration inspection with disposable in-process values confirmed that administrator keys are available only at their original endpoints; endpoint overrides, explicit clears and whitespace-only keys expose no effective key. This inspection made no external requests.
- Existing full browser E2E: **1 passed (18.8s)** against the real local Web/API/PostgreSQL runtime. Additional manual browser checks confirmed missing-configuration sends create zero chat requests/messages and preserve input; both incomplete probes return 503; configuration without a key remains incomplete; switching accounts restores that account's own settings. Mobile has no horizontal overflow and no browser page errors were observed. New desktop/mobile/dark screenshots are `docs/evidence/ai-setup-*.png`.
- Web TypeScript, ESLint (zero warnings/errors) and production build passed. `NEXT_DIST_DIR=.next/verify-build` isolates the acceptance build from the running development server; `http://localhost:3000/settings` still returns 200 afterwards. Generated TypeScript path changes and prior screenshots were restored; only four new setup screenshots are committed.
- Real user model credentials remain absent. Successful chat/embedding connectivity, live model quality, vector indexing and Hy-Memory data-plane behavior are not claimed by this change.
