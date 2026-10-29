# API guide

The authoritative machine-readable schema is `GET /api/openapi.json`; browse `/api/docs` on the running API. All resource endpoints require the HttpOnly session set by registration/login. Owner IDs are derived from the session and cannot be supplied by the browser.

Registration/login passwords use the same 8–256 character constraint. Existing passwords and session records are preserved. Validation diagnostics omit input values and context so passwords and API keys cannot be echoed by a failed request. UI language is a browser preference (`system`, `zh-CN`, `en`), independent from user data and API protocol values; it does not change Agent output or stored content.

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me` | Account/session lifecycle; Redis-backed authentication rate limit |
| `GET /api/dashboard` | Actual account tasks, earliest four overlapping local events in the next seven days, pending approvals, schedules and latest briefing |
| `GET/POST /api/tasks`; `PATCH/DELETE /api/tasks/{id}` | Task history, priorities, deadlines, optimistic updates; deletion approval |
| `GET/POST /api/memories`; `PATCH/DELETE /api/memories/{id}` | Search/proposal/confirmation/edit/source/deletion approval |
| `GET/POST /api/events`; `PATCH/DELETE /api/events/{id}` | Local calendar and interval conflict detection; external write approval |
| `GET /api/calendar/oauth/start`, `/callback` | Google authorization URL and one-use state-bound callback |
| `GET /api/calendar/google/events?start=...&end=...` | Real provider events after OAuth; credentials remain server-side |
| `GET/POST /api/automations`; `PATCH/DELETE /api/automations/{id}` | Persistent schedule create/pause/resume/cancel |
| `POST /api/automations/{id}/retry`; `GET .../{id}/runs` | Explicit retry and run history; unknown outcomes cannot blindly retry |
| `GET/POST /api/integrations`; `PATCH/DELETE .../{id}` | Explicit trust and tool permissions; administrator host allowlisting |
| `GET /api/integrations/{id}/tools`; `POST .../{id}/call` | MCP discovery and approved execution |
| `GET /api/approvals`; `POST /api/approvals/{id}/resolve` | Review frozen tool/arguments; approve/reject with version |
| `GET /api/activity` | Audit, routing decisions, tools and durable Worker executions |
| `GET/PATCH /api/settings` | Profile/privacy/model settings; only key-configured boolean is returned |
| `POST /api/settings/chat/test`, `/api/settings/embedding/test` | Real fixed-content probe of current draft or saved model settings, with a version-bound receipt |
| `POST /api/settings/chat/models` | Discover real models through the configured OpenAI-compatible provider |
| `POST /api/settings/chat/balance` | Query the official DeepSeek account balance; explicit unsupported result for other endpoints |
| `GET /api/export` | Complete tenant export from a repeatable-read snapshot; credentials omitted |
| `GET/POST /api/briefings` | Briefing history and generation from actual data |
| `GET /api/chat/sessions`; `GET .../{id}/messages` | Account-owned conversations and persisted visible messages |
| `POST /api/chat/stream` | `{message,session_id?,model?}`; SSE `session/status/token/tool/error/done` |

Lists return JSON arrays. Resource fields include `id`, `created_at`, `updated_at`, `version`, `deleted_at` and `extra`; domain fields vary. PATCH bodies include a positive `version`. DELETE requests include `?version=N`; approval responses use HTTP 202 and do not mean the deletion has executed. Approval resolution uses `{decision:"approved"|"rejected",version:N}`. A stale version returns HTTP 409; refresh and review the new state.

Task status: `todo`, `in_progress`, `done`, `cancelled`. Memory state: `pending`, `confirmed`, `superseded`, `deletion_pending`, `deleted`. Schedule state: `active`, `paused`, `cancelled`, `completed`. Execution state: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `outcome_unknown`. Unknown outcome must be reconciled before retry.

SSE is newline-delimited event framing (`data: {JSON}\n\n`). After persistence, the response includes `X-Session-ID` and first emits `{type:"session",session_id}` before model work. Pin this ID immediately so failure/cancellation can recover the same conversation. A token event carries `content`; done and error events carry `session_id`. Errors are explicit events after streaming starts, or regular non-2xx JSON if preconditions fail. Handle an error event or EOF without `done` as failure even though the HTTP stream began with 200, and refresh the session list after failure/cancellation.

An unavailable model or missing server OAuth configuration returns 503. Provider/network failures do not become successful empty data. All event timestamps include timezones. Tool parameters are validated by Pydantic and server-owned allowlists; neither a model selection nor a decision score authorizes an operation.

## Local calendar visible windows

`GET /api/events` keeps its existing array response and default `limit=100`, maximum 200, with `offset>=0`. Without a window it retains the legacy creation-time ordering. CalendarPage now supplies both `start` and `end` as timezone-aware ISO timestamps for its visible 42-day grid. A missing counterpart, missing timezone or `start>=end` returns 422.

Windowed results include non-deleted events owned by the current user where `event.start_at < end` and `event.end_at > start`, ordered by `start_at,id` before pagination. The page requests batches of 200 until a short page, publishes only a fully loaded window and forwards AbortSignal on navigation. This removes the previous truncation before month filtering. Offset pagination has stable ordering but does not promise a multi-request snapshot while another client edits events.

The grid and daily agenda display overlapping events on every covered day, with an exclusive end boundary. Date-only Google values are interpreted as local calendar dates. Switching months moves the selected day into the target month, and an unloaded or failed source is never labeled as an empty day. Google still requires OAuth and its server-side pagination is a separate pending item; this local fix is not evidence of a live Google integration.

Settings include a read-only `google_calendar_connection` (`{id,version}` or `null`), derived from the current owner/provider/connection state before any list pagination. No provider token is returned. The built-in calendar requires no Google configuration. Unconnected Google views are optional setup states and do not request provider events; failed connection-status reads and actual provider failures remain explicit errors. The Agent's `list_calendar_events` reads the full overlapping local seven-day window; briefings read the full rolling 24-hour window. Both share their exact timestamps with an already connected Google source. These internal reads have no row-count truncation, while the public `/events` page-size contract is unchanged. Very dense windows remain subject to model context limits and existing deadlines, rather than returning a fabricated or silently shortened briefing.

## Additional safety endpoints and fields

`PATCH /api/calendar/google/events/{event_id}` and `DELETE` at the same path create approvals bound to the provider event and ETag. `POST /api/calendar/google/events/{event_id}/undo` requests reversal of a created event. `POST /api/integrations/{id}/disconnect` requests OAuth revocation. `POST /api/account/delete` requests full account erasure; approval is refused while an Agent is active or unresolved external memory purge remains.

Model settings optionally include `fast_model`, `reasoning_model` and `decision_provider` (`rules`, `llm`, `jev`). The selected route is recorded with the actual model. A briefing automation sets `extra.kind="briefing"`; the Worker invokes the real briefing service and persists its history. Memory conflict keys and replacement IDs live in validated `extra.fact_key` and `extra.supersedes`; the UI presents these as memory topics and replacement choices.

Exports include all visible records, messages, schedules and execution history without row-count truncation. The JSON stream reads PostgreSQL in batches of 500 and holds an account lease until the download ends; clients should handle an interrupted download as incomplete.

## AI setup and chat settings

`GET /api/settings` reports `chat_configured`, `ai_setup_complete` (chat and embedding configuration present), `chat_config_source` (`personal`, `server_default`, `missing`) and `missing_configuration_fields` with separate `chat` / `embedding` arrays. These indicate configuration completeness, not provider connectivity or Hy-Memory readiness. Ordinary chat requires only chat configuration; missing chat settings return 503 before a user message is persisted.

All four diagnostics accept an optional JSON body. Omit it or send `{}` to use saved settings. The Web submits `version` and the current form fields; a stale version returns 409. Chat accepts `model`, `base_url`, `api_key`; embedding accepts `embedding_model`, `embedding_base_url`, `embedding_api_key`, `embedding_dimensions`. Omitted fields use saved values, except an omitted key is reused **only when the effective endpoint is unchanged**. An explicit empty key disables it for that request. Drafts are never persisted or placed in a query/cache key. Enter a new key when changing endpoints; saving an endpoint change with an old personal key but no new key is rejected with 422.

`POST /api/settings/chat/test` calls the effective chat model through the official SDK using a fixed, non-private prompt, a 20-second total deadline and no retries or redirects. Success returns `{status:"ok",model,settings_version}`. Missing configuration returns 503; network/provider/invalid text returns 502; provider throttling returns 429. All diagnostics hold an account lease and audit operation/model/version/status, never keys or provider response bodies. A probe creates no conversation, graph checkpoint or memory. A receipt belongs only to that settings version and draft revision.

`POST /api/settings/chat/models` requires only Base URL and Key, not a Model ID. It calls official `AsyncOpenAI.models.list()` and validates a single bounded page (at most 1000 items), removes duplicate IDs and returns `{provider,models:[{id,owned_by,name?}],settings_version}`. Empty results remain empty. Unsupported discovery is an error; manual Model ID entry remains available. Settings automatically discovers a saved configured connection once per version, and offers a manual refresh for drafts.

Model-list and balance responses, including upstream error bodies, are bounded to **1 MiB before SDK JSON parsing**. Requests use `Accept-Encoding: identity`; unexpected compression is explicitly rejected before decoding, so compatible providers must honor uncompressed responses. No SDK pagination link is followed.

`POST /api/settings/chat/balance` returns `{provider:"deepseek",supported:true,is_available,balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}],settings_version}` only for HTTPS `api.deepseek.com` with root or `/v1`, standard port and no user info/query/fragment. The SDK sends `/user/balance` from the fixed official root, even when chat uses `/v1`. Other endpoints return `{provider:"openai_compatible",supported:false,settings_version}` without a provider call. Amounts stay validated decimal strings and are displayed by currency; no cross-currency sum. Discovery and balance have a 20-second total deadline, no retries/redirects and safe validation/error messages. Upstream 401/402/403/404 are returned as application 502 with descriptive diagnostics; upstream 429 remains 429. Balance availability, model access and inference success are independent signals.

`api_key` is write-only. Omission preserves it; an explicit empty value disables fallback to the administrator key. Administrator credentials are used only with their own configured endpoint, for both chat and embedding. An endpoint override cannot forward an administrator key to a different service/workspace.

## Embedding settings

`GET/PATCH /api/settings` includes `embedding_model` (`qwen3.7-text-embedding` or `qwen3.7-text-embedding-flash`), `embedding_dimensions`, `embedding_base_url`, and write-only `embedding_api_key`. Standard-model dimensions are 2560/2048/1536/1024/768/512/256; Flash dimensions are 1024/768/512/256. The normal default is 1024, and the previous Flash fallback is preserved for compatibility. Partial settings writes validate the effective saved-plus-draft model/dimension pair before committing; for example, Flash plus 1536 returns 422 without changing settings. Environment configuration and connection probes enforce the same pair. Responses expose `embedding_api_key_configured`, `embedding_configured`, namespace and `embedding_index_status=hy_not_enabled`, never the secret. An omitted key is preserved; an explicit empty key clears it without falling back to another user's or administrator's credential.

The Beijing endpoint allowlist includes the exact legacy public host `dashscope.aliyuncs.com` and a single valid workspace label under `.cn-beijing.maas.aliyuncs.com`. Both require HTTPS, standard port, `/compatible-mode/v1`, no user info, query or fragment. Overseas hosts, lookalike suffixes and placeholders remain rejected. Workspace endpoints are recommended by the provider; the public endpoint remains available for compatibility. No automatic rewrite, key transfer or index namespace merge occurs between URLs.

`POST /api/settings/embedding/test` tests the current draft or saved settings with a fixed probe. A valid provider response returns `{status:"ok",provider:"dashscope",model,dimensions,settings_version}`. Missing key/URL returns 503; invalid Beijing workspace/unsupported dimensions returns 422; provider failure or mismatched vectors returns 502 (provider throttling 429). A receipt confirms only that call, not Hy indexing or semantic search readiness.

## Task, memory and automation completeness

Tasks and memories keep array responses and `limit=100`/maximum200/`offset>=0`; order is now stable `created_at DESC,id DESC`. Automation lists add the same bounds with their existing default200; per-automation runs add offset and maximum200 while keeping default100. All filter owner/deleted state before pagination. Run history still checks ownership of its parent automation. The Web reads all pages before presenting a successful list; a failed later page is an error, and a full page with no new IDs is rejected as non-advancing pagination. Offset pages do not provide a concurrent-write snapshot.

The `list_tasks` Agent tool returns all open tasks by default. `include_completed=true` selects explicit history pages using limit1..200 and offset>=0; the model must continue until a short page to read all history. Briefings use all open tasks, and dashboard previews five open tasks; completed/cancelled history cannot hide them. Very large open sets remain subject to model context/deadline limits.

Memory PATCH only confirms when the submitted payload explicitly includes `status:"confirmed"`. Changes otherwise become pending; `status:"pending"` withdraws canonical recall eligibility. User-editable extra (fact_key/supersedes/tags) is validated separately from stored provider/index metadata, which clients cannot inject or overwrite. Successful LangGraph Store retries clear only their own pending marker through a version/account fence; this does not establish Hy-Memory index health. Approved deletion was checked against the actual local Store. Partial deletion failure recovery and externally authorized Hy deletion remain separate acceptance gates.

The automation editor preserves null cron for one-time tasks. Per-automation expandable history includes scheduled time, status, attempts, safe stored error and result; it reads all pages when expanded. Existing Worker claim/lease/retry semantics are unchanged.
