# Internal Service-to-Service HTTP Client

## 1. Component Pattern

**Type:** Utility Function  
**Location:** `packages/common/src/service-client.ts`  
**Consumers:** All concrete service clients (e.g., `AssessmentRollClient`, `BillingClient`, `PaymentClient`)

This pattern defines the `createInternalHeaders()` function used by every cross-service HTTP call in the platform. It generates short-lived JWT credentials and correlation headers so that downstream services can authenticate and trace requests originating from other internal services.

---

## 2. Overview

When one microservice calls another (e.g., the Billing service calling Assessment Roll to fetch property data), the caller must prove it is a trusted internal service — not an external user or rogue actor. The platform solves this with **short-lived service account JWTs**.

`createInternalHeaders(correlationId?)` is a pure function that:

1. **Signs a JWT** with a hard-coded service account identity (`SERVICE_ACCOUNT` role, `service@internal` email, a nil UUID for `userId`).
2. **Sets a very short TTL** (30 seconds) so tokens cannot be replayed outside the immediate request window.
3. **Attaches an `X-Correlation-Id`** header — either the one forwarded from the upstream request, or a freshly generated UUID — enabling distributed tracing across the entire call chain.
4. **Sets `Content-Type: application/json`** as all inter-service payloads are JSON.

Every concrete service client (see `base-service-client.md`) calls this function before dispatching each HTTP request. No service client should ever construct its own auth headers manually.

### Key Characteristics

| Aspect             | Detail                                            |
| ------------------ | ------------------------------------------------- |
| JWT lifetime       | 30 seconds                                        |
| JWT role           | `SERVICE_ACCOUNT`                                 |
| JWT userId         | `00000000-0000-0000-0000-000000000000` (nil UUID) |
| JWT email          | `service@internal`                                |
| JWT municipalityId | `internal`                                        |
| Signing secret     | `process.env.JWT_SECRET`                          |
| Correlation ID     | Forwarded if provided, otherwise `uuidv4()`       |
| Content-Type       | `application/json`                                |

### Why 30-Second Tokens?

- **Minimises replay window:** Even if a token is logged or intercepted, it expires almost immediately.
- **No refresh needed:** Each outbound request mints a fresh token; there is no token cache or refresh flow.
- **Clock tolerance:** 30 seconds is long enough to tolerate minor clock skew between containers while remaining short-lived.

### Correlation ID Propagation

The `X-Correlation-Id` header is the backbone of distributed tracing in the platform. When a user request enters the system, the API gateway or the first service generates a correlation ID. Every subsequent inter-service call **must** forward that same ID so that log aggregation tools (e.g., Loki, Datadog) can reconstruct the full request chain.

If `createInternalHeaders()` is called without a `correlationId` argument (e.g., from a CRON job or event handler that has no upstream request), it generates a new UUID automatically.

---

## 3. Rules

1. **Always use `createInternalHeaders()`** — never manually construct `Authorization` headers for service-to-service calls.
2. **Always forward the correlation ID** when one is available from the incoming request context. Pass it as the `correlationId` parameter.
3. **Never cache or reuse the returned headers object** across multiple requests. Each call to `createInternalHeaders()` mints a fresh JWT. Headers are valid for one request only.
4. **`JWT_SECRET` must be set** in every service's environment. If it is missing, `jwt.sign()` will throw at runtime.
5. **Do not modify the service account payload.** The `userId`, `email`, `role`, `municipalityId`, and `name` fields are hard-coded and must remain consistent across all services so that downstream authorization guards recognize the `SERVICE_ACCOUNT` role.
6. **Do not extend the JWT TTL** beyond 30 seconds. Short-lived tokens are a deliberate security boundary.
7. **This function is synchronous** — `jwt.sign()` with HMAC (HS256 default) is CPU-bound but fast. Do not wrap it in a Promise unnecessarily.
8. **Import from `@civic/common`** — the function is re-exported from the common package barrel. Never duplicate it into individual modules.
9. **Guard clauses in downstream services** should check for `role === "SERVICE_ACCOUNT"` to distinguish internal calls from user-initiated requests when applying authorization policies.
10. **Logging:** Do not log the full token value. Log the correlation ID for traceability.

---

## 4. Structure

```
packages/common/src/
├── service-client.ts          # createInternalHeaders() — THIS FILE
├── base-service-client.ts     # BaseServiceClient abstract class (see base-service-client.md)
├── envelope.ts                # unwrapEnvelope() (see response-envelope.md)
└── index.ts                   # Barrel re-exports

modules/domain/<module>/src/clients/
├── <downstream>-client.ts     # Concrete client extending BaseServiceClient
└── index.ts                   # Client barrel

# Usage flow:
#   ConcreteClient.get("/path", correlationId)
#     → BaseServiceClient.request("GET", "/path", undefined, { correlationId })
#       → createInternalHeaders(correlationId)   ← THIS FUNCTION
#       → fetch(url, { headers })
#       → unwrapEnvelope(json)
```

### Function Signature

```typescript
/**
 * Creates HTTP headers for internal service-to-service communication.
 *
 * @param correlationId - Optional correlation ID to propagate through the call chain.
 *                        If omitted, a new UUIDv4 is generated.
 * @returns A plain object containing Authorization, Content-Type, and X-Correlation-Id headers.
 */
export function createInternalHeaders(correlationId?: string): Record<string, string>;
```

### Header Output Shape

```json
{
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIs...",
    "Content-Type": "application/json",
    "X-Correlation-Id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

### JWT Payload (Decoded)

```json
{
    "userId": "00000000-0000-0000-0000-000000000000",
    "email": "service@internal",
    "role": "SERVICE_ACCOUNT",
    "municipalityId": "internal",
    "name": "Internal Service",
    "iat": 1740000000,
    "exp": 1740000030
}
```

---

## 5. Example Implementation

### The `createInternalHeaders` Function

```typescript
// packages/common/src/service-client.ts

import * as jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

/**
 * Creates authenticated headers for internal service-to-service HTTP calls.
 *
 * - Mints a short-lived (30s) JWT with the SERVICE_ACCOUNT role.
 * - Attaches an X-Correlation-Id for distributed tracing.
 * - Sets Content-Type to application/json.
 *
 * @param correlationId - Upstream correlation ID to propagate, or undefined to generate a new one.
 * @returns Headers object ready to pass to fetch().
 */
export function createInternalHeaders(correlationId?: string): Record<string, string> {
    const token = jwt.sign(
        {
            userId: "00000000-0000-0000-0000-000000000000",
            email: "service@internal",
            role: "SERVICE_ACCOUNT",
            municipalityId: "internal",
            name: "Internal Service",
        },
        process.env.JWT_SECRET!,
        { expiresIn: "30s" },
    );

    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId ?? uuidv4(),
    };
}
```

### Usage in a Concrete Service Client

```typescript
// modules/domain/billing/src/clients/assessment-roll-client.ts

import { BaseServiceClient } from "@civic/common";
import type { PropertyAssessment } from "@civic/contracts/assessment-roll";

export class AssessmentRollClient extends BaseServiceClient {
    constructor() {
        // Base URL from environment — each downstream service has its own env var
        super(process.env.ASSESSMENT_ROLL_URL ?? "http://localhost:3020");
    }

    /**
     * Fetches the current assessment for a property.
     * The correlationId is forwarded so the Assessment Roll service
     * can trace this call back to the original user request.
     */
    async getPropertyAssessment(
        propertyId: string,
        correlationId?: string,
    ): Promise<PropertyAssessment> {
        return this.get<PropertyAssessment>(
            `/api/assessment-roll/properties/${propertyId}/assessment`,
            correlationId,
        );
    }
}
```

### Usage in a Service Layer (Forwarding Correlation ID)

```typescript
// modules/domain/billing/src/services/billing.service.ts

import { Injectable } from "@nestjs/common";
import { AssessmentRollClient } from "../clients/assessment-roll-client";

@Injectable()
export class BillingService {
    private readonly assessmentClient = new AssessmentRollClient();

    async generateBill(propertyId: string, correlationId: string) {
        // The correlation ID from the incoming HTTP request is forwarded
        // through the service client → createInternalHeaders → downstream service
        const assessment = await this.assessmentClient.getPropertyAssessment(
            propertyId,
            correlationId,
        );

        // ... use assessment data to compute the bill
    }
}
```

### How Downstream Services Recognise Internal Calls

```typescript
// Typical guard or middleware in the downstream service

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

@Injectable()
export class InternalOrAuthenticatedGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user; // Populated by JWT strategy

        // SERVICE_ACCOUNT role bypasses normal user authorization
        if (user?.role === "SERVICE_ACCOUNT") {
            return true;
        }

        // Otherwise, apply normal user-level authorization
        return !!user?.userId;
    }
}
```
