# Model configuration and Agent reliability

The user authorized autonomous optimization and verification; live provider acceptance still requires credentials entered through the private Settings form. Preserve the full existing PRD and optional integration gates. This change fixes deterministic reliability/security defects before those live checks, without adding tables or test case files.

Reuse the existing settings version/CAS contract. Keep a form's version tied to its editing snapshot; background refresh must not silently authorize an old draft against a newer version. Show an explicit reload decision and block stale saves, key removal and saved-connection probes. After a successful mutation, advance the baseline using the actual returned settings.

Publish the persisted chat session before inference, including an SSE session frame and response header. The browser pins that identity as soon as it arrives, treats missing terminal events as failure, refreshes history after failure/cancellation, and closes abandoned readers. A failed provider must not silently become a fresh conversation.

Use server-owned HTTP clients with redirect following disabled for chat, automation and briefings. User endpoint overrides receive the existing public HTTPS validation at invocation time; administrators retain intentional local model support. Close only owned clients. Malformed URLs return 422, DNS lookup is bounded, and connection probes use a 20-second total deadline. DNS rebinding still requires address binding or network egress controls; runtime DNS checks alone do not establish that guarantee.

Broadcast same-origin sign-in/sign-out changes without account identifiers or secrets. Other tabs temporarily hide old content, cancel queries, clear cached data and reload the current identity. Browser focus also checks session validity. This does not merge the independent local databases or introduce cross-port authentication sharing.

Validate through the existing suites and manual acceptance. A separate loopback QA instance and a failure-only HTTP fixture can exercise persistence and redirect refusal without using private content, calling an external provider, or fabricating an AI answer. Keep its accounts separate from the user's browser session and stop temporary servers afterwards. Real chat/tool/embedding quality, Google OAuth, Hy data-plane purge and Jev availability remain separate credentialed checks.
