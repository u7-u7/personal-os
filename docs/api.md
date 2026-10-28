# API guide

The authoritative machine-readable schema is `GET /api/openapi.json`; browse `/api/docs` on the running API. All resource endpoints require the HttpOnly session set by registration/login. Owner IDs are derived from the session and cannot be supplied by the browser.

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me` | Account/session lifecycle; Redis-backed authentication rate limit |
| `GET /api/dashboard` | Actual account tasks, events, pending approvals, schedules and latest briefing |
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
| `POST /api/settings/chat/test`, `/api/settings/embedding/test` | Real fixed-content probe of saved model settings, with a version-bound receipt |
| `GET /api/export` | Complete tenant export from a repeatable-read snapshot; credentials omitted |
| `GET/POST /api/briefings` | Briefing history and generation from actual data |
| `GET /api/chat/sessions`; `GET .../{id}/messages` | Account-owned conversations and persisted visible messages |
| `POST /api/chat/stream` | `{message,session_id?,model?}`; SSE `status/token/tool/error/done` |

Lists return JSON arrays. Resource fields include `id`, `created_at`, `updated_at`, `version`, `deleted_at` and `extra`; domain fields vary. PATCH bodies include a positive `version`. DELETE requests include `?version=N`; approval responses use HTTP 202 and do not mean the deletion has executed. Approval resolution uses `{decision:"approved"|"rejected",version:N}`. A stale version returns HTTP 409; refresh and review the new state.

Task status: `todo`, `in_progress`, `done`, `cancelled`. Memory state: `pending`, `confirmed`, `superseded`, `deletion_pending`, `deleted`. Schedule state: `active`, `paused`, `cancelled`, `completed`. Execution state: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `outcome_unknown`. Unknown outcome must be reconciled before retry.

SSE is newline-delimited event framing (`data: {JSON}\n\n`). A token event carries `content`; done carries `session_id`. Errors are explicit events after streaming starts, or regular non-2xx JSON if preconditions fail. Handle an error event as failure even though the HTTP stream began with 200.

An unavailable model or missing server OAuth configuration returns 503. Provider/network failures do not become successful empty data. All event timestamps include timezones. Tool parameters are validated by Pydantic and server-owned allowlists; neither a model selection nor a decision score authorizes an operation.

## Additional safety endpoints and fields

`PATCH /api/calendar/google/events/{event_id}` and `DELETE` at the same path create approvals bound to the provider event and ETag. `POST /api/calendar/google/events/{event_id}/undo` requests reversal of a created event. `POST /api/integrations/{id}/disconnect` requests OAuth revocation. `POST /api/account/delete` requests full account erasure; approval is refused while an Agent is active or unresolved external memory purge remains.

Model settings optionally include `fast_model`, `reasoning_model` and `decision_provider` (`rules`, `llm`, `jev`). The selected route is recorded with the actual model. A briefing automation sets `extra.kind="briefing"`; the Worker invokes the real briefing service and persists its history. Memory conflict keys and replacement IDs live in validated `extra.fact_key` and `extra.supersedes`; the UI presents these as memory topics and replacement choices.

Exports include all visible records, messages, schedules and execution history without row-count truncation. The JSON stream reads PostgreSQL in batches of 500 and holds an account lease until the download ends; clients should handle an interrupted download as incomplete.

## AI setup and chat settings

`GET /api/settings` reports `chat_configured`, `ai_setup_complete` (chat and embedding configuration present), `chat_config_source` (`personal`, `server_default`, `missing`) and `missing_configuration_fields` with separate `chat` / `embedding` arrays. These indicate configuration completeness, not provider connectivity or Hy-Memory readiness. Ordinary chat requires only chat configuration; missing chat settings return 503 before a user message is persisted.

`POST /api/settings/chat/test` calls the saved chat model through the official SDK using a fixed, non-private prompt, a 20-second SDK timeout and no retries or redirects. Success returns `{status:"ok",model,settings_version}`. Missing configuration returns 503; network/provider/invalid text returns 502; provider throttling returns 429. Audits contain model/version/status, never keys or provider response bodies. The probe creates no conversation, graph checkpoint or memory. A receipt belongs only to the returned settings version and that individual request.

`api_key` is write-only. Omission preserves it; an explicit empty value disables fallback to the administrator key. Administrator credentials are used only with their own configured endpoint, for both chat and embedding. An endpoint override cannot forward an administrator key to a different service/workspace.

## Embedding settings

`GET/PATCH /api/settings` includes `embedding_model` (fixed `qwen3.7-text-embedding-flash`), `embedding_dimensions` (1024/768/512/256), `embedding_base_url`, and write-only `embedding_api_key`. Responses expose `embedding_api_key_configured`, `embedding_configured`, namespace and `embedding_index_status=hy_not_enabled`, never the secret. An omitted key is preserved; an explicit empty key clears it without falling back to another user's or administrator's credential.

`POST /api/settings/embedding/test` tests only the saved settings with a fixed probe. A valid provider response returns `{status:"ok",provider:"dashscope",model,dimensions,settings_version}`. Missing key/URL returns 503; invalid Beijing workspace/unsupported dimensions returns 422; provider failure or mismatched vectors returns 502 (provider throttling 429). A receipt confirms only that call, not Hy indexing or semantic search readiness.
