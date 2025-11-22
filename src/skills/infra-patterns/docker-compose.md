# Docker Compose Development Stack Pattern

## 1. Component Pattern

**Type:** Docker Compose Development Environment  
**Layer:** Infrastructure / Orchestration  
**Reference Implementation:** `products/property-tax/docker-compose.yml`

## 2. Overview

Each product in the platform has a `docker-compose.yml` that defines the complete development stack: infrastructure services (PostgreSQL, RabbitMQ, Redis), all backend microservices organized by architectural layer, the frontend SPA served by nginx, and developer tools (Prisma Studio).

The compose file is the **runtime counterpart** to the service registry. While `infra/service-registry.ts` is the typed source of truth for ports, hostnames, and routes, `docker-compose.yml` translates that into running containers with proper networking, environment variables, health checks, and dependency ordering.

Three Docker networks isolate traffic: `frontend` (nginx ↔ browser), `backend` (nginx ↔ services, services ↔ services), and `data` (services ↔ databases/queues/cache). Every backend service connects to both `backend` and `data`. Infrastructure services connect only to `data`. The frontend connects to `frontend` and `backend`.

All services declare health checks and use `depends_on` with `condition: service_healthy` to enforce startup ordering. This ensures a service doesn't start until its dependencies (database, message broker, upstream services) are ready to accept connections.

Resource limits (memory and CPU) are set on every service to prevent a single runaway process from consuming all host resources during development.

## 3. Rules

1. **Infrastructure services come first.** PostgreSQL, RabbitMQ, and Redis are defined before any application service. They have no `depends_on`.
2. **Three networks.** `frontend`, `backend`, `data`. Every backend service joins `backend` + `data`. Infrastructure joins only `data`. Frontend joins `frontend` + `backend`.
3. **Named volumes for persistence.** `postgres_data`, `rabbitmq_data`, `redis_data`. Never use bind mounts for database data.
4. **Host ports are offset from internal ports.** PostgreSQL: `5433:5432`, RabbitMQ: `5673:5672` / `15673:15672`, Redis: `6380:6379`. This avoids conflicts with locally installed services.
5. **Build context is monorepo root.** `build.context: ../../` (from product directory). `build.dockerfile` points to the module's Dockerfile.
6. **Every service has a health check.** Infrastructure: native health commands (`pg_isready`, `rabbitmq-diagnostics`, `redis-cli ping`). Backend: `wget --spider http://127.0.0.1:<PORT>/health`. Frontend: `wget --spider http://localhost:8080/`.
7. **`depends_on` uses `condition: service_healthy`.** Never use bare `depends_on` — always require the dependency to pass its health check first.
8. **Resource limits on every service.** Default: `memory: 256M`, `cpus: '0.5'` per microservice. PostgreSQL gets `512M` and `1.0` CPU. Redis gets `128M` and `0.25` CPU.
9. **Environment variables use `${VAR:-default}` syntax.** All secrets and configurable values come from a `.env` file. Defaults are provided for non-sensitive values. Required secrets use `${VAR:?error message}` to fail fast.
10. **Service ordering by layer.** Platform (L1) → Shared (L2) → Domain (L3) → Frontend. This matches the dependency graph.
11. **`restart: unless-stopped` on every service.** Services restart on crash but not after explicit `docker compose stop`.
12. **DATABASE_URL format.** `postgresql://<user>:<pass>@postgres:5432/<db_name>` — uses the Docker service hostname `postgres`, internal port `5432`, and the module's dedicated database name.
13. **Shared environment variables.** Every backend service gets: `PORT`, `NODE_ENV`, `DATABASE_URL`, `RABBITMQ_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `LOG_LEVEL`. Module-specific vars (e.g., `NOTIFICATION_ENGINE_URL`) are added per service.
14. **Prisma Studio service.** Exposes port `5555` for database browsing during development. Connects to one module's database (typically the primary domain module).
15. **Frontend serves on port 5173 externally (8080 internally).** The nginx container listens on 8080, mapped to 5173 on the host (matching the Vite default for developer muscle memory).

## 4. Structure

```
products/<product-name>/
├── docker-compose.yml          # This file (complete development stack)
├── .env                        # Environment variables (git-ignored)
├── .env.example                # Template for .env
├── infra/
│   ├── service-registry.ts     # Typed source of truth
│   ├── generate.ts             # Generates nginx.conf, SQL, dev script
│   └── init-databases.sql      # CREATE DATABASE per module (auto-generated)
├── start-dev.sh                # One-command dev startup (auto-generated)
└── manifest.yaml               # Product manifest for deployment
```

**Network topology:**

```
                    ┌─────────┐
                    │ Browser │
                    └────┬────┘
                         │ :5173
                 ┌───────┴────────┐
                 │  frontend net  │
                 └───────┬────────┘
                    ┌────┴─────┐
                    │  nginx   │
                    │  (SPA +  │
                    │  proxy)  │
                    └────┬─────┘
                 ┌───────┴────────┐
                 │  backend net   │
                 └───────┬────────┘
          ┌──────┬───────┼───────┬──────┐
          │      │       │       │      │
       ┌──┴──┐┌──┴──┐┌───┴──┐┌──┴──┐┌──┴──┐
       │Auth ││Notif││Billing││TaxBi││Assess│ ...
       │:4100││:4101││:4102  ││:4103││:4104 │
       └──┬──┘└──┬──┘└──┬───┘└──┬──┘└──┬───┘
                 ┌───────┴────────┐
                 │   data net     │
                 └───────┬────────┘
          ┌──────────────┼──────────────┐
       ┌──┴───┐    ┌─────┴────┐   ┌────┴───┐
       │Postgres│  │RabbitMQ  │   │ Redis  │
       │:5433  │   │:5673     │   │:6380   │
       └───────┘   └──────────┘   └────────┘
```

**Service template — standard fields:**

| Field                            | Value                                           | Notes                            |
| -------------------------------- | ----------------------------------------------- | -------------------------------- |
| `build.context`                  | `../../`                                        | Always monorepo root             |
| `build.dockerfile`               | `modules/<layer>/<domain?>/<module>/Dockerfile` | Relative to context              |
| `restart`                        | `unless-stopped`                                | Always                           |
| `ports`                          | `"<PORT>:<PORT>"`                               | Host = internal for simplicity   |
| `environment.PORT`               | Port from service registry                      |                                  |
| `environment.NODE_ENV`           | `development`                                   |                                  |
| `environment.DATABASE_URL`       | `postgresql://...@postgres:5432/<db>`           | Per-module database              |
| `environment.RABBITMQ_URL`       | `amqp://...@rabbitmq:5672/<vhost>`              | Shared vhost                     |
| `environment.JWT_SECRET`         | `${JWT_SECRET}`                                 | From .env file                   |
| `depends_on`                     | Infra + upstream services                       | `condition: service_healthy`     |
| `networks`                       | `[backend, data]`                               | Always both for backend services |
| `deploy.resources.limits.memory` | `256M`                                          | Per service                      |
| `deploy.resources.limits.cpus`   | `'0.5'`                                         | Per service                      |
| `healthcheck.test`               | `wget --spider http://127.0.0.1:<PORT>/health`  | Alpine-compatible                |

## 5. Example Implementation

```yaml
# ══════════════════════════════════════════════════════════════════════════════
# DEVELOPMENT DOCKER COMPOSE — Product Name
# ══════════════════════════════════════════════════════════════════════════════
# ⚠️  WARNING: This configuration exposes service ports to the host for local
# development convenience. For production:
#   1. Remove or comment out host port mappings
#   2. Use Docker networks for inter-service communication only
#   3. Expose only the nginx reverse proxy to external traffic
#   4. Enable TLS termination at the load balancer / ingress
# ══════════════════════════════════════════════════════════════════════════════

services:
    # ─── Infrastructure ────────────────────────────────

    postgres:
        image: postgres:16-alpine
        restart: unless-stopped
        environment:
            POSTGRES_USER: ${POSTGRES_USER:-civic}
            POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
            POSTGRES_DB: ${POSTGRES_DB:-civic_platform}
        ports:
            - "5433:5432"
        volumes:
            - postgres_data:/var/lib/postgresql/data
            - ./init-databases.sql:/docker-entrypoint-initdb.d/01-init.sql
        deploy:
            resources:
                limits:
                    memory: 512M
                    cpus: "1.0"
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U civic"]
            interval: 5s
            timeout: 3s
            retries: 5
        networks:
            - data

    rabbitmq:
        image: rabbitmq:3.13-management-alpine
        restart: unless-stopped
        ports:
            - "5673:5672" # AMQP protocol
            - "15673:15672" # Management UI
        environment:
            RABBITMQ_DEFAULT_USER: ${RABBITMQ_DEFAULT_USER:-civic}
            RABBITMQ_DEFAULT_PASS: ${RABBITMQ_DEFAULT_PASS}
            RABBITMQ_DEFAULT_VHOST: ${RABBITMQ_DEFAULT_VHOST:-property-tax}
        volumes:
            - rabbitmq_data:/var/lib/rabbitmq
        deploy:
            resources:
                limits:
                    memory: 256M
                    cpus: "0.5"
        healthcheck:
            test: ["CMD", "rabbitmq-diagnostics", "check_port_connectivity"]
            interval: 10s
            timeout: 5s
            retries: 5
        networks:
            - data

    redis:
        image: redis:7-alpine
        restart: unless-stopped
        command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
        ports:
            - "6380:6379"
        environment:
            REDIS_PASSWORD: ${REDIS_PASSWORD:?REDIS_PASSWORD must be set}
        volumes:
            - redis_data:/data
        deploy:
            resources:
                limits:
                    memory: 128M
                    cpus: "0.25"
        healthcheck:
            test:
                ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}", "ping"]
            interval: 5s
            timeout: 3s
            retries: 5
        networks:
            - data

    # ─── Prisma Studio (DB Browser) ────────────────────

    prisma-studio:
        image: node:20-alpine
        working_dir: /app
        command: >
            sh -c "corepack enable &&
                   corepack prepare pnpm@10.29.3 --activate &&
                   cd modules/domain/revenue/resource-module &&
                   npx prisma studio --port 5555 --browser none --url $$DATABASE_URL"
        ports:
            - "5555:5555"
        environment:
            DATABASE_URL: postgresql://${POSTGRES_USER:-civic}:${POSTGRES_PASSWORD}@postgres:5432/resource_db
        volumes:
            - ../../:/app
        depends_on:
            postgres:
                condition: service_healthy
        networks:
            - data

    # ─── Platform Modules (L1) ─────────────────────────

    auth-gateway:
        build:
            context: ../../
            dockerfile: modules/platform/auth-gateway/Dockerfile
        restart: unless-stopped
        ports:
            - "4100:4100"
        environment:
            PORT: 4100
            NODE_ENV: development
            DATABASE_URL: postgresql://${POSTGRES_USER:-civic}:${POSTGRES_PASSWORD}@postgres:5432/auth_gateway
            RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER:-civic}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/${RABBITMQ_DEFAULT_VHOST:-property-tax}
            JWT_SECRET: ${JWT_SECRET}
            JWT_EXPIRES_IN: 15m
            REFRESH_TOKEN_EXPIRES_IN: 7d
            REDIS_URL: redis://:${REDIS_PASSWORD:?REDIS_PASSWORD must be set}@redis:6379
            LOGIN_RATE_LIMIT_MAX: "100"
            LOGIN_RATE_LIMIT_WINDOW_MS: "60000"
            LOG_LEVEL: debug
        depends_on:
            postgres:
                condition: service_healthy
            rabbitmq:
                condition: service_healthy
            redis:
                condition: service_healthy
        networks:
            - backend
            - data
        deploy:
            resources:
                limits:
                    memory: 256M
                    cpus: "0.5"
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    "wget --no-verbose --tries=1 --spider http://127.0.0.1:4100/health || exit 1",
                ]
            interval: 10s
            timeout: 5s
            retries: 3
            start_period: 30s

    notification-engine:
        build:
            context: ../../
            dockerfile: modules/platform/notification-engine/Dockerfile
        restart: unless-stopped
        ports:
            - "4101:4101"
        environment:
            PORT: 4101
            NODE_ENV: development
            DATABASE_URL: postgresql://${POSTGRES_USER:-civic}:${POSTGRES_PASSWORD}@postgres:5432/notification_engine
            RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER:-civic}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/${RABBITMQ_DEFAULT_VHOST:-property-tax}
            JWT_SECRET: ${JWT_SECRET}
            JWT_EXPIRES_IN: 15m
            LOG_LEVEL: debug
        depends_on:
            postgres:
                condition: service_healthy
            rabbitmq:
                condition: service_healthy
        networks:
            - backend
            - data
        deploy:
            resources:
                limits:
                    memory: 256M
                    cpus: "0.5"
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    "wget --no-verbose --tries=1 --spider http://127.0.0.1:4101/health || exit 1",
                ]
            interval: 10s
            timeout: 5s
            retries: 3
            start_period: 30s

    # ─── Shared Modules (L2) ───────────────────────────

    billing-invoicing:
        build:
            context: ../../
            dockerfile: modules/shared/billing-invoicing/Dockerfile
        restart: unless-stopped
        ports:
            - "4102:4102"
        environment:
            PORT: 4102
            NODE_ENV: development
            DATABASE_URL: postgresql://${POSTGRES_USER:-civic}:${POSTGRES_PASSWORD}@postgres:5432/billing_invoicing
            RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER:-civic}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/${RABBITMQ_DEFAULT_VHOST:-property-tax}
            NOTIFICATION_ENGINE_URL: http://notification-engine:4101
            JWT_SECRET: ${JWT_SECRET}
            JWT_EXPIRES_IN: 15m
            LOG_LEVEL: debug
        depends_on:
            postgres:
                condition: service_healthy
            rabbitmq:
                condition: service_healthy
            notification-engine:
                condition: service_healthy
        networks:
            - backend
            - data
        deploy:
            resources:
                limits:
                    memory: 256M
                    cpus: "0.5"
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    "wget --no-verbose --tries=1 --spider http://127.0.0.1:4102/health || exit 1",
                ]
            interval: 10s
            timeout: 5s
            retries: 3
            start_period: 30s

    # ─── Domain Modules (L3) ───────────────────────────

    resource-module:
        build:
            context: ../../
            dockerfile: modules/domain/revenue/resource-module/Dockerfile
        restart: unless-stopped
        ports:
            - "4104:4104"
        environment:
            PORT: 4104
            NODE_ENV: development
            DATABASE_URL: postgresql://${POSTGRES_USER:-civic}:${POSTGRES_PASSWORD}@postgres:5432/resource_db
            RABBITMQ_URL: amqp://${RABBITMQ_DEFAULT_USER:-civic}:${RABBITMQ_DEFAULT_PASS}@rabbitmq:5672/${RABBITMQ_DEFAULT_VHOST:-property-tax}
            JWT_SECRET: ${JWT_SECRET}
            JWT_EXPIRES_IN: 15m
            LOG_LEVEL: debug
        depends_on:
            postgres:
                condition: service_healthy
            rabbitmq:
                condition: service_healthy
        networks:
            - backend
            - data
        deploy:
            resources:
                limits:
                    memory: 256M
                    cpus: "0.5"
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    "wget --no-verbose --tries=1 --spider http://127.0.0.1:4104/health || exit 1",
                ]
            interval: 10s
            timeout: 5s
            retries: 3
            start_period: 30s

    # ─── Frontend ──────────────────────────────────────

    product-web:
        build:
            context: ../../
            dockerfile: apps/product-web/Dockerfile
        restart: unless-stopped
        ports:
            - "5173:8080"
        depends_on:
            resource-module:
                condition: service_healthy
        networks:
            - frontend
            - backend
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    "wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1",
                ]
            interval: 30s
            timeout: 3s
            retries: 3
            start_period: 10s

# ─── Volumes ──────────────────────────────────────────

volumes:
    postgres_data:
    rabbitmq_data:
    redis_data:

# ─── Networks ─────────────────────────────────────────

networks:
    frontend: # nginx ↔ browser
    backend: # nginx ↔ services ↔ services
    data: # services ↔ postgres/rabbitmq/redis
```

**Adapting for a new product:**

1. Copy the template and update service names, ports, and Dockerfile paths to match the new product's service registry.
2. Add/remove domain module services as needed. Every service follows the same block structure.
3. Update `init-databases.sql` mount path and Prisma Studio database URL.
4. Update the frontend service name and Dockerfile path.
5. Set `depends_on` for each service based on its `dependsOn` and `needsRedis` fields in the service registry.

**Adding a new service with `extraEnv` URLs:**

When a service references another service via URL (e.g., `NOTIFICATION_ENGINE_URL: http://notification-engine:4101`), that service must also appear in `depends_on` with `condition: service_healthy`:

```yaml
new-module:
    # ... standard fields ...
    environment:
        # ... standard env vars ...
        NOTIFICATION_ENGINE_URL: http://notification-engine:4101 # extraEnv from registry
    depends_on:
        postgres:
            condition: service_healthy
        rabbitmq:
            condition: service_healthy
        notification-engine: # must also be in depends_on
            condition: service_healthy
```

**Adding a service that needs Redis:**

When `needsRedis: true` in the service registry, add `REDIS_URL` to environment and `redis` to `depends_on`:

```yaml
redis-dependent-module:
    # ... standard fields ...
    environment:
        # ... standard env vars ...
        REDIS_URL: redis://:${REDIS_PASSWORD:?REDIS_PASSWORD must be set}@redis:6379
    depends_on:
        postgres:
            condition: service_healthy
        rabbitmq:
            condition: service_healthy
        redis:
            condition: service_healthy
```

**`.env` file template:**

```env
# ─── Infrastructure ──────────────────────────
POSTGRES_USER=civic
POSTGRES_PASSWORD=civic_dev_password
POSTGRES_DB=civic_platform
RABBITMQ_DEFAULT_USER=civic
RABBITMQ_DEFAULT_PASS=civic_dev_password
RABBITMQ_DEFAULT_VHOST=product-name
REDIS_PASSWORD=civic_dev_password

# ─── Application ─────────────────────────────
JWT_SECRET=dev-jwt-secret-change-in-production
ENCRYPTION_KEY=dev-encryption-key-32-chars-min!!
```
