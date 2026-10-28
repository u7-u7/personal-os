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

## Models and Google Calendar

After registering, follow the two-step AI setup card on the Dashboard or open **Settings**. Fill the chat model ID, compatible Base URL and API key, then configure the separate Qwen embedding endpoint and key. Save first; use each model's connection check to verify the saved version. A saved configuration is not proof of connectivity. Chat and briefings require chat configuration; missing embedding configuration does not block ordinary chat or manual tasks/calendar management. Optional Hy-Memory remains separately gated.

In Settings choose an OpenAI-compatible provider, enter the API key, base URL and model. The key is encrypted on the server and never returned by Settings/export. The DeepSeek preset uses `https://api.deepseek.com` and the currently documented `deepseek-flash`; model names remain editable. Model invocation, structured decision output and tool calling require real-provider acceptance for the selected endpoint. See [DeepSeek documentation](https://api-docs.deepseek.com/quick_start/agent_integrations/) and [tool calling](https://api-docs.deepseek.com/guides/tool_calls/).

Leaving a key field blank preserves its saved value; use the explicit clear action to disable it. A cleared personal key never falls back to an administrator key. Changing a Base URL requires a personal key unless that URL exactly matches the administrator's configured endpoint. Server defaults and personal configuration are labeled separately; neither secret is exposed to the browser.

DeepSeek can serve the generative chat, task parsing, briefing and memory extraction paths. The selected embedding model is Qwen3.7 Embedding Flash (`qwen3.7-text-embedding-flash`, Beijing, 1024 dimensions by default). In the separate Embedding settings, paste your real Beijing workspace OpenAI-compatible Base URL and its Bailian API key, save, then test the saved connection. The key is encrypted separately from the chat key; a DeepSeek key is never reused. Supported dimensions are 1024/768/512/256. Configuring or probing this endpoint does not enable the deferred Hy-Memory data plane. Jev is a separate optional decision service. `DECISION_PROVIDER=llm` uses the configured ordinary LLM; `rules` is the explicit default, and `jev` requires its own credentials. Decisions never grant tool permissions.

Google Calendar uses OAuth, not account passwords. Create a Google OAuth Web application, enable Calendar API, configure the exact redirect URI and add authorized test users if applicable. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, restart API and connect through Integrations. External writes require approval. Without those credentials the UI reports unavailable instead of pretending to be connected.

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

`apps/web` is Next.js/TypeScript/Tailwind/shadcn/ui primitives/TanStack Query. `apps/api` is FastAPI/Pydantic/SQLAlchemy/Alembic/LangGraph. The Worker is a separate process and PostgreSQL is the task source of truth. CI runs safety checks, PostgreSQL transaction tests and browser acceptance.

Contributions use feature branches and reviewable PRs with commands, evidence and remaining acceptance boundaries. Do not merge `main` without maintainer authorization. Licensed under [MIT](LICENSE).
