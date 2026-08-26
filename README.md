# Transatlantic Shipping SaaS

Multi-tenant SaaS platform for international freight forwarding companies
(e.g. US ⇄ West Africa shipping operators). Each tenant is a freight
forwarding company; each tenant's customers, shipments, containers,
invoices, etc. are fully isolated from every other tenant's data.

> **Status: Foundation milestone.** Auth, RBAC, multi-tenant data model, and
> the app shells for all three frontends exist. Domain features (shipment
> management, invoicing, container consolidation, etc.) are not yet built.

## Architecture

pnpm monorepo with three workspaces:

| Path               | What it is                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `apps/api`         | NestJS backend — REST API, Prisma ORM, JWT auth, RBAC             |
| `apps/web`         | Next.js 15 frontend — public site, staff dashboard, customer portal, platform admin |
| `packages/shared`  | Shared TypeScript types, enums, and constants used by both apps   |

**Backend:** NestJS 10 + Prisma 5 + PostgreSQL. Every request passes through
a global `JwtAuthGuard` (opt out per-route with `@Public()`) and a global
`RolesGuard` (restrict per-route with `@Roles(...)`). Tenant isolation is
defense-in-depth: every tenant-owned table carries an indexed `tenantId`
column (even where reachable via a parent relation), application code
always scopes queries by `tenantId` from the caller's JWT, and
`assertTenantAccess()` double-checks ownership before returning any record
— a cross-tenant lookup 404s rather than 403s, so it never confirms that a
resource belonging to another tenant even exists. `PLATFORM_ADMIN` users
have `tenantId = null` and are the only role that can operate across
tenants (tenant management only, never tenant data).

**Frontend:** Next.js App Router with three route groups —
`dashboard` (tenant staff), `portal` (customers), `platform` (platform
admins) — plus a `(public)` group for the marketing site, login, register,
and public tracking. Client-side route guarding (`useRequireAuth`) is a UX
convenience only; the API is the real security boundary.

**Data model:** see `apps/api/prisma/schema.prisma`. Covers tenants,
users/customers, addresses, warehouses/routes, shipments (with items and
vehicle-specific details), containers/manifests, tracking events, quotes,
invoices/payments, documents, and notifications.

## Prerequisites

- Node.js >= 20
- pnpm 9 (`packageManager` is pinned to `pnpm@9.15.0`)
- PostgreSQL 14+ running locally (or reachable) — this project was set up
  against PostgreSQL 17
- A PostgreSQL database and role for this project (see **Database setup**)

## Installation

```bash
pnpm install
```

This also builds `packages/shared` via the root `postinstall` script,
since both `apps/api` and `apps/web` depend on it as `@transatlantic/shared`.

## Environment setup

Each app has a `.env.example` documenting exactly what it needs. Copy them
to real, untracked env files and fill in real values:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

**`apps/api/.env`:**

| Variable             | Purpose                                                          |
| --------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`        | Postgres connection string used by Prisma (see below)            |
| `PORT`                | Port the NestJS API listens on (default `4000`)                  |
| `CORS_ORIGIN`         | Comma-separated origins allowed to call the API (`http://localhost:3000` for local web) |
| `JWT_SECRET`          | JWT signing secret. Generate a strong one for anything beyond a single local machine: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN`      | Access token lifetime (default `1d`)                              |
| `BCRYPT_SALT_ROUNDS`  | bcrypt cost factor for password hashing (default `10`)            |

**`apps/web/.env.local`:**

| Variable               | Purpose                              |
| ----------------------- | ------------------------------------- |
| `NEXT_PUBLIC_API_URL`   | Base URL of the NestJS API for the browser to call |

> **`DATABASE_URL` passwords containing `@`, `:`, `/`, or `?` must be
> percent-encoded** (e.g. `@` → `%40`) since those characters are
> connection-string delimiters.

## Database setup

1. Make sure PostgreSQL is installed and running.
2. Create a database and a role for the app (adjust names/password as you
   like; do not reuse these example values):
   ```sql
   CREATE ROLE transatlantic_app WITH LOGIN PASSWORD 'choose-a-password';
   CREATE DATABASE transatlantic_shipping OWNER transatlantic_app;
   ```
3. Set `DATABASE_URL` in `apps/api/.env` to point at it, e.g.:
   ```
   DATABASE_URL="postgresql://transatlantic_app:choose-a-password@localhost:5432/transatlantic_shipping?schema=public"
   ```
4. Apply the schema and seed development data:
   ```bash
   pnpm prisma:generate
   pnpm prisma:migrate     # applies migrations (interactive: prompts for a name on schema changes)
   pnpm prisma:seed
   ```

   > **Note on the shadow database:** `prisma migrate dev` normally creates
   > a temporary "shadow" database to safely compute schema diffs, which
   > requires the app role to have `CREATEDB`. If your role doesn't have
   > that privilege (a reasonable restriction for an app role in a shared
   > Postgres instance), either grant it temporarily
   > (`ALTER ROLE transatlantic_app CREATEDB;`), or generate/apply
   > migrations manually:
   > ```bash
   > pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql
   > pnpm exec prisma db execute --schema prisma/schema.prisma --file prisma/migrations/<timestamp>_<name>/migration.sql
   > pnpm exec prisma migrate resolve --applied <timestamp>_<name>
   > ```

`pnpm prisma:studio` opens Prisma Studio (a GUI for browsing/editing the
database) if you want to inspect data directly.

## Development commands

Run from the repo root unless noted:

| Command                | What it does                                          |
| ------------------------ | ------------------------------------------------------ |
| `pnpm dev`              | Runs `apps/api` and `apps/web` in parallel, watch mode |
| `pnpm dev:api`          | Runs just the API (`nest start --watch`)               |
| `pnpm dev:web`          | Runs just the web app (`next dev`)                     |
| `pnpm build`            | Builds `packages/shared`, then `apps/api` and `apps/web` |
| `pnpm lint`             | Lints all apps/packages                                |
| `pnpm typecheck`        | Type-checks all apps/packages (`tsc --noEmit`)         |
| `pnpm format`           | Formats the repo with Prettier                         |
| `pnpm prisma:generate`  | Regenerates the Prisma client                          |
| `pnpm prisma:migrate`   | Creates/applies a Prisma migration                     |
| `pnpm prisma:seed`      | Runs `apps/api/prisma/seed.ts`                         |
| `pnpm prisma:studio`    | Opens Prisma Studio                                    |

## Local URLs

| App                       | URL                              |
| --------------------------- | ----------------------------------- |
| Web (public/dashboard/portal/platform) | http://localhost:3000            |
| API                       | http://localhost:4000            |
| API health check          | http://localhost:4000/health     |
| Prisma Studio (when running) | http://localhost:5555         |

## Development-only seed login credentials

Created by `pnpm prisma:seed`. **Development only — never use these
password conventions in a real environment.**

| Role            | Email                             | Password       | Notes                                   |
| ---------------- | ------------------------------------ | ---------------- | ------------------------------------------ |
| Platform admin  | `platformadmin@ananse.dev`        | `Password123!` | `tenantId = null`, manages all tenants  |
| Tenant admin    | `admin@transatlantic.dev`         | `Password123!` | Tenant: Trans Atlantic Logistics Solutions |
| Warehouse staff | `warehouse@transatlantic.dev`     | `Password123!` | Same tenant                              |
| Customer        | `customer@transatlantic.dev`      | `Password123!` | Has a linked `Customer` record + a sample shipment (`TAL-2026-000001`) |

## Project structure

```
apps/
  api/                    NestJS backend
    prisma/
      schema.prisma       Data model (tenants, users, shipments, invoices, ...)
      seed.ts             Development seed data
      migrations/         Applied Prisma migrations
    src/
      auth/               Login, JWT strategy, auth DTOs
      common/
        decorators/       @Public(), @Roles(), @CurrentUser()
        guards/            JwtAuthGuard, RolesGuard (both global)
        tenant/            assertTenantAccess() / requireTenantId() helpers
      health/              GET /health
      prisma/              PrismaService/PrismaModule
      tenants/             Tenant CRUD (platform-admin) + "my tenant" lookup
      users/               User queries scoped by tenant
  web/                    Next.js frontend
    src/
      app/
        (public)/          Landing, login, register, public tracking
        dashboard/         Tenant staff app shell + module pages
        portal/            Customer-facing app shell + module pages
        platform/          Platform-admin app shell + module pages
      components/          Shared UI (Button, Card, Badge, AppShell, ...)
      lib/                 API client, auth/session helpers, route guards
packages/
  shared/                 Types, enums, constants shared by api + web
```

## What's not built yet

This is the foundation milestone only. Not yet implemented: shipment
CRUD/workflow, container consolidation, manifests, quoting, invoicing,
payments, document uploads, notifications, and any external integrations
(payments, SMS/WhatsApp, email). No code has been committed to git yet.
