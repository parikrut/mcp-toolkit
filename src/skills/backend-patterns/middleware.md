# NestJS Middleware

> Pattern documentation for the three global middleware that run before guards and interceptors: API versioning, correlation ID setup, and request logging.

## 1. Component Pattern

The **Middleware** are three `@Injectable()` classes implementing `NestMiddleware`
that run on every incoming request BEFORE guards, interceptors, and route
handlers. They are applied in the `AppModule` via the `configure()` method of
the `NestModule` interface using `consumer.apply().forRoutes("*")`. The
middleware handles cross-cutting concerns that must occur at the earliest
possible stage of request processing:

1. **ApiVersionMiddleware** — stamps every response with an API version header
2. **CorrelationIdMiddleware** — ensures every request has a correlation ID
3. **RequestLoggingMiddleware** — logs method, URL, status code, and duration

## 2. Overview

| Middleware                 | File                                       | Purpose                                                                | Skips               |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- | ------------------- |
| `ApiVersionMiddleware`     | `middleware/api-version.middleware.ts`     | Sets `X-API-Version: 1.0` header on every response                     | Never               |
| `CorrelationIdMiddleware`  | `middleware/correlation-id.middleware.ts`  | Reads `X-Correlation-Id` header or generates UUID; attaches to request | Never               |
| `RequestLoggingMiddleware` | `middleware/request-logging.middleware.ts` | Logs HTTP method, URL, status code, and duration in ms                 | `/health` endpoints |

### Execution Position in the NestJS Lifecycle

```
Client Request
  → Middleware (ApiVersion → CorrelationId → RequestLogging)
    → Guards (AuthGuard → RolesGuard)
      → Interceptors (before phase)
        → Pipes
          → Route Handler
        → Interceptors (after phase)
      → Exception Filters
    → Response
```

Middleware is the **first code to touch the request** and the **last code to
touch the response** (via `res.on("finish", ...)`).

## 3. Rules

1. **All middleware are in `packages/common/src/middleware/`** and re-exported
   from `middleware/index.ts`.
2. **Applied via `NestModule.configure()`.** The `AppModule` (or the shared
   `CommonModule`) implements `NestModule` and registers middleware:
    ```typescript
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(ApiVersionMiddleware, CorrelationIdMiddleware, RequestLoggingMiddleware).forRoutes("*");
    }
    ```
3. **Order in `.apply()` matters.** Middleware executes left-to-right in the
   order passed to `.apply()`.
4. **ApiVersionMiddleware** calls `res.setHeader("X-API-Version", "1.0")`
   then `next()`. No conditional logic. The version string is hardcoded.
5. **CorrelationIdMiddleware** reads `req.headers["x-correlation-id"]`. If
   present, it uses that value. If absent, it generates a UUID v4 via
   `crypto.randomUUID()`. The ID is attached to `req.correlationId` for
   downstream use by the `AuditInterceptor` and services.
6. **RequestLoggingMiddleware** records `Date.now()` at the start, then
   listens for `res.on("finish", ...)` to compute duration. It logs:
   `[HTTP] GET /api/v1/properties 200 45ms`. It skips logging for URLs
   containing `/health` to avoid noise from Kubernetes probes.
7. **All middleware call `next()`.** They are pass-through — they never
   short-circuit the request (unlike guards).
8. **Middleware has access to `req`, `res`, `next`** — raw Express objects,
   not NestJS execution context. This is the key difference from interceptors.
9. **Correlation ID set in middleware vs interceptor:** The middleware sets
   `req.correlationId` early so it's available in guards and interceptors.
   The `CorrelationIdInterceptor` additionally sets the response header and
   can access NestJS execution context.

## 4. Structure

```
packages/common/src/middleware/
├── index.ts                            ← Barrel re-export
├── api-version.middleware.ts           ← ApiVersionMiddleware
├── correlation-id.middleware.ts        ← CorrelationIdMiddleware
└── request-logging.middleware.ts       ← RequestLoggingMiddleware
```

## 5. Example Implementation

### `packages/common/src/middleware/api-version.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

@Injectable()
export class ApiVersionMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
        res.setHeader("X-API-Version", "1.0");
        next();
    }
}
```

### `packages/common/src/middleware/correlation-id.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

// Extend Express Request to include correlationId
declare global {
    namespace Express {
        interface Request {
            correlationId?: string;
        }
    }
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
        // Use existing correlation ID from upstream service or generate a new one
        const correlationId = (req.headers["x-correlation-id"] as string) || randomUUID();

        // Attach to request for downstream use (guards, interceptors, services)
        req.correlationId = correlationId;

        next();
    }
}
```

### `packages/common/src/middleware/request-logging.middleware.ts`

```typescript
import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
    private readonly logger = new Logger("HTTP");

    use(req: Request, res: Response, next: NextFunction): void {
        // Skip health check endpoints to avoid log noise from probes
        if (req.url?.includes("/health")) {
            return next();
        }

        const startTime = Date.now();
        const { method, url } = req;

        // Listen for response finish to compute duration
        res.on("finish", () => {
            const duration = Date.now() - startTime;
            const { statusCode } = res;

            this.logger.log(`${method} ${url} ${statusCode} ${duration}ms`);
        });

        next();
    }
}
```

### `packages/common/src/middleware/index.ts`

```typescript
export { ApiVersionMiddleware } from "./api-version.middleware";
export { CorrelationIdMiddleware } from "./correlation-id.middleware";
export { RequestLoggingMiddleware } from "./request-logging.middleware";
```

### Registration in `AppModule`

```typescript
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import {
    ApiVersionMiddleware,
    CorrelationIdMiddleware,
    RequestLoggingMiddleware,
} from "@myorg/common";

@Module({
    imports: [
        /* ... */
    ],
    controllers: [
        /* ... */
    ],
    providers: [
        /* ... */
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(ApiVersionMiddleware, CorrelationIdMiddleware, RequestLoggingMiddleware)
            .forRoutes("*");
    }
}
```

### Full Request Lifecycle Example

A `POST /api/v1/assessments` request flows through:

```
1. ApiVersionMiddleware     → Sets X-API-Version: 1.0 header
2. CorrelationIdMiddleware  → Generates correlationId, attaches to req
3. RequestLoggingMiddleware → Records start time, hooks res.on("finish")
4. AuthGuard                → Verifies JWT, sets request.user
5. RolesGuard               → Checks @Roles("ASSESSOR"), verifies level
6. CorrelationIdInterceptor → Sets X-Correlation-Id response header
7. ResponseEnvelopeInterceptor → (after) Wraps response in envelope
8. ResponseValidationInterceptor → (after) Validates against Zod schema
9. AuditInterceptor         → (after) Logs audit entry with sanitized body
10. RequestLoggingMiddleware → res.on("finish") fires, logs "POST /api/v1/assessments 201 85ms"
```
