# System language and eight-character registration

The interface follows supported browser/system language preferences by default: Chinese variants resolve to `zh-CN`, English variants to `en`, and unsupported languages fall back to English. A user can choose either language or return to `system` on the sign-in page and in Settings. Only this preference is persisted; the resolved system language is never frozen into a manual override.

Reuse React context, existing form components, user settings screens and `Intl` formatters. Dictionaries explicitly translate product text, statuses, accessibility labels, prompts and known errors. User names, tasks, memory text, conversations, model IDs and tool/API data remain original. No DOM text rewriting or translation-model call is used. No database table or migration is required.

The root layout resolves `Accept-Language` and the preference cookie for server rendering. `useSyncExternalStore` hydrates from that snapshot, then observes browser language changes and manual preferences without a language mismatch. Login/settings expose the same selector; date helpers receive the resolved locale. Resource modules separate workspace, pages and model-configuration text to support parallel ownership.

Registration and login share the existing `Credentials` schema with minimum length eight and maximum 256. The Web registration constraint and helper text match eight. Existing passwords remain untouched. Validation errors keep location/type/message while excluding sensitive input/context.

Implementation order: establish the locale provider and SSR contract; translate shared/auth screens, the nine pages and configuration components in separate file scopes; unify date formatting; update the password schema and contract docs; run existing checks and manual acceptance; capture localized screenshots and open a feature PR. Per user instruction, do not add or modify test cases. Manual acceptance covers Chinese/English/system resolution, override persistence, no content translation, responsive layout and seven/eight-character password boundaries.
