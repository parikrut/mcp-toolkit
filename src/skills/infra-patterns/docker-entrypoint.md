# Docker Entrypoint Script Pattern

## 1. Component Pattern

**Type:** Container Entrypoint Shell Script  
**Layer:** Infrastructure / Runtime Bootstrap  
**Reference Implementation:** `modules/domain/revenue/order-management/docker-entrypoint.sh`

## 2. Overview

Every backend module includes a `docker-entrypoint.sh` script that runs when the container starts. The script has exactly two responsibilities:

1. **Schema synchronization** — Run `prisma db push` to ensure the database schema matches the Prisma schema bundled in the container image. This eliminates the need for a separate migration step in development and allows containers to self-initialize their database on first startup.

2. **Application startup** — `exec node dist/src/main.js` to start the NestJS application. The `exec` keyword replaces the shell process with the Node.js process, ensuring that OS signals (SIGTERM, SIGINT) are delivered directly to the application for graceful shutdown.

The script is designed for **resilience**: if `prisma db push` fails (e.g., database not yet ready, schema conflict), it logs a warning and continues to start the application anyway. This prevents a hard crash on transient infrastructure issues while still attempting schema sync on every container start.

The `DATABASE_URL` is passed as an environment variable at runtime (from Docker Compose or Kubernetes), not baked into the image. The `--url "$DATABASE_URL"` flag overrides any URL in the Prisma schema file.

## 3. Rules

1. **Use `#!/bin/sh`, not `#!/bin/bash`.** Alpine images don't have bash by default. POSIX sh is always available.
2. **`set -e` at the top.** Exit on error — but note that the `|| echo "Warning..."` pattern on `prisma db push` prevents set -e from triggering on schema push failure.
3. **Always run `prisma db push` first.** This ensures the schema is current before the app starts. Use `--schema ./prisma/schema.prisma` to be explicit about the schema path.
4. **Pass `--url "$DATABASE_URL"` at runtime.** Never hardcode the database URL. The environment variable is injected by Docker Compose or the orchestrator.
5. **Continue on push failure.** Append `2>&1 || echo "Warning: prisma db push failed, continuing..."` to prevent container crash on schema push errors.
6. **Use `exec` for the node process.** `exec node dist/src/main.js` replaces the shell with Node. Without `exec`, the shell remains PID 1 and swallows signals — the container won't respond to graceful shutdown requests.
7. **No background processes.** The script must run exactly one foreground process (`exec node`). No `&`, no subshells, no daemon processes.
8. **The script must be executable.** The Dockerfile includes `RUN chmod +x docker-entrypoint.sh`. The file should also have executable permissions in the git repository.
9. **Entry point is `dist/src/main.js`.** This is the compiled NestJS bootstrap file. The path is always the same across all modules.
10. **Log each step.** Echo what's happening (`Running prisma db push...`, `Starting application...`) so container logs show the startup sequence.

## 4. Structure

```
modules/<layer>/<domain?>/<module-name>/
├── docker-entrypoint.sh        # This script (MUST be at module root)
├── Dockerfile                  # Copies this script into production image
├── prisma/
│   └── schema.prisma           # Schema that db push applies
└── dist/
    └── src/
        └── main.js             # Compiled NestJS bootstrap
```

**Execution flow:**

```
Container Start
  │
  ├─ 1. prisma db push --schema ./prisma/schema.prisma --url "$DATABASE_URL"
  │     ├─ Success → schema synced, continue
  │     └─ Failure → warning logged, continue anyway
  │
  └─ 2. exec node dist/src/main.js
        └─ Node process becomes PID 1
        └─ Listens on $PORT
        └─ /health endpoint returns 200
```

**Environment variables used at runtime:**

| Variable       | Source               | Purpose                                                     |
| -------------- | -------------------- | ----------------------------------------------------------- |
| `DATABASE_URL` | Docker Compose / K8s | PostgreSQL connection string for prisma db push and the app |
| `PORT`         | Docker Compose / K8s | TCP port the NestJS app listens on                          |
| `NODE_ENV`     | Dockerfile `ENV`     | Set to `production` in the image                            |
| `RABBITMQ_URL` | Docker Compose / K8s | Message broker connection (used by app, not entrypoint)     |
| `JWT_SECRET`   | Docker Compose / K8s | Auth token signing (used by app, not entrypoint)            |

## 5. Example Implementation

```bash
#!/bin/sh
set -e

echo "Running prisma db push..."
prisma db push --schema ./prisma/schema.prisma --url "$DATABASE_URL" 2>&1 || echo "Warning: prisma db push failed, continuing..."

echo "Starting application..."
exec node dist/src/main.js
```

**Why `prisma db push` instead of `prisma migrate deploy`:**

- `db push` is a **declarative** schema sync — it reads the Prisma schema and makes the database match. No migration history table required.
- `migrate deploy` requires a `migrations/` directory with sequential SQL files. This is better for production environments with strict migration control but adds operational complexity.
- For development and early-stage deployments, `db push` is simpler and self-healing (any schema drift is resolved on restart).

**Why `exec` matters — signal handling:**

```
Without exec:                    With exec:
┌─────────────┐                  ┌─────────────┐
│  sh (PID 1) │  ← SIGTERM      │ node (PID 1) │  ← SIGTERM
│  └── node   │  (signal lost)   │              │  (graceful shutdown)
└─────────────┘                  └─────────────┘
```

Without `exec`, `sh` is PID 1 and receives the SIGTERM from Docker. Since `sh` doesn't forward signals to child processes by default, the Node.js process never receives the shutdown signal. Docker waits for the grace period (default 10s), then sends SIGKILL — resulting in a hard kill with no cleanup.

With `exec`, the Node.js process _is_ PID 1. It receives SIGTERM directly and can run its `onModuleDestroy()` hooks (close DB connections, drain queues, finish in-flight requests).

**Adapting for a new module:**

The entrypoint script is **identical** across all modules. No changes are needed — just copy the file:

```bash
cp modules/domain/revenue/order-management/docker-entrypoint.sh \
   modules/domain/new-domain/new-module/docker-entrypoint.sh
```

The script is module-agnostic because:

- `prisma db push` reads `./prisma/schema.prisma` (every module has one at the same relative path)
- `node dist/src/main.js` (every module compiles its NestJS app to the same output path)
- `$DATABASE_URL` is injected at runtime per-container

**Error scenarios and behavior:**

| Scenario                              | Behavior                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Database not reachable                | `prisma db push` fails, warning logged, app starts (will retry DB connection via NestJS)                   |
| Schema conflict (manual column added) | `prisma db push` fails, warning logged, app may fail at runtime if queries hit missing columns             |
| Database doesn't exist                | `prisma db push` fails, warning logged. The `init-databases.sql` in docker-compose should have created it. |
| Everything healthy                    | Schema synced silently, app starts, `/health` returns 200                                                  |
