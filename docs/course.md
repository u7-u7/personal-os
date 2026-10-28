# PersonalOS Agent engineering course

Use the source and its actual runtime; never substitute fixture output for service acceptance. Read [requirements](../.sdd/personal-os/requirements.md) before each module.

## 1. Bootstrap and boundaries

Start PostgreSQL, Redis, API, Worker and Web. Register two accounts. Observe how an HttpOnly session becomes `owner_id` in every service. Explain why the browser cannot choose another user's scope. Inspect Alembic migrations and the resource indexes.

Exercise: create a task for account A, then attempt to patch its ID using account B. Expected: 404; no mutation. Explain why checking ownership only in the UI is insufficient.

## 2. Streaming and durable graphs

Configure an actual model in Settings. Use the DeepSeek preset or a compatible provider. Open Chat and request creation of a real task. Inspect SSE status/token/tool events, Activity and the database record. Refresh the page, reopen history and send a follow-up. Explain the difference between visible transcripts and graph checkpoints.

Exercise: remove the configured key and request a response. Expected: explicit unavailable error; no invented assistant reply. A passing mock-provider test proves protocol handling, not external connectivity.

## 3. Consent-based memory

Ask the assistant to propose a preference. Inspect its pending state and chat source. Confirm in Memory Center, then request recall from another session. Edit a fact, resolve explicit fact-key conflicts, and approve deletion. Inspect canonical state and deletion receipt.

Exercise: contrast recall suppression with erasing conversation history and external provider indexes. Discuss the deletion boundaries documented in [architecture](architecture.md) and [Hy-Memory evidence](integrations.md).

## 4. Calendar and daily briefing

Create local calendar events and provoke an overlapping interval. Configure a Google OAuth application, complete consent, query real events and request an external write. Inspect the frozen approval before accepting it. Generate a briefing and inspect which task/calendar IDs were used.

Exercise: replay the same approval version. Expected: rejected replay, no second external write. Do not use a real calendar without explicit user authorization.

## 5. Durable autonomous work

Create a one-time or recurring automation. Start two Worker processes and observe a single occurrence. Pause/resume/cancel schedules and inspect execution history. Kill a process after claiming a job, expire its lease and observe `outcome_unknown` on recovery.

Exercise: explain why a unique run key prevents duplicate scheduling but cannot provide exactly-once effects on an arbitrary remote API. Use the PostgreSQL concurrency tests to examine the fencing token.

## 6. MCP and decisions

Register a controlled public HTTPS MCP server. Inspect its tools before granting permissions. Request a call and inspect its approval and result. Contrast rule classification, LLM classification and the official Jev SDK. Review decision logs; none should contain API keys or grant authorization.

Exercise: try an untrusted tool, a non-allowlisted host and a loopback destination. Expected: denied. Discuss DNS rebinding/redirect risk and why production requires outbound network controls as well as application checks.

## 7. Verification and open-source delivery

Run Pytest, real PostgreSQL locking checks, TypeScript/lint/build and Playwright. Read what was skipped. Export user data and verify no API/OAuth credential appears. Build Compose and examine health checks. Attach screenshots and exact commands to a feature PR, without merging main.

Final exercise: complete the acceptance matrix using actual service responses. A fixture's deterministic output is useful for regression, but it never authorizes a claim that Google, Hy-Memory, Jev or a live model succeeded.
