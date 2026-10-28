# PersonalOS collaboration rules

- Follow .sdd/personal-os as the full requirement baseline; never remove a feature to claim completion.
- Work in feature branches; never merge main without human authorization. Never commit secrets.
- Reuse existing tables and services before introducing new ones. All business tables require deleted_at, created_at, updated_at, version and extra. Index owner/status/time access paths. Do not write SQL JOINs; assemble in services.
- The latest user instructions prohibit writing test cases. Run existing checks and manual acceptance when useful; do not add tests or compile after every edit.
- Delegate parallel work with exclusive file ownership; primary agent integrates and resolves contracts.
- External integrations require official SDK verification and real authorization tests. Record blocked checks honestly. No fabricated data or success states.
- Replies to the user begin with 主人, include an emoji, and end with 喵～.
