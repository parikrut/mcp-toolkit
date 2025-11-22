# Health Check Endpoint

> Pattern documentation for the liveness and readiness health check controller using `@nestjs/terminus`, with public access and Docker HEALTHCHECK integration.

## 1. Component Pattern

The **Health Check** is a dedicated controller in each microservice that
exposes two endpoints for infrastructure probes. It lives in its own
`health/` directory within the module's `src/` folder. The controller is
decorated with `@Public()` to bypass authentication and uses NestJS Terminus
(`@nestjs/terminus`) for standardized health indicator aggregation. The two
endpoints serve distinct purposes:

- **`GET /health`** — Liveness probe: confirms the process is running
- **`GET /health/ready`** — Readiness probe: confirms the database connection is active

Both endpoints are excluded from the `ResponseEnvelopeInterceptor` (no
wrapping) and the `RequestLoggingMiddleware` (no log noise).

## 2. Overview

| Concern                 | Detail                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| **File location**       | `src/health/health.controller.ts` (within each module)                                                          |
| **Module registration** | `HealthModule` imported in the module's `AppModule`; requires `TerminusModule`                                  |
| **Authentication**      | `@Public()` — no JWT required                                                                                   |
| **Swagger**             | `@ApiTags("health")`                                                                                            |
| **Liveness endpoint**   | `GET /health` — returns `{ status: "ok", info: {}, error: {}, details: {} }`                                    |
| **Readiness endpoint**  | `GET /health/ready` — runs `SELECT 1` via PrismaService to verify DB                                            |
| **Docker integration**  | `HEALTHCHECK CMD wget --spider http://localhost:<PORT>/health`                                                  |
| **Skipped by**          | `ResponseEnvelopeInterceptor` (checks URL for `/health`), `RequestLoggingMiddleware` (checks URL for `/health`) |
| **Dependencies**        | `@nestjs/terminus` (TerminusModule, HealthCheckService), `PrismaService`                                        |

### Why Two Endpoints?

| Probe     | Kubernetes Use   | What It Tests                     | Failure Means                    |
| --------- | ---------------- | --------------------------------- | -------------------------------- |
| Liveness  | `livenessProbe`  | Process is running and responding | Container should be restarted    |
| Readiness | `readinessProbe` | Database is reachable             | Stop routing traffic to this pod |

## 3. Rules

1. **Every microservice has a `HealthModule`.** It is a self-contained
   NestJS module in `src/health/` with its own controller. It imports
   `TerminusModule` from `@nestjs/terminus`.
2. **`@Public()` on the controller class.** Health endpoints must be
   accessible without authentication — used by Docker, Kubernetes, and
   load balancers.
3. **`@ApiTags("health")` on the controller class.** Groups health
   endpoints in Swagger documentation.
4. **`@Controller("health")` sets the base path.** The liveness endpoint
   is at `/health`, readiness at `/health/ready`.
5. **`@HealthCheck()` decorator on each handler.** Required by Terminus
   for proper response formatting.
6. **Liveness probe is empty.** `this.health.check([])` — no indicators.
   If the process responds, it's alive.
7. **Readiness probe runs `SELECT 1`.** Uses `PrismaService.$queryRaw` to
   execute a trivial SQL query. If it succeeds, the database is reachable.
8. **Health indicator return shape.** Each health indicator function returns
   `{ <name>: { status: "up" | "down" } }`.
9. **Docker HEALTHCHECK** is `wget --spider http://localhost:<PORT>/health`
   (not `curl`). `wget --spider` only checks the HTTP status code without
   downloading the body.
10. **No response wrapping.** The `ResponseEnvelopeInterceptor` skips paths
    containing `/health`. Health endpoints return Terminus's native format.
11. **No request logging.** The `RequestLoggingMiddleware` skips paths
    containing `/health` to avoid log pollution from frequent probe calls.
12. **Module import order.** `HealthModule` should be imported after
    `PrismaModule` (or wherever `PrismaService` is provided) to ensure
    the dependency is available.

## 4. Structure

```
src/
├── health/
│   ├── health.module.ts         ← HealthModule (imports TerminusModule)
│   └── health.controller.ts     ← HealthController (@Public, @ApiTags)
├── prisma.service.ts            ← PrismaService (injected into HealthController)
└── app.module.ts                ← Imports HealthModule
```

### Docker Integration

```dockerfile
# In Dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --spider http://localhost:${PORT}/health || exit 1
```

### Kubernetes Integration

```yaml
# In deployment.yaml
livenessProbe:
    httpGet:
        path: /health
        port: 3000
    initialDelaySeconds: 10
    periodSeconds: 30

readinessProbe:
    httpGet:
        path: /health/ready
        port: 3000
    initialDelaySeconds: 5
    periodSeconds: 10
```

## 5. Example Implementation

### `src/health/health.controller.ts`

```typescript
import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthCheck, HealthCheckService, HealthCheckResult } from "@nestjs/terminus";
import { Public } from "@civic/common";
import { PrismaService } from "../prisma.service";

/**
 * Health check controller for liveness and readiness probes.
 * @Public() — no authentication required.
 * Skipped by ResponseEnvelopeInterceptor and RequestLoggingMiddleware.
 */
@Public()
@ApiTags("health")
@Controller("health")
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * Liveness probe — confirms the NestJS process is running.
     * Docker HEALTHCHECK and Kubernetes livenessProbe call this.
     */
    @Get()
    @HealthCheck()
    check(): Promise<HealthCheckResult> {
        return this.health.check([]);
    }

    /**
     * Readiness probe — confirms the database connection is active.
     * Kubernetes readinessProbe calls this to decide whether to
     * route traffic to this pod.
     */
    @Get("ready")
    @HealthCheck()
    ready(): Promise<HealthCheckResult> {
        return this.health.check([
            () =>
                this.prisma.$queryRaw`SELECT 1`.then(() => ({
                    database: { status: "up" as const },
                })),
        ]);
    }
}
```

### `src/health/health.module.ts`

```typescript
import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma.service";

@Module({
    imports: [TerminusModule],
    controllers: [HealthController],
    providers: [PrismaService],
})
export class HealthModule {}
```

### Registration in `AppModule`

```typescript
import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";

@Module({
    imports: [
        HealthModule,
        // ... other feature modules
    ],
})
export class AppModule {}
```

### Response Examples

**Liveness — `GET /health` (healthy)**:

```json
{
    "status": "ok",
    "info": {},
    "error": {},
    "details": {}
}
```

**Readiness — `GET /health/ready` (healthy)**:

```json
{
    "status": "ok",
    "info": {
        "database": {
            "status": "up"
        }
    },
    "error": {},
    "details": {
        "database": {
            "status": "up"
        }
    }
}
```

**Readiness — `GET /health/ready` (database down)**:

```json
{
    "status": "error",
    "info": {},
    "error": {
        "database": {
            "status": "down",
            "message": "Could not connect to database"
        }
    },
    "details": {
        "database": {
            "status": "down",
            "message": "Could not connect to database"
        }
    }
}
```

### Dockerfile Snippet

```dockerfile
FROM node:20-alpine AS runner

WORKDIR /app

# ... copy build artifacts ...

ENV PORT=3000
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/main.js"]
```
