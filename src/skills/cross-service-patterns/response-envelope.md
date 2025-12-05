# Response Envelope / Unwrap

## 1. Component Pattern

**Type:** NestJS Interceptor + Utility Function  
**Locations:**

- `packages/common/src/envelope.ts` — `unwrapEnvelope<T>()` utility
- `packages/common/src/interceptors/response-envelope.interceptor.ts` — `ResponseEnvelopeInterceptor`

**Consumers:**

- **Interceptor:** Every NestJS service (applied globally in `main.ts`)
- **Unwrap utility:** Every `BaseServiceClient` subclass (called automatically in `request()`)

This pattern ensures a **consistent API response shape** across all services and provides a matching **unwrap utility** so that internal service clients can transparently strip the envelope and work with raw data.

---

## 2. Overview

The platform uses a two-part envelope system:

### Part 1: Outgoing — `ResponseEnvelopeInterceptor`

Every NestJS service applies this interceptor globally. It wraps **all** successful HTTP responses in a standard envelope:

```json
{
    "success": true,
    "data": {
        /* actual response payload */
    },
    "timestamp": "2026-02-24T12:00:00.000Z"
}
```

This gives external consumers (frontends, third-party integrations) a predictable shape they can rely on — they always check `success` and read from `data`.

**Exception:** The `/health` endpoint is excluded from wrapping. Health checks return their raw payload for compatibility with Kubernetes liveness/readiness probes and load balancer health checks.

### Part 2: Incoming — `unwrapEnvelope<T>()`

When one service calls another, the response arrives wrapped in the envelope. The `BaseServiceClient.request()` method (see `base-service-client.md`) automatically calls `unwrapEnvelope()` to strip the `{ success, data }` wrapper and return the raw `data` value.

This means **concrete service clients and their callers never see the envelope** — they work with clean, typed data.

### Why an Envelope?

| Benefit            | Detail                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consistent shape   | Every API response has the same top-level structure. Frontend code can use a single response handler.                                                      |
| Success flag       | Distinguishes successful responses from error responses at the top level, even when HTTP status alone might be ambiguous (e.g., 200 with partial failure). |
| Timestamp          | Useful for caching, debugging, and audit trails without requiring consumers to parse `Date` headers.                                                       |
| Clean internal API | Service-to-service callers never deal with the envelope thanks to automatic unwrapping.                                                                    |

### Flow Diagram

```
Frontend/External                         Service A                        Service B
     │                                       │                                │
     │── GET /api/billing/123 ──────────────▶│                                │
     │                                       │── GET /api/assessment/456 ────▶│
     │                                       │                                │
     │                                       │◀── { success: true,           │
     │                                       │      data: { value: 500000 }, │
     │                                       │      timestamp: "..." }       │
     │                                       │                                │
     │                                       │  unwrapEnvelope() → { value: 500000 }
     │                                       │                                │
     │◀── { success: true,                  │                                │
     │      data: { bill: ... },            │                                │
     │      timestamp: "..." }              │                                │
     │                                       │                                │
     │  Frontend reads response.data.bill    │                                │
```

---

## 3. Rules

1. **Apply `ResponseEnvelopeInterceptor` globally** in every service's `main.ts` via `app.useGlobalInterceptors(new ResponseEnvelopeInterceptor())`. Do not apply it per-controller.
2. **Never manually wrap responses** in controllers. The interceptor handles it. Controllers return raw data:
    ```typescript
    @Get(":id")
    async findOne(@Param("id") id: string): Promise<PropertyDto> {
        return this.propertyService.findOne(id);  // Raw data — interceptor wraps it
    }
    ```
3. **Health endpoints are excluded.** Any URL containing `/health` bypasses the interceptor. Do not add other exclusions without platform-level agreement.
4. **Error responses are NOT wrapped by this interceptor.** NestJS exception filters handle error formatting separately. This interceptor only runs on successful (non-exception) responses.
5. **Always call `unwrapEnvelope()` when consuming another service's response.** The `BaseServiceClient` does this automatically — never call it manually in concrete clients.
6. **`unwrapEnvelope` is idempotent-safe.** If the value is not an envelope (no `success` + `data` keys), it returns the value as-is. This prevents double-unwrapping issues.
7. **Do not add fields to the envelope** (e.g., `meta`, `pagination`) at the interceptor level. Pagination metadata belongs inside the `data` payload itself.
8. **Import from `@myorg/common`.** Both `ResponseEnvelopeInterceptor` and `unwrapEnvelope` are re-exported from the common package barrel.
9. **The interceptor must be registered AFTER other transform interceptors** (e.g., `ClassSerializerInterceptor`) so that serialization happens before envelope wrapping.
10. **Do not rely on the envelope shape in service-to-service code.** Always go through `BaseServiceClient` which unwraps automatically. If you ever use raw `fetch()` (you shouldn't), you must call `unwrapEnvelope()` yourself.

---

## 4. Structure

```
packages/common/src/
├── envelope.ts                                    # unwrapEnvelope<T>() — THIS FILE
├── interceptors/
│   └── response-envelope.interceptor.ts           # ResponseEnvelopeInterceptor — THIS FILE
├── service-client.ts                              # createInternalHeaders()
├── base-service-client.ts                         # BaseServiceClient (calls unwrapEnvelope)
└── index.ts                                       # Barrel re-exports

modules/domain/<module>/src/
└── main.ts                                        # Registers interceptor globally
```

### Envelope Shape (TypeScript)

```typescript
interface ApiEnvelope<T> {
    success: true;
    data: T;
    timestamp: string; // ISO 8601
}
```

### Unwrap Function Signature

```typescript
/**
 * Strips the standard API envelope to extract the raw data payload.
 * If the value is not an envelope, returns it as-is (idempotent).
 *
 * @param value - The raw JSON response from another service
 * @returns The unwrapped data, typed as T
 */
export function unwrapEnvelope<T>(value: unknown): T;
```

### Registration in `main.ts`

```typescript
import { ResponseEnvelopeInterceptor } from "@myorg/common";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // ... other setup (CORS, pipes, etc.)

    // Register AFTER ClassSerializerInterceptor, BEFORE logging interceptors
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

    await app.listen(port);
}
```

---

## 5. Example Implementation

### The `unwrapEnvelope` Utility

```typescript
// packages/common/src/envelope.ts

/**
 * Strips the { success, data, timestamp } envelope from an API response.
 *
 * All services wrap responses in this standard envelope via ResponseEnvelopeInterceptor.
 * When one service calls another via BaseServiceClient, this function is called
 * automatically to extract the raw data.
 *
 * If the value does not match the envelope shape, it is returned as-is.
 * This makes the function safe to call on already-unwrapped data.
 *
 * @param value - Raw JSON response body from fetch()
 * @returns The unwrapped data typed as T
 *
 * @example
 * // Enveloped response from another service:
 * const raw = { success: true, data: { id: "123", name: "Main St" }, timestamp: "..." };
 * const result = unwrapEnvelope<Property>(raw);
 * // result === { id: "123", name: "Main St" }
 *
 * @example
 * // Non-enveloped value (idempotent):
 * const raw = { id: "123", name: "Main St" };
 * const result = unwrapEnvelope<Property>(raw);
 * // result === { id: "123", name: "Main St" }
 */
export function unwrapEnvelope<T>(value: unknown): T {
    if (value && typeof value === "object" && "success" in value && "data" in value) {
        return (value as { data: T }).data;
    }
    return value as T;
}
```

### The `ResponseEnvelopeInterceptor`

```typescript
// packages/common/src/interceptors/response-envelope.interceptor.ts

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, map } from "rxjs";

/**
 * Global interceptor that wraps all successful HTTP responses in a standard envelope:
 *
 *   {
 *       "success": true,
 *       "data": <controller return value>,
 *       "timestamp": "2026-02-24T12:00:00.000Z"
 *   }
 *
 * This provides a consistent API shape for all consumers (frontends, integrations).
 *
 * Excluded endpoints:
 *   - /health (Kubernetes probes expect raw responses)
 *
 * Note: This interceptor does NOT handle errors. NestJS exception filters
 * format error responses separately.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();

        // Skip wrapping for health check endpoints
        if (request.url?.includes("/health")) {
            return next.handle();
        }

        return next.handle().pipe(
            map((data) => ({
                success: true,
                data,
                timestamp: new Date().toISOString(),
            })),
        );
    }
}
```

### Registration in a Service's `main.ts`

```typescript
// modules/domain/my-product/src/main.ts

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, ClassSerializerInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ResponseEnvelopeInterceptor } from "@myorg/common";
import { AppModule } from "./app.module";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Global prefix for all routes
    app.setGlobalPrefix("api/my-product");

    // Validation pipe for incoming DTOs
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );

    // Interceptors — order matters:
    // 1. ClassSerializerInterceptor: transforms class instances (excludes @Exclude() fields)
    // 2. ResponseEnvelopeInterceptor: wraps the serialized result in { success, data, timestamp }
    app.useGlobalInterceptors(
        new ClassSerializerInterceptor(app.get(Reflector)),
        new ResponseEnvelopeInterceptor(),
    );

    const port = process.env.PORT ?? 3010;
    await app.listen(port);
}
bootstrap();
```

### How It Looks End-to-End

**Controller returns raw data:**

```typescript
// modules/domain/my-product/src/controllers/property.controller.ts

@Controller("properties")
export class PropertyController {
    constructor(private readonly propertyService: PropertyService) {}

    @Get(":id")
    async findOne(@Param("id") id: string): Promise<PropertyDto> {
        // Returns a plain object — no envelope wrapping here
        return this.propertyService.findOne(id);
    }

    @Get()
    async findAll(@Query() query: PropertyQueryDto): Promise<PaginatedResult<PropertyDto>> {
        // Pagination metadata is INSIDE the data, NOT in the envelope
        return this.propertyService.findAll(query);
    }
}
```

**External consumer (frontend) receives:**

```json
{
    "success": true,
    "data": {
        "id": "prop-001",
        "rollNumber": "1234-567-890-12345",
        "address": "123 Main Street",
        "assessedValue": 500000,
        "propertyClass": "RESIDENTIAL"
    },
    "timestamp": "2026-02-24T12:00:00.000Z"
}
```

**Internal consumer (another service via BaseServiceClient) receives:**

```typescript
// After automatic unwrapEnvelope() in BaseServiceClient.request():
{
    id: "prop-001",
    rollNumber: "1234-567-890-12345",
    address: "123 Main Street",
    assessedValue: 500000,
    propertyClass: "RESIDENTIAL"
}
```

### Frontend Usage Pattern

```typescript
// apps/my-app-web/src/api/client.ts

interface ApiResponse<T> {
    success: boolean;
    data: T;
    timestamp: string;
}

async function fetchApi<T>(path: string): Promise<T> {
    const response = await fetch(`/api${path}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }

    const envelope: ApiResponse<T> = await response.json();

    if (!envelope.success) {
        throw new Error("API returned success: false");
    }

    return envelope.data;
}

// Usage:
const property = await fetchApi<PropertyDto>("/my-product/properties/prop-001");
// property is already unwrapped — { id, rollNumber, address, ... }
```

### Health Endpoint (Excluded from Envelope)

```typescript
// modules/domain/my-product/src/controllers/health.controller.ts

@Controller("health")
export class HealthController {
    @Get()
    check() {
        // Returns raw — NOT wrapped in envelope
        return { status: "ok", uptime: process.uptime() };
    }
}
```

**Response (no envelope):**

```json
{
    "status": "ok",
    "uptime": 12345.678
}
```
