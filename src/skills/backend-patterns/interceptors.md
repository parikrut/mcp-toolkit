# NestJS Interceptors

> Pattern documentation for the four global interceptors that wrap every request/response cycle: correlation ID tracking, response envelope standardization, response schema validation, and audit logging.

## 1. Component Pattern

The **Interceptors** are four `@Injectable()` classes implementing
`NestInterceptor` that run in a specific order around every request. They are
applied globally in `bootstrapModule()` and use RxJS `tap` / `map` /
`catchError` operators on the response observable. The execution order is:

1. **CorrelationIdInterceptor** — reads or generates a correlation ID
2. **ResponseEnvelopeInterceptor** — wraps success responses in a standard envelope
3. **ResponseValidationInterceptor** — validates response data against Zod schemas
4. **AuditInterceptor** — logs audit entries for decorated handlers

Interceptors run AFTER guards but BEFORE the response is sent to the client.
The "before" phase (pre-`handle()`) runs top-down (1→4), and the "after"
phase (post-`handle()`, in the RxJS pipe) runs bottom-up (4→1).

## 2. Overview

| Interceptor                     | File                                              | Purpose                                                            | Skips                           |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `CorrelationIdInterceptor`      | `interceptors/correlation-id.interceptor.ts`      | Reads `X-Correlation-Id` header or generates UUID; sets on req/res | Never                           |
| `ResponseEnvelopeInterceptor`   | `interceptors/response-envelope.interceptor.ts`   | Wraps response in `{ success, data, timestamp }` envelope          | Paths containing `/health`      |
| `ResponseValidationInterceptor` | `interceptors/response-validation.interceptor.ts` | Validates response data against `@ResponseSchema()` Zod schema     | No `@ResponseSchema()` metadata |
| `AuditInterceptor`              | `interceptors/audit.interceptor.ts`               | Logs structured audit entries on success/failure                   | No `@AuditAction()` metadata    |

### Standard Response Envelope

```json
{
    "success": true,
    "data": {
        /* original controller response */
    },
    "timestamp": "2026-02-24T14:30:00.000Z"
}
```

## 3. Rules

1. **Registration order matters.** Interceptors are registered in order in
   `bootstrapModule()` via `app.useGlobalInterceptors()`. The call order is
   CorrelationId → ResponseEnvelope → ResponseValidation → Audit.
2. **CorrelationIdInterceptor** reads `X-Correlation-Id` from the request
   header. If absent, it generates a UUID v4. It sets the ID on both the
   request object (`request.correlationId`) and the response header
   (`X-Correlation-Id`).
3. **ResponseEnvelopeInterceptor** uses `map()` to wrap the response. It
   checks `request.url` — if the URL contains `/health`, it passes the
   response through unwrapped. The envelope shape is:
   `{ success: true, data: <response>, timestamp: new Date().toISOString() }`.
4. **ResponseValidationInterceptor** reads `@ResponseSchema()` metadata via
   `Reflector`. If no metadata exists, it passes through. If metadata exists:
    - **Development** (`NODE_ENV !== "production"`): calls `schema.parse(data)`
      and throws on failure.
    - **Production**: calls `schema.safeParse(data)` and logs a warning on
      failure but returns the original data.
5. **AuditInterceptor** reads `@AuditAction()` metadata via `Reflector`. If
   no metadata exists, it passes through. On handler completion:
    - **Success**: logs at INFO level with action, resource, resourceId,
      user, module, ipAddress, correlationId, and sanitized request details.
    - **Failure**: logs at WARNING level with the error message added.
6. **ResourceId extraction**: AuditInterceptor extracts `resourceId` from
   `request.params.id` (the standard `:id` route parameter).
7. **Module extraction**: AuditInterceptor derives the module name from the
   URL path — typically the first segment after the API prefix.
8. **Sensitive data sanitization**: AuditInterceptor recursively traverses
   request body/query objects and redacts values for keys matching:
   `password`, `token`, `secret`, `ssn`, `sin`, `creditCard`, `bankAccount`.
   Redacted value is `"[REDACTED]"`.
9. **IP address extraction**: From `request.ip` or
   `request.headers["x-forwarded-for"]`.
10. **All interceptors are in `packages/common/src/interceptors/`** and
    re-exported from `interceptors/index.ts`.

## 4. Structure

```
packages/common/src/interceptors/
├── index.ts                               ← Barrel re-export
├── correlation-id.interceptor.ts          ← CorrelationIdInterceptor
├── response-envelope.interceptor.ts       ← ResponseEnvelopeInterceptor
├── response-validation.interceptor.ts     ← ResponseValidationInterceptor
└── audit.interceptor.ts                   ← AuditInterceptor
```

### Execution Timeline

```
Request →
  ┌─ CorrelationIdInterceptor (before): read/generate correlation ID
  │  ┌─ ResponseEnvelopeInterceptor (before): noop
  │  │  ┌─ ResponseValidationInterceptor (before): noop
  │  │  │  ┌─ AuditInterceptor (before): record start time
  │  │  │  │
  │  │  │  │  Controller Handler executes
  │  │  │  │
  │  │  │  └─ AuditInterceptor (after): log audit entry
  │  │  └─ ResponseValidationInterceptor (after): validate against Zod schema
  │  └─ ResponseEnvelopeInterceptor (after): wrap in { success, data, timestamp }
  └─ CorrelationIdInterceptor (after): set response header
→ Response
```

## 5. Example Implementation

### `packages/common/src/interceptors/correlation-id.interceptor.ts`

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { randomUUID } from "crypto";

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();

        // Read existing correlation ID or generate a new one
        const correlationId = request.headers["x-correlation-id"] || randomUUID();

        // Attach to request for downstream use (audit interceptor, services)
        request.correlationId = correlationId;

        return next.handle().pipe(
            tap(() => {
                // Set on response header for client tracing
                response.setHeader("X-Correlation-Id", correlationId);
            }),
        );
    }
}
```

### `packages/common/src/interceptors/response-envelope.interceptor.ts`

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface ResponseEnvelope<T> {
    success: boolean;
    data: T;
    timestamp: string;
}

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<T> | T> {
    intercept(
        context: ExecutionContext,
        next: CallHandler<T>,
    ): Observable<ResponseEnvelope<T> | T> {
        const request = context.switchToHttp().getRequest();

        return next.handle().pipe(
            map((data) => {
                // Skip wrapping for health check endpoints
                if (request.url?.includes("/health")) {
                    return data;
                }

                return {
                    success: true,
                    data,
                    timestamp: new Date().toISOString(),
                };
            }),
        );
    }
}
```

### `packages/common/src/interceptors/response-validation.interceptor.ts`

```typescript
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { ZodSchema } from "zod";
import { RESPONSE_SCHEMA_KEY } from "../decorators/response-schema.decorator";

@Injectable()
export class ResponseValidationInterceptor implements NestInterceptor {
    private readonly logger = new Logger(ResponseValidationInterceptor.name);

    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        // Read @ResponseSchema() metadata
        const schema = this.reflector.get<ZodSchema>(RESPONSE_SCHEMA_KEY, context.getHandler());

        // No schema defined — pass through
        if (!schema) {
            return next.handle();
        }

        return next.handle().pipe(
            map((data) => {
                if (process.env.NODE_ENV !== "production") {
                    // Development: strict validation — throws on failure
                    schema.parse(data);
                    return data;
                }

                // Production: lenient validation — log warning but return data
                const result = schema.safeParse(data);
                if (!result.success) {
                    this.logger.warn(`Response validation failed: ${result.error.message}`, {
                        handler: context.getHandler().name,
                        controller: context.getClass().name,
                        errors: result.error.flatten(),
                    });
                }

                return data;
            }),
        );
    }
}
```

### `packages/common/src/interceptors/audit.interceptor.ts`

```typescript
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { throwError } from "rxjs";
import { AUDIT_ACTION_KEY, AuditActionMetadata } from "../decorators/audit-action.decorator";
import { RequestUser } from "../auth.guard";

/** Keys whose values are replaced with "[REDACTED]" in audit logs. */
const SENSITIVE_KEYS = new Set([
    "password",
    "token",
    "secret",
    "ssn",
    "sin",
    "creditcard",
    "bankaccount",
]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    private readonly logger = new Logger("AuditLog");

    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        // Read @AuditAction() metadata
        const auditMeta = this.reflector.get<AuditActionMetadata>(
            AUDIT_ACTION_KEY,
            context.getHandler(),
        );

        // No @AuditAction() decorator — pass through
        if (!auditMeta) {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user as RequestUser | undefined;
        const startTime = Date.now();

        // Build base audit entry
        const baseEntry = {
            action: auditMeta.action,
            resource: auditMeta.resource ?? this.extractModule(request.url),
            resourceId: request.params?.id ?? null,
            userId: user?.userId ?? "anonymous",
            userEmail: user?.email ?? "anonymous",
            userRole: user?.role ?? "unknown",
            municipalityId: user?.municipalityId ?? null,
            module: this.extractModule(request.url),
            ipAddress: request.ip || request.headers["x-forwarded-for"] || "unknown",
            correlationId: request.correlationId ?? null,
            method: request.method,
            url: request.url,
            details: this.sanitize({
                body: request.body,
                query: request.query,
            }),
        };

        return next.handle().pipe(
            tap(() => {
                this.logger.log({
                    ...baseEntry,
                    status: "SUCCESS",
                    duration: Date.now() - startTime,
                });
            }),
            catchError((error) => {
                this.logger.warn({
                    ...baseEntry,
                    status: "FAILURE",
                    duration: Date.now() - startTime,
                    error: error.message,
                });
                return throwError(() => error);
            }),
        );
    }

    /**
     * Extracts the module name from the URL path.
     * e.g., "/api/v1/assessments/123" → "assessments"
     */
    private extractModule(url: string): string {
        const segments = url.split("/").filter(Boolean);
        // Skip "api" and version segments
        for (const segment of segments) {
            if (segment !== "api" && !segment.startsWith("v")) {
                return segment;
            }
        }
        return "unknown";
    }

    /**
     * Recursively sanitizes an object, replacing sensitive key values
     * with "[REDACTED]".
     */
    private sanitize(obj: any): any {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj !== "object") return obj;

        if (Array.isArray(obj)) {
            return obj.map((item) => this.sanitize(item));
        }

        const sanitized: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                sanitized[key] = "[REDACTED]";
            } else {
                sanitized[key] = this.sanitize(value);
            }
        }
        return sanitized;
    }
}
```

### `packages/common/src/interceptors/index.ts`

```typescript
export { CorrelationIdInterceptor } from "./correlation-id.interceptor";
export { ResponseEnvelopeInterceptor, ResponseEnvelope } from "./response-envelope.interceptor";
export { ResponseValidationInterceptor } from "./response-validation.interceptor";
export { AuditInterceptor } from "./audit.interceptor";
```

### Global Registration in `bootstrapModule()`

```typescript
import {
    CorrelationIdInterceptor,
    ResponseEnvelopeInterceptor,
    ResponseValidationInterceptor,
    AuditInterceptor,
} from "@civic/common";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Order matters: CorrelationId → ResponseEnvelope → ResponseValidation → Audit
    app.useGlobalInterceptors(
        new CorrelationIdInterceptor(),
        new ResponseEnvelopeInterceptor(),
        app.get(ResponseValidationInterceptor), // Needs DI for Reflector
        app.get(AuditInterceptor), // Needs DI for Reflector
    );

    await app.listen(3000);
}
```
