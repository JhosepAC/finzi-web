# Historical pre-webhook tests

telegram-polling-pre-webhook.test.ts preserves the old direct-function ACL contract.
Migration35 intentionally revokes that contract from finzi_telegram_gateway.
Do not restore those grants or run this suite against the current schema.

Active coverage is in tests/integration/telegram-foundation.test.ts (real restricted
event/lease dispatcher), tests/e2e/telegram-link.spec.ts (the production webhook and
processor with synthetic delivery), the unit suites, and scripts/telegram-workerd-local.mjs.
This archived suite is outside the current Vitest include patterns; it is not
reported as passing or silently skipped coverage of the current transport.
