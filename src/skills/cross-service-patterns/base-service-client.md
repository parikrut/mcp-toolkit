# Abstract Base Service Client

## 1. Component Pattern

**Type:** Abstract Class  
**Location:** `packages/common/src/base-service-client.ts`  
**Consumers:** Every module that calls another service over HTTP (e.g., `OrderManagementClient`, `BillingClient`, `PaymentClient`, `NotificationClient`)

This pattern defines the `BaseServiceClient` abstract class — the single HTTP transport layer for all internal service-to-service communication. Concrete clients extend it and expose domain-specific methods while inheriting retry logic, timeouts, response unwrapping, and optional Zod validation.

---

## 2. Overview

In a composable microservice architecture, services frequently call each other (e.g., Billing → Order Record, Payment → Billing, Notification → CRM). Rather than repeating HTTP plumbing in each client, the platform centralises it in `BaseServiceClient`.

### What It Does

1. **Authenticated requests** — delegates to `createInternalHeaders()` (see `service-client.md`) for JWT + correlation ID headers.
2. **Retry with exponential backoff** — automatically retries on 5xx errors and network failures (up to 2 retries with 500ms → 1000ms delays).
3. **Abort timeout** — each request has a 10-second default timeout via `AbortController`. Prevents hung connections from blocking the event loop.
4. **Response unwrapping** — calls `unwrapEnvelope()` (see `response-envelope.md`) to strip the `{ success, data, timestamp }` wrapper that all services apply to outgoing responses.
5. **Optional Zod validation** — if a `responseSchema` is provided in options, the response is validated against it. In development, validation failures throw. In production, they log a warning and return the data anyway (graceful degradation).
6. **Convenience methods** — `get()`, `post()`, `put()`, `patch()`, `del()` delegate to the core `request()` method.

### Design Decisions

| Decision                        | Rationale                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Native `fetch()`                | No external HTTP library (no axios). Reduces dependencies and aligns with Node 18+ built-in support. |
| Max 2 retries                   | Enough to survive transient blips without masking systemic failures.                                 |
| Exponential backoff (500ms, 1s) | Gives the downstream service time to recover without overwhelming it.                                |
| 10s timeout                     | Matches typical load balancer timeouts. Long enough for DB queries, short enough to fail fast.       |
| Prod graceful degradation       | A schema mismatch in production should not crash a running service. Log and proceed.                 |
| `correlationId` shorthand       | Passing a string as `options` is treated as `{ correlationId: string }` for ergonomic call sites.    |

### When to Use

- **Any time one NestJS module needs data from another module's HTTP API.**
- Create a concrete client class in `modules/domain/<module>/src/clients/<downstream>-client.ts`.
- Register it as needed (typically instantiated directly, not injected via DI, since it has no NestJS dependencies).

---

## 3. Rules

1. **Every service client MUST extend `BaseServiceClient`.** Do not use raw `fetch()` for inter-service calls.
2. **Constructor MUST receive a base URL from an environment variable.** Example: `super(process.env.ORDER_MANAGEMENT_URL ?? "http://localhost:3020")`. Never hard-code production URLs.
3. **Always provide a fallback localhost URL** in the constructor for local development without service discovery.
4. **Use the convenience methods** (`get`, `post`, `patch`, `del`) in concrete clients. Only call `request()` directly when you need a non-standard HTTP method (e.g., `PUT`).
5. **Forward `correlationId`** from the incoming request context through the concrete client method → `request()` → `createInternalHeaders()`.
6. **Do not catch errors in concrete client methods** unless you need to transform them. Let the caller (service layer) handle failures.
7. **Provide `responseSchema` for critical paths** where data integrity matters. Omit it for fire-and-forget or best-effort calls.
8. **Do not override `request()` in concrete clients.** If you need custom behaviour, compose it in the concrete method before/after calling the base convenience method.
9. **One concrete client per downstream service.** Do not create a god-client that talks to multiple services.
10. **File naming convention:** `<downstream-service>-client.ts` in the consuming module's `clients/` directory.
11. **Timeout can be overridden per-request** via `options.timeout` for known slow endpoints (e.g., report generation). Keep overrides rare and documented.
12. **Retry only on 5xx and network errors.** 4xx errors (bad request, not found, unauthorized) are never retried — they indicate a caller bug or a legitimate "not found" condition.

---

## 4. Structure

```
packages/common/src/
├── base-service-client.ts     # BaseServiceClient abstract class — THIS FILE
├── service-client.ts          # createInternalHeaders() (see service-client.md)
├── envelope.ts                # unwrapEnvelope() (see response-envelope.md)
├── logger.ts                  # createLogger()
└── index.ts                   # Barrel re-exports

modules/domain/<module>/src/
├── clients/
│   ├── <downstream>-client.ts # Concrete client extending BaseServiceClient
│   └── index.ts
├── services/
│   └── <module>.service.ts    # Injects/uses the concrete client
└── <module>.module.ts
```

### Class Hierarchy

```
BaseServiceClient (abstract)
├── OrderManagementClient      → talks to Order Record service
├── BillingClient             → talks to Billing service
├── PaymentClient             → talks to Payment service
├── NotificationClient        → talks to Notification service
├── DocumentClient            → talks to Document Management service
├── AuditClient               → talks to Audit service
└── ... (one per downstream service)
```

### Core Method Signature

```typescript
protected async request<T>(
    method: string,        // HTTP method: "GET" | "POST" | "PATCH" | "DELETE" | ...
    path: string,          // URL path appended to baseUrl, e.g., "/api/properties/123"
    body?: unknown,        // Request body (auto-serialised to JSON)
    options?: RequestOptions | string,  // Options object or correlationId shorthand
): Promise<T>;
```

### RequestOptions Interface

```typescript
interface RequestOptions {
    correlationId?: string; // Forwarded to createInternalHeaders()
    responseSchema?: ZodSchema; // Optional Zod schema to validate the response
    timeout?: number; // Override default 10s timeout (milliseconds)
}
```

### Request Lifecycle

```
ConcreteClient.getProperty(id, correlationId)
  │
  ▼
BaseServiceClient.get<T>(path, correlationId)
  │
  ▼
BaseServiceClient.request<T>("GET", path, undefined, { correlationId })
  │
  ├─→ createInternalHeaders(correlationId)  → { Authorization, Content-Type, X-Correlation-Id }
  │
  ├─→ AbortController with 10s timeout
  │
  ├─→ fetch(url, { method, headers, body, signal })
  │     │
  │     ├─ 2xx → response.json() → unwrapEnvelope() → [optional Zod validate] → return data
  │     │
  │     ├─ 5xx → retry (up to 2x with backoff 500ms, 1000ms)
  │     │
  │     └─ 4xx → throw immediately (no retry)
  │
  └─→ Network error → retry (up to 2x with backoff)
```

---

## 5. Example Implementation

### The `BaseServiceClient` Abstract Class

```typescript
// packages/common/src/base-service-client.ts

import { createInternalHeaders } from "./service-client";
import { unwrapEnvelope } from "./envelope";
import { createLogger } from "./logger";
import type { ZodSchema } from "zod";

interface RequestOptions {
    correlationId?: string;
    responseSchema?: ZodSchema;
    timeout?: number;
}

const logger = createLogger({ module: "service-client" });

export abstract class BaseServiceClient {
    constructor(protected readonly baseUrl: string) {}

    /**
     * Core HTTP request method with retry, timeout, unwrapping, and optional validation.
     *
     * @param method - HTTP method (GET, POST, PATCH, DELETE, etc.)
     * @param path - URL path appended to the baseUrl
     * @param body - Optional request body (will be JSON.stringify'd)
     * @param options - RequestOptions object or correlationId string shorthand
     * @returns The unwrapped, optionally validated response data
     */
    protected async request<T>(
        method: string,
        path: string,
        body?: unknown,
        options?: RequestOptions | string,
    ): Promise<T> {
        // Normalise options — a bare string is treated as correlationId shorthand
        const opts: RequestOptions =
            typeof options === "string" ? { correlationId: options } : (options ?? {});

        const url = `${this.baseUrl}${path}`;
        const headers = createInternalHeaders(opts.correlationId);

        // Abort controller for request timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), opts.timeout ?? 10_000);

        let lastError: Error | null = null;
        const maxRetries = 2;
        const delays = [500, 1000];

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    const errorBody = await response.text();

                    // Retry only on 5xx (server errors) — 4xx errors are never retried
                    if (response.status >= 500 && attempt < maxRetries) {
                        lastError = new Error(`${response.status}: ${errorBody}`);
                        logger.warn(
                            { method, url, status: response.status, attempt },
                            "Retrying after server error",
                        );
                        await new Promise((r) => setTimeout(r, delays[attempt]));
                        continue;
                    }

                    throw new Error(`Service call failed: ${response.status} ${errorBody}`);
                }

                // Parse JSON and strip the { success, data, timestamp } envelope
                const json = await response.json();
                const data = unwrapEnvelope<T>(json);

                // Optional Zod validation
                if (opts.responseSchema) {
                    const result = opts.responseSchema.safeParse(data);
                    if (!result.success) {
                        if (process.env.NODE_ENV === "production") {
                            // Graceful degradation: warn but don't crash
                            logger.warn(
                                { path, issues: result.error.issues },
                                "Response validation warning — returning unvalidated data",
                            );
                            return data;
                        }
                        // In development: fail loudly so devs catch schema mismatches early
                        throw new Error(
                            `Response validation failed for ${method} ${path}: ${result.error.message}`,
                        );
                    }
                }

                return data;
            } catch (error) {
                clearTimeout(timeout);

                // If we've exhausted retries, re-throw
                if (attempt === maxRetries) throw error;

                lastError = error as Error;
                logger.warn(
                    { method, url, attempt, error: (error as Error).message },
                    "Retrying after error",
                );
                await new Promise((r) => setTimeout(r, delays[attempt]));
            }
        }

        // Should never reach here, but TypeScript needs it
        throw lastError!;
    }

    // ── Convenience Methods ──────────────────────────────────────────────

    protected get<T>(path: string, options?: RequestOptions | string): Promise<T> {
        return this.request<T>("GET", path, undefined, options);
    }

    protected post<T>(path: string, body: unknown, options?: RequestOptions | string): Promise<T> {
        return this.request<T>("POST", path, body, options);
    }

    protected put<T>(path: string, body: unknown, options?: RequestOptions | string): Promise<T> {
        return this.request<T>("PUT", path, body, options);
    }

    protected patch<T>(path: string, body: unknown, options?: RequestOptions | string): Promise<T> {
        return this.request<T>("PATCH", path, body, options);
    }

    protected del<T>(path: string, options?: RequestOptions | string): Promise<T> {
        return this.request<T>("DELETE", path, undefined, options);
    }
}
```

### Concrete Client Example: `OrderManagementClient`

```typescript
// modules/domain/billing/src/clients/order-management-client.ts

import { BaseServiceClient } from "@myorg/common";
import type { PropertyAssessmentDto, AssessmentHistoryDto } from "@myorg/contracts/order-management";
import { PropertyAssessmentSchema } from "@myorg/contracts/order-management";

export class OrderManagementClient extends BaseServiceClient {
    constructor() {
        super(process.env.ORDER_MANAGEMENT_URL ?? "http://localhost:3020");
    }

    /**
     * Get the current assessment for a property.
     * Validates the response against the contract schema.
     */
    async getPropertyAssessment(
        propertyId: string,
        correlationId?: string,
    ): Promise<PropertyAssessmentDto> {
        return this.get<PropertyAssessmentDto>(
            `/api/order-management/properties/${propertyId}/assessment`,
            {
                correlationId,
                responseSchema: PropertyAssessmentSchema,
            },
        );
    }

    /**
     * Get assessment history for a property (no schema validation — best effort).
     */
    async getAssessmentHistory(
        propertyId: string,
        correlationId?: string,
    ): Promise<AssessmentHistoryDto[]> {
        return this.get<AssessmentHistoryDto[]>(
            `/api/order-management/properties/${propertyId}/history`,
            correlationId, // String shorthand — just forwards the correlation ID
        );
    }

    /**
     * Submit a supplementary assessment with a longer timeout for processing.
     */
    async submitSupplementaryAssessment(
        propertyId: string,
        payload: unknown,
        correlationId?: string,
    ): Promise<{ id: string }> {
        return this.post<{ id: string }>(
            `/api/order-management/properties/${propertyId}/supplementary`,
            payload,
            {
                correlationId,
                timeout: 30_000, // Override: supplementary assessments may take longer
            },
        );
    }
}
```

### Concrete Client Example: `NotificationClient`

```typescript
// modules/domain/billing/src/clients/notification-client.ts

import { BaseServiceClient } from "@myorg/common";

interface SendNotificationPayload {
    templateId: string;
    recipientId: string;
    channel: "email" | "sms" | "push";
    variables: Record<string, string>;
}

export class NotificationClient extends BaseServiceClient {
    constructor() {
        super(process.env.NOTIFICATION_URL ?? "http://localhost:3050");
    }

    async sendNotification(
        payload: SendNotificationPayload,
        correlationId?: string,
    ): Promise<{ notificationId: string }> {
        return this.post<{ notificationId: string }>(
            "/api/notifications/send",
            payload,
            correlationId,
        );
    }
}
```

### Using a Concrete Client in a Service

```typescript
// modules/domain/billing/src/services/billing.service.ts

import { Injectable, Logger } from "@nestjs/common";
import { OrderManagementClient } from "../clients/order-management-client";
import { NotificationClient } from "../clients/notification-client";

@Injectable()
export class BillingService {
    private readonly logger = new Logger(BillingService.name);
    private readonly assessmentClient = new OrderManagementClient();
    private readonly notificationClient = new NotificationClient();

    async generateAndNotify(propertyId: string, ownerId: string, correlationId: string) {
        // 1. Fetch assessment data from Order Record service
        const assessment = await this.assessmentClient.getPropertyAssessment(
            propertyId,
            correlationId,
        );

        // 2. Calculate the bill (domain logic)
        const bill = this.calculateBill(assessment);

        // 3. Persist the bill (local repository)
        await this.billRepository.create(bill);

        // 4. Notify the owner via Notification service
        await this.notificationClient.sendNotification(
            {
                templateId: "bill-generated",
                recipientId: ownerId,
                channel: "email",
                variables: {
                    amount: bill.totalAmount.toFixed(2),
                    dueDate: bill.dueDate.toISOString(),
                    propertyAddress: assessment.address,
                },
            },
            correlationId,
        );

        this.logger.log(`Bill generated for property ${propertyId}: $${bill.totalAmount}`);
        return bill;
    }

    private calculateBill(assessment: any) {
        // ... domain logic
        return { totalAmount: 0, dueDate: new Date() };
    }
}
```
