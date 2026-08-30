# cw-clinic-api

Backend API for CW-CLINIC — a multi-tenant clinic management platform.

- Stack: NestJS + TypeScript + Prisma + SQL Server
- Status: Phase 0 — repository scaffolded, no business features yet
- Architecture docs: see `../docs/` in the CW-CLINIC workspace
  (ARCHITECTURE.md, DATABASE.md, API.md, RBAC.md, SECURITY.md,
  DEPLOYMENT.md, CI-CD.md, ROADMAP.md, DECISIONS.md)
- Development rules for this repo: [CLAUDE.md](CLAUDE.md)

## Related repositories

- `cw-clinic-admin` — React admin web app
- `cw-clinic-mobile` — React Native app (Doctor + Patient roles)
- `cw-clinic-ai` (future) — AI backend

Each repository is independent (own git history, own README, own
CLAUDE.md) and integrates with this API only over HTTP.
