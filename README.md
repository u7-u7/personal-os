# PersonalOS

A personal AI workspace for conversations, consent-controlled memory, tasks, calendars and durable automation. Built as an independent open-source Agent engineering course project.

**Development candidate:** inspect [verification](docs/verification.md) for what actually ran. A configured connector or an installed SDK is not proof of a successful external integration. No sample task, meeting or AI answer is substituted for real user data.

## Run with Docker

Requirements: Docker Engine/Compose and Python 3 for the secret-generation helper. If package downloads are restricted, an optional `PYPI_INDEX_URL` build setting selects a mirror; exported dependency versions and SHA-256 hashes still come from the committed official-source lock.

```sh
python3 scripts/bootstrap.py
docker compose up --build -d
```

Open [PersonalOS](http://localhost:3000/dashboard) and register an account. API reference: [interactive OpenAPI](http://localhost:8000/api/docs). PostgreSQL and Redis are private to the Compose network; the default Web/API ports bind to loopback. Use a TLS reverse proxy and set `APP_URL`, `WEB_ORIGIN`, `GOOGLE_REDIRECT_URI` and `COOKIE_SECURE=true` before public deployment. Set a strong database password and retain the generated encryption key securely: replacing it prevents decrypting existing credentials.

`migrate` completes before API starts; Worker starts only after API health succeeds. Persistent volumes survive restarts. Do not run `docker compose down -v` unless you intend to destroy your database and Redis data. Back up PostgreSQL and the encryption key before upgrades; never blindly downgrade a live database.

## Local development

The interface defaults to the browser/system's preferred language, with Simplified Chinese and English supported; other language preferences fall back to English. Use the language selector on the sign-in page or in Settings to override it or return to **Follow system**. The choice is device/browser-level, persists across reloads, and applies to text, accessibility labels and date formatting; user content and model output are never translated automatically. The server uses `Accept-Language` and the preference cookie for a matching first render. Registration and login accept passwords of **8–256 characters**; existing passwords are unchanged.

Requirements: Python 3.12, uv, Node.js 24, PostgreSQL 17 and Redis 7.

```sh
python3 scripts/bootstrap.py # once; refuses to overwrite an existing .env
# Start only infrastructure; keep API/Web running in local terminals.
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres redis
uv sync --project apps/api --extra dev --extra jev
(cd apps/api && uv run --env-file ../../.env alembic upgrade head)
uv run --project apps/api --env-file .env uvicorn personalos.main:app --reload
# Another terminal:
uv run --project apps/api --env-file .env python -m personalos.worker
# Another terminal:
npm ci --prefix apps/web
npm run dev --prefix apps/web
```

`.env` is server-only and ignored by Git and Docker build contexts. Never place API keys in `NEXT_PUBLIC_*` or browser storage. The Web proxies `/api` to FastAPI. Container builds set `API_URL=http://api:8000`; local development defaults to `http://127.0.0.1:8000`.

## Models and calendars

After registering, follow the two-step AI setup card on the Dashboard or open **Settings**. Fill the compatible Base URL and API key, retrieve available models, then select or enter a model ID. Test the current chat and separate Qwen embedding fields before saving; diagnostics never save the draft. A saved configuration is not proof of connectivity. Chat and briefings require chat configuration; missing embedding configuration does not block ordinary chat or manual tasks/calendar management. Optional Hy-Memory remains separately gated.

In Settings choose an OpenAI-compatible provider, enter the API key, base URL and model. The key is encrypted on the server and never returned by Settings/export. The DeepSeek preset uses `https://api.deepseek.com` and the currently documented `deepseek-flash`; model names remain editable. Model invocation, structured decision output and tool calling require real-provider acceptance for the selected endpoint. See [DeepSeek documentation](https://api-docs.deepseek.com/quick_start/agent_integrations/) and [tool calling](https://api-docs.deepseek.com/guides/tool_calls/).

Saved chat connections retrieve their real model list once when Settings opens. Use **Fetch models** after editing the endpoint or key; providers without a compatible models endpoint can still use an entered model ID. The official DeepSeek endpoint also supports **Check balance**, with separate currency totals, grants and top-ups. Model discovery, account balance and successful inference are independent checks. See [DeepSeek model discovery](https://api-docs.deepseek.com/api/list-models/) and [balance](https://api-docs.deepseek.com/api/get-user-balance/).

Leaving a key field blank preserves its saved value only while its endpoint is unchanged; use the explicit clear action to disable it. Re-enter the key when changing endpoints. A cleared personal key never falls back to an administrator key. Draft diagnostics reuse a saved key only for its exact saved endpoint. Server defaults and personal configuration are labeled separately; neither secret is exposed to the browser.

DeepSeek can serve the generative chat, task parsing, briefing and memory extraction paths. Embedding settings supports `qwen3.7-text-embedding` (2560/2048/1536/1024/768/512/256 dimensions) and `qwen3.7-text-embedding-flash` (1024/768/512/256), both with 1024 dimensions as the usual default. Select the requested model in Settings, enter the Beijing endpoint and separate Bailian API key, test the current configuration, then save to apply it. Existing Flash settings and the server fallback remain compatible. Switching to Flash resets unsupported high dimensions to 1024; invalid API combinations are rejected before saving. The key is encrypted separately from the chat key; a DeepSeek key is never reused. Model, endpoint and dimensions identify separate vector spaces, without automatic index migration. Configuring or probing this endpoint does not enable the deferred Hy-Memory data plane. Jev is a separate optional decision service. `DECISION_PROVIDER=llm` uses the configured ordinary LLM; `rules` is the explicit default, and `jev` requires its own credentials. Decisions never grant tool permissions.

Embedding also accepts the official Beijing public Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`. Workspace URLs remain recommended, but the provider explicitly retains the existing endpoint for compatibility. Use a Beijing API key with access to the selected model; accepting an endpoint is not a successful model call. URLs are never silently rewritten and changing endpoints still requires re-entering the key. See [official Embedding compatibility](https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai) and [regional endpoints](https://help.aliyun.com/zh/model-studio/regions/).

The built-in PersonalOS calendar works without a Google account, OAuth credentials or a model API key. Local events support viewing, editing, conflict checks and approved deletion. The dashboard previews the earliest four overlapping events in the next seven days; the Agent reads the next seven days, while briefings use a rolling 24-hour window. Queries filter occurrence times before reading results, so recently created unrelated events do not hide older plans.

Google Calendar is an optional connection. This user's current development and acceptance path uses the built-in calendar; Google authorization is not required. To enable Google later, create a Google OAuth Web application, enable Calendar API, configure the exact redirect URI and add authorized test users if applicable. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, restart API and connect through Integrations. External writes require approval. A disconnected provider shows an optional setup explanation; real connection or event-query failures remain errors. Google pagination and OAuth lifecycle review remain tracked follow-ups; no real Google acceptance is claimed.

## Memory and tools

Pending memories are separate from confirmed facts. Inspect/edit sources and confirm before recall. Edits require reconfirmation. Deletions request approval and preserve a visible cleanup state when a provider purge cannot be established. A deleted fact does not by itself erase its appearance in prior conversation text. Read [privacy boundaries](docs/architecture.md) and [official Hy-Memory/Jev SDK verification](docs/integrations.md).

Hy-Memory and Jev are optional, currently gated on user authorization and real data-plane acceptance. Install verified SDK extras only when configuring those providers; see the integration document for exact versions and limitations. The default canonical memory source is PostgreSQL; this must not be described as a successful Hy-Memory integration.

MCP uses an official client. Administrators must allowlist public HTTPS hosts with `MCP_ALLOWED_HOSTS`; users must explicitly trust the connection and grant individual tool names. Calls require a bound human approval. No arbitrary shell/SQL tool is exposed. Production deployments also need outbound network controls.

## Verification

```sh
uv run --project apps/api ruff check apps/api/personalos apps/api/tests
TEST_DATABASE_URL=postgresql+psycopg://personalos:YOUR_PASSWORD@127.0.0.1:54329/personalos \
  uv run --no-sync --project apps/api --env-file .env pytest apps/api/tests -q
npm run typecheck --prefix apps/web
npm run lint --prefix apps/web
npm run build --prefix apps/web
(cd apps/web && npx playwright install chromium && npm run test:e2e)
docker compose config --quiet
```

Use a disposable database for tests. PostgreSQL transaction tests create isolated schemas. Fixture-based SDK/model tests are explicitly contract tests; credentialed live-provider tests remain separate. Playwright uses real API/database records and must run against a local test instance.

## Source and learning materials

- [Full PRD](.sdd/personal-os/requirements.md), [design](.sdd/personal-os/design.md), [seven-day plan](.sdd/personal-os/plan.md), [task tracking](.sdd/personal-os/tasks.md)
- [Architecture diagram and failure model](docs/architecture.md)
- [API guide](docs/api.md), [course exercises](docs/course.md), [demonstration script](docs/demo.md)
- [Verification evidence and remaining gates](docs/verification.md)
- [Remaining development tasks, priorities and acceptance criteria](docs/roadmap.md)

`apps/web` is Next.js/TypeScript/Tailwind/shadcn/ui primitives/TanStack Query. `apps/api` is FastAPI/Pydantic/SQLAlchemy/Alembic/LangGraph. The Worker is a separate process and PostgreSQL is the task source of truth. CI runs safety checks, PostgreSQL transaction tests and browser acceptance.

Contributions use feature branches and reviewable PRs with commands, evidence and remaining acceptance boundaries. The maintainer granted standing authorization on 2026-10-28 to merge PersonalOS changes into `main` after applicable checks pass, without asking for confirmation each time; failed checks must still be resolved. Licensed under [MIT](LICENSE).
