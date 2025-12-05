# Shared Common Schemas

> Pattern documentation for the five shared schema modules in `packages/contracts/src/common/` that provide reusable building blocks for all entity contracts.

## 1. Component Pattern

The **Common Schemas** are a set of foundational Zod schemas and helper
functions that every entity contract imports. They live in
`packages/contracts/src/common/` and are re-exported through a single barrel
at `common/index.ts`. These schemas enforce consistent patterns for entity
identity, pagination, monetary values, addresses, and audit trails across the
entire platform.

## 2. Overview

| Module         | File            | Key Exports                                                                                               | Purpose                                          |
| -------------- | --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Base**       | `base.ts`       | `BaseEntitySchema`, `ErrorResponseSchema`, `SuccessResponseSchema()`                                      | Identity, timestamps, error/success envelopes    |
| **Pagination** | `pagination.ts` | `PaginationQuerySchema`, `PaginationMetaSchema`, `PaginatedResponseSchema()`                              | Standardized list endpoints with page/limit/sort |
| **Money**      | `money.ts`      | `MoneySchema`, `DEFAULT_CURRENCY`, `toMoney()`, `toMoneyOrNull()`, `centsToDecimal()`, `decimalToCents()` | Integer-cent monetary values with helpers        |
| **Address**    | `address.ts`    | `AddressSchema`                                                                                           | Canadian address with postal code validation     |
| **Audit**      | `audit.ts`      | `AuditableSchema`, `ApprovalRecordSchema`                                                                 | Audit trail and approval workflow fields         |

All five modules are exported from `common/index.ts`:

```typescript
export * from "./base";
export * from "./money";
export * from "./pagination";
export * from "./address";
export * from "./audit";
```

Consumers import via the top-level barrel:

```typescript
import { BaseEntitySchema, MoneySchema, PaginationQuerySchema } from "@myorg/contracts";
```

## 3. Rules

1. **Never import from deep paths.** Always use `@myorg/contracts` — never
   `@myorg/contracts/src/common/money`.
2. **Every new common schema must be added to `common/index.ts`.**
3. **Common schemas must be domain-agnostic.** If a schema is specific to one
   domain (e.g. `PropertyClassSchema`), it belongs in the entity contract, not
   in common.
4. **`MoneySchema` is mandatory for all monetary fields.** Raw cent integers
   must never appear in response schemas — they must be wrapped in `MoneySchema`.
5. **`PaginatedResponseSchema()` is a factory.** Call it with the item schema
   to produce a typed paginated response. Never hand-roll pagination metadata.
6. **`BaseEntitySchema` provides `id`, `createdAt`, `updatedAt`.** Use
   `.extend()` to add entity-specific fields on top.
7. **`z.coerce.number()` in `PaginationQuerySchema`** ensures string query
   params from URLs are safely coerced to numbers.
8. **`z.coerce.date()` is used for all date fields** to handle both string
   and Date inputs across API boundary.
9. **`DEFAULT_CURRENCY` is `'CAD'`** — all monetary helpers default to
   Canadian dollars.
10. **`AddressSchema` uses Ontario defaults** — province defaults to `"ON"`,
    country defaults to `"CA"`, postal code regex validates Canadian format.

## 4. Structure

```
packages/contracts/src/common/
├── index.ts          ← barrel re-exports all 5 modules
├── base.ts           ← BaseEntitySchema, ErrorResponseSchema, SuccessResponseSchema()
├── pagination.ts     ← PaginationQuerySchema, PaginationMetaSchema, PaginatedResponseSchema()
├── money.ts          ← MoneySchema, DEFAULT_CURRENCY, toMoney(), toMoneyOrNull(), conversion helpers
├── address.ts        ← AddressSchema (Canadian postal code regex)
└── audit.ts          ← AuditableSchema, ApprovalRecordSchema
```

## 5. Example Implementation

### base.ts — Entity Identity & Response Envelopes

```typescript
// packages/contracts/src/common/base.ts
import { z } from "zod";

// ─── Base Entity ────────────────────────────────────────────

export const BaseEntitySchema = z.object({
    id: z.string().uuid(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

// ─── Error Response ─────────────────────────────────────────

export const ErrorResponseSchema = z.object({
    statusCode: z.number().int(),
    message: z.string(),
    error: z.string().optional(),
    details: z
        .array(
            z.object({
                field: z.string(),
                message: z.string(),
            }),
        )
        .optional(),
    correlationId: z.string().uuid().optional(),
    timestamp: z.coerce.date(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ─── Success Envelope ───────────────────────────────────────

export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z.object({
        success: z.literal(true),
        data: dataSchema,
        meta: z.record(z.string(), z.unknown()).optional(),
    });
```

**Usage in entity contracts:**

```typescript
import { BaseEntitySchema } from "../../common/base";

// Extend BaseEntitySchema to inherit id, createdAt, updatedAt
export const ResourceResponseSchema = BaseEntitySchema.extend({
    name: z.string(),
    status: ResourceStatusSchema,
    description: z.string().nullable(),
});
```

### pagination.ts — List Endpoint Pagination

```typescript
// packages/contracts/src/common/pagination.ts
import { z } from "zod";

// ─── Pagination ─────────────────────────────────────────────

export const PaginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
    page: z.number().int(),
    limit: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

export function PaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
    return z.object({
        items: z.array(itemSchema),
        pagination: PaginationMetaSchema,
    });
}

// Generic paginated response type for frontend use
export interface PaginatedResponse<T> {
    items: T[];
    pagination: PaginationMeta;
}
```

**Usage in entity contracts:**

```typescript
import { PaginatedResponseSchema } from "../../common/pagination";

export const PropertyListResponseSchema = PaginatedResponseSchema(PropertyResponseSchema);
export type PropertyListResponse = z.infer<typeof PropertyListResponseSchema>;
```

**Resulting shape:**

```json
{
    "items": [{ "id": "...", "rollNumber": "...", ... }],
    "pagination": {
        "page": 1,
        "limit": 20,
        "totalItems": 142,
        "totalPages": 8,
        "hasNextPage": true,
        "hasPreviousPage": false
    }
}
```

### money.ts — Integer-Cent Monetary Values

````typescript
// packages/contracts/src/common/money.ts
import { z } from "zod";

// ─── Money Schema ───────────────────────────────────────────
// All monetary values stored as integer cents to avoid
// floating-point precision issues.

export const MoneySchema = z.object({
    /** Amount in integer cents (e.g., 123456 = $1,234.56) */
    amount: z.number().int(),
    /** ISO 4217 currency code (default: CAD) */
    currency: z.string().length(3).default("CAD"),
});

export type Money = z.infer<typeof MoneySchema>;

/** Default currency for all monetary values across my-services */
export const DEFAULT_CURRENCY = "CAD" as const;

// ─── Helpers ────────────────────────────────────────────────

export function centsToDecimal(cents: number): number {
    return cents / 100;
}

export function decimalToCents(decimal: number): number {
    return Math.round(decimal * 100);
}

/**
 * Convert a BigInt cents value from Prisma to a Money contract object.
 * Centralizes the BigInt → Number conversion + currency wrapping that
 * every `toResponse()` needs when returning monetary fields.
 *
 * @param cents  BigInt value from Prisma (e.g., `bill.totalLeviedCents`)
 * @param currency  ISO 4217 currency code (default: CAD)
 * @returns Money object conforming to MoneySchema
 *
 * @example
 * ```ts
 * // Before (manual, error-prone):
 * totalLevied: { amount: Number(bill.totalLeviedCents), currency: DEFAULT_CURRENCY }
 *
 * // After:
 * totalLevied: toMoney(bill.totalLeviedCents)
 * ```
 */
export function toMoney(cents: bigint | number, currency: string = DEFAULT_CURRENCY): Money {
    return {
        amount: typeof cents === "bigint" ? Number(cents) : cents,
        currency,
    };
}

/**
 * Convert a nullable BigInt cents value to a Money object or null.
 * Use for optional monetary fields that may be null in the database.
 */
export function toMoneyOrNull(
    cents: bigint | number | null | undefined,
    currency: string = DEFAULT_CURRENCY,
): Money | null {
    if (cents == null) return null;
    return toMoney(cents, currency);
}
````

**Usage in service `toResponse()` mappers:**

```typescript
import { toMoney, toMoneyOrNull } from "@myorg/contracts";

function toResponse(bill: TaxBillEntity): TaxBillResponse {
    return {
        ...bill,
        totalLevied: toMoney(bill.totalLeviedCents),
        totalPaid: toMoney(bill.totalPaidCents),
        balanceDue: toMoney(bill.totalLeviedCents - bill.totalPaidCents),
        penalty: toMoneyOrNull(bill.penaltyCents), // null if no penalty
    };
}
```

### address.ts — Canadian Address Schema

```typescript
// packages/contracts/src/common/address.ts
import { z } from "zod";

// ─── Ontario Address Format ─────────────────────────────────

export const AddressSchema = z.object({
    streetNumber: z.string(),
    streetName: z.string(),
    unit: z.string().nullish(),
    city: z.string(),
    province: z.string().length(2).default("ON"),
    postalCode: z.string().regex(/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, "Invalid Canadian postal code"),
    country: z.string().length(2).default("CA"),
});

export type Address = z.infer<typeof AddressSchema>;
```

**Validated postal codes:**

- `"K1A 0B1"` ✅ (with space)
- `"M5V2T6"` ✅ (without space)
- `"90210"` ❌ (US zip — rejected)

### audit.ts — Audit Trail & Approval Workflow

```typescript
// packages/contracts/src/common/audit.ts
import { z } from "zod";

// ─── Audit Trail ────────────────────────────────────────────

export const AuditableSchema = z.object({
    createdBy: z.string().uuid(),
    createdAt: z.coerce.date(),
    updatedBy: z.string().uuid().optional(),
    updatedAt: z.coerce.date().optional(),
});

export type Auditable = z.infer<typeof AuditableSchema>;

export const ApprovalRecordSchema = z.object({
    approvedBy: z.string().uuid(),
    approvedAt: z.coerce.date(),
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    comments: z.string().optional(),
});

export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;
```

**Usage in entity schemas that require audit fields:**

```typescript
import { AuditableSchema } from "../../common/audit";

export const LevyResponseSchema = z
    .object({
        id: z.string().uuid(),
        taxYear: z.number().int(),
        status: LevyStatusSchema,
        // ... domain fields
    })
    .merge(AuditableSchema);
// Result: includes createdBy, createdAt, updatedBy, updatedAt
```

### Barrel File

```typescript
// packages/contracts/src/common/index.ts
export * from "./base";
export * from "./money";
export * from "./pagination";
export * from "./address";
export * from "./audit";
```
