# Multi-Stage Docker Build Pattern

## 1. Component Pattern

**Type:** Multi-Stage Dockerfile  
**Layer:** Infrastructure / Container Build  
**Reference Implementation:** `modules/domain/revenue/order-management/Dockerfile`

## 2. Overview

Every backend module in the monorepo is containerized using a two-stage Docker build: a **builder** stage that installs all dependencies, generates Prisma client, compiles TypeScript, and prunes to production-only packages; and a **production** stage that copies only the artifacts needed at runtime into a minimal Alpine image.

The key design goal is **layer caching**. Package manifests (`package.json`, `pnpm-lock.yaml`) are copied before source code so that `pnpm install --frozen-lockfile` is cached unless dependencies actually change. Source code is copied in a second layer, and builds proceed in dependency order: `generate:prisma` → contracts → common → module. The final `pnpm deploy --prod --legacy` command creates a flat `/deploy` directory containing only production `node_modules` — no devDependencies, no workspace symlinks.

The production stage starts from a clean `node:20-alpine`, installs only the global `prisma` CLI (needed for `db push` at startup via the entrypoint script), copies the deployed artifacts, sets a health check, drops to the `node` user (non-root), and delegates startup to `docker-entrypoint.sh`.

Build context is always the **monorepo root** (`../../` from a product directory) because the Dockerfile needs access to `packages/contracts`, `packages/common`, and the module itself.

## 3. Rules

1. **Always two stages.** The builder stage is named `builder`; the production stage is named `production`. No intermediate stages.
2. **Pin exact versions.** Node (`node:20-alpine`), pnpm (`pnpm@10.29.3`), and prisma (`prisma@7.4.0`) are pinned to prevent drift across environments.
3. **Copy manifests before source.** Copy `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and `tsconfig.json` first. Then copy each workspace package's `package.json`. Run `pnpm install --frozen-lockfile` before any source code enters the image. This maximizes Docker layer cache hits.
4. **Build in dependency order.** Always: `generate:prisma` → `@myorg/contracts` → `@myorg/common` → `@myorg/module-name`. Contracts and common are shared libraries that the module depends on.
5. **Deploy with `--prod --legacy`.** `pnpm --filter @myorg/module-name deploy /deploy --prod --legacy` produces a standalone directory with only production dependencies. The `--legacy` flag ensures compatibility with node_modules resolution.
6. **Production image has no build tools.** No pnpm, no TypeScript, no devDependencies. Only `node`, `prisma` (global), and the deployed artifacts.
7. **Copy exactly 6 artifacts from builder.** `node_modules`, `package.json`, `dist`, `prisma`, `generated`, `docker-entrypoint.sh`. Nothing else.
8. **EXPOSE the module's assigned port.** The port must match the value in the service registry.
9. **HEALTHCHECK on `/health`.** Uses `wget` (available in Alpine) to probe the NestJS Terminus health endpoint.
10. **Run as non-root.** `USER node` is the last directive before `CMD`. The `node` user is built into the `node:alpine` base image.
11. **Entrypoint is the shell script.** `CMD ["./docker-entrypoint.sh"]` — not `node dist/src/main.js` directly — because the entrypoint runs `prisma db push` first.
12. **Build context is monorepo root.** The `docker-compose.yml` sets `build.context: ../../` so COPY paths are relative to the repo root.

## 4. Structure

```
modules/<layer>/<domain?>/<module-name>/
├── Dockerfile                  # Multi-stage build (this pattern)
├── docker-entrypoint.sh        # Startup script (see docker-entrypoint pattern)
├── package.json                # Must have @myorg/module-name as "name"
├── prisma/
│   └── schema.prisma           # Prisma schema (copied into production image)
├── generated/                  # Prisma client output (copied into production image)
├── src/
│   └── main.ts                 # NestJS bootstrap (→ dist/src/main.js after build)
└── dist/                       # TypeScript compilation output
```

**Stage breakdown:**

| Stage | Base Image | Purpose | Output |
|---|---|---|---|
| `builder` | `node:20-alpine` | Install deps, generate Prisma, compile TS, prune | `/deploy` directory |
| `production` | `node:20-alpine` | Runtime-only image with health check | Final container image |

**Layer caching strategy:**

| Layer | Contents | Cache Invalidation |
|---|---|---|
| 1 | Package manifests + install | Only when `pnpm-lock.yaml` or any `package.json` changes |
| 2 | Source code + build | When any `.ts`, `.prisma`, or config file changes |
| 3 | Deploy (prune) | When build output or dependencies change |

## 5. Example Implementation

```dockerfile
# ══════════════════════════════════════════════════════════════
# Multi-Stage Dockerfile — @myorg/resource-module
# ══════════════════════════════════════════════════════════════
# Build context: monorepo root (set via docker-compose build.context)

# ── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate
WORKDIR /app

# ── Layer 1: Install dependencies (cached if lockfile unchanged) ──
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.json ./

# Copy only the package.json of each workspace member we need.
# This lets Docker cache the install step even when source code changes.
COPY packages/contracts/package.json packages/contracts/
COPY packages/common/package.json packages/common/
COPY modules/domain/revenue/resource-module/package.json modules/domain/revenue/resource-module/

# Frozen lockfile = reproducible installs. Fails if lockfile is out of date.
RUN pnpm install --frozen-lockfile

# ── Layer 2: Copy source & build ─────────────────────────────
COPY packages/contracts/ packages/contracts/
COPY packages/common/ packages/common/
COPY modules/domain/revenue/resource-module/ modules/domain/revenue/resource-module/

# 1. Generate Prisma client (must happen before TS compilation)
RUN cd modules/domain/revenue/resource-module && pnpm generate:prisma

# 2. Build shared packages first (module depends on these)
RUN pnpm --filter @myorg/contracts build
RUN pnpm --filter @myorg/common build

# 3. Build the module itself
RUN pnpm --filter @myorg/resource-module build

# ── Deploy: prune to production-only dependencies ─────────────
# Creates /deploy with flat node_modules (no workspace symlinks).
# --prod removes devDependencies, --legacy uses node_modules resolution.
RUN pnpm --filter @myorg/resource-module deploy /deploy --prod --legacy

# ── Stage 2: Production image ────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Install prisma CLI globally — needed by docker-entrypoint.sh
# for `prisma db push` at container startup.
RUN npm install -g prisma@7.4.0

# Copy deployed production node_modules (no devDependencies)
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/package.json ./

# Copy compiled output
COPY --from=builder /app/modules/domain/revenue/resource-module/dist ./dist

# Copy Prisma schema (for db push) and generated client (for runtime)
COPY --from=builder /app/modules/domain/revenue/resource-module/prisma ./prisma
COPY --from=builder /app/modules/domain/revenue/resource-module/generated ./generated

# Copy entrypoint script and make executable
COPY --from=builder /app/modules/domain/revenue/resource-module/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Expose the port assigned in the service registry
EXPOSE 4104

# Health check — probes the NestJS Terminus /health endpoint.
# Used by Docker Compose depends_on with condition: service_healthy.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4104/health || exit 1

# Run as non-root user (built into node:alpine)
USER node

# Delegate to entrypoint script (prisma db push → node start)
CMD ["./docker-entrypoint.sh"]
```

**Adapting for a new module:**

Replace these placeholders throughout the Dockerfile:

| Placeholder | Example Value | Description |
|---|---|---|
| `modules/domain/revenue/resource-module` | `modules/shared/invoice-service` | Full path to module in monorepo |
| `@myorg/resource-module` | `@myorg/invoice-service` | Package name from module's `package.json` |
| `4104` | `4102` | Port from service registry |

**If the module has additional workspace dependencies** (e.g., it imports from another module), add their `package.json` in Layer 1 and their source in Layer 2:

```dockerfile
# Layer 1 — additional dependency
COPY modules/shared/some-dependency/package.json modules/shared/some-dependency/

# Layer 2 — additional dependency source
COPY modules/shared/some-dependency/ modules/shared/some-dependency/
RUN pnpm --filter @myorg/some-dependency build
```

**Key observations:**

- The `pnpm deploy` command outputs to `/deploy` — a flat directory with no symlinks. This is critical because the production image doesn't have pnpm installed and can't resolve workspace protocol (`workspace:*`) links.
- `prisma@7.4.0` is installed globally in the production stage (not copied from builder) because the builder's prisma is a devDependency that gets stripped by `--prod`.
- The `HEALTHCHECK` uses `wget` because `curl` is not installed in `node:20-alpine` by default.
- `start-period=10s` gives NestJS time to bootstrap before Docker starts counting failed health checks.
