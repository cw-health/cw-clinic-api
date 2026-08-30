# CLAUDE.md — cw-clinic-api

This file governs how Claude (or any contributor) works in this repository.
Read it before touching any code here. Cross-repo architecture docs live in
`../docs/` (ARCHITECTURE.md, DATABASE.md, API.md, RBAC.md, SECURITY.md,
DEPLOYMENT.md, CI-CD.md, ROADMAP.md, DECISIONS.md) — this file only holds
rules specific to this repository.

## What this repo is

NestJS backend API for CW-CLINIC. Multi-tenant clinic management SaaS. SQL
Server via Prisma. Serves cw-clinic-admin and cw-clinic-mobile; will be
called by cw-clinic-ai in the future (never the other way around).

## Stack

NestJS, TypeScript, Prisma, SQL Server, Jest.

## Non-negotiable rules

1. **Business logic never lives in controllers.** Controllers only handle
   HTTP concerns: DTO validation, guards, status codes, calling a service.
   All logic goes in services.
2. **No direct Prisma access from controllers.** Controller → Service →
   Repository/Prisma.
3. **`clinicId` is never read from the request body, query string, or a
   custom header.** It is derived only from the authenticated user's
   resolved tenant context (`TenantGuard`). Any code that accepts
   `clinicId` as client input is a bug — flag it, don't ship it.
4. **Every tenant-scoped Prisma query includes `clinicId`.** Use the
   shared repository/base-service helper that injects it automatically;
   don't hand-roll `where` clauses for tenant-scoped models.
5. **Guard order matters**: `AuthGuard` → `TenantGuard` →
   `PermissionsGuard` → (ownership check where applicable). Don't reorder
   or skip guards to make a route "work faster."
6. **Migrations**: use `prisma migrate dev` locally, commit the generated
   migration files. Never use `prisma db push` against any shared
   database. Production only ever runs `prisma migrate deploy`.
7. **Seeding**: dev/test/prod seed scripts are separate files
   (`seed.dev.ts`, `seed.test.ts`, `seed.prod.ts`). Never add fake
   patient/doctor/appointment data to the production seed path.
8. **Logging**: never log patient PII/PHI (names, DOB, contact info,
   diagnoses, prescriptions, vitals) or full request/response bodies on
   clinical endpoints. See `../docs/SECURITY.md` §8.
9. **No new dependency without justification** in the PR description —
   what it does, why an existing dependency (or a few lines of code)
   isn't enough.
10. **Don't build ahead of the roadmap.** Only implement the module/phase
    actually requested — see `../docs/ROADMAP.md`. Don't scaffold
    unrelated modules "while you're in there."
11. **Module boundaries**: a module imports another module's exported
    service, never reaches into another module's Prisma models directly.
    See `../docs/ARCHITECTURE.md` §3.

## Before modifying code

- Read this file.
- Inspect the existing module structure and conventions before adding to
  or changing a module — match existing patterns rather than introducing
  a new one for the same problem.
- Check `../docs/ARCHITECTURE.md` for which module a piece of logic
  belongs in before creating a new module.

## Required checks after meaningful changes

Run, in this order, and fix failures before considering work done:
1. `npm run lint`
2. `npm run typecheck` (`tsc --noEmit`)
3. `npm test`
4. `npm run build`

Update the relevant file(s) in `../docs/` if a change alters architecture,
schema strategy, API conventions, or security posture — docs and code stay
in sync in the same PR, not as a follow-up.

## Stop conditions

Stop after completing the requested phase/task. Do not proceed to
implement the next roadmap phase, add unrequested features, or refactor
unrelated code without being asked.
