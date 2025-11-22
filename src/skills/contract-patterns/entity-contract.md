# Entity Contract (Zod-based API Contract)

> Pattern documentation for domain entity contract files that define the full API boundary — enums, parameters, request/response schemas, endpoint contracts, and database-facing entity schemas — all in a single Zod-first file.

## 1. Component Pattern

The **Entity Contract** is the single source of truth for one domain entity's
API surface. It lives in `packages/contracts/src/contracts/<domain>/<entity>.contract.ts`
and is consumed identically by the NestJS backend (validation, Swagger) and the
React frontend (typed API client, form schemas). Every entity contract follows a
strict **7-section structure** that keeps schemas co-located and discoverable.

## 2. Overview

| Section                         | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| **1. Enum Schemas**             | Domain enumerations as `z.enum()` — never native TS `enum`           |
| **2. Path Parameter Schemas**   | `z.object({ id: z.string().uuid() })` for URL params                 |
| **3. Query Parameter Schemas**  | Extends `PaginationQuerySchema` with domain-specific filters         |
| **4. Request Body Schemas**     | `CreateSchema` (all required fields) + `UpdateSchema` (`.partial()`) |
| **5. Response Schemas**         | Entity response, paginated response via `PaginatedResponseSchema()`  |
| **6. API Contracts**            | `defineEndpoint()` calls for list, getById, create, update, delete   |
| **7. Entity & FindManyOptions** | Prisma-facing schemas for the repository layer                       |

Both frontend and backend import from the same contract file via the
`@civic/contracts` package. The contract is the **only** place where field
names, types, validation rules, and API shapes are defined.

## 3. Rules

1. **One contract file per domain entity.** File naming: `<entity>.contract.ts`
   (kebab-case, singular or plural matching the domain noun).
2. **All 7 sections must appear in order.** Use the section-header comment
   format: `// ============================================` above and below
   the section title.
3. **Enum schemas use `z.enum()`, never native TypeScript `enum`.**
   Export the schema AND the inferred type:
    ```typescript
    export const StatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
    export type Status = z.infer<typeof StatusSchema>;
    ```
4. **Update body is always `CreateBody.partial()`.**
    ```typescript
    export const UpdateBodySchema = CreateBodySchema.partial();
    ```
5. **All BigInt / monetary values use `MoneySchema` from `../../common/money`.**
   Never expose raw cent integers in response schemas — wrap in `MoneySchema`.
6. **`PaginatedResponseSchema(itemSchema)` factory wraps the item schema.**
   Never hand-roll pagination metadata.
7. **Both frontend and backend import from the same contract.** No
   backend-only or frontend-only duplicates. The `@civic/contracts` barrel
   is the single import source.
8. **Type exports use `z.infer<typeof Schema>`.** Never maintain a parallel
   hand-written interface.
9. **Path param schemas are named `<Entity>IdParamsSchema`** (or
   `<Entity><AltKey>ParamsSchema` for non-id lookups).
10. **Query schemas use `z.coerce.number()` for page/limit** so string query
    params from the URL are safely coerced.
11. **API contracts are grouped into a single `const <Entity>Contract = { … } as const`** object.
    Each key is a verb-noun function name (e.g. `listProperties`, `getProperty`, `createProperty`).
12. **Tags array** in `defineEndpoint()` uses the domain area as the first tag
    (e.g. `["revenue", "assessment-roll"]`).
13. **Entity schemas (section 7) mirror the Prisma model exactly** — column
    names, nullable fields, date coercion. They are used by the repository
    layer for runtime validation of database results.
14. **`FindManyOptionsSchema` mirrors the repository's filter/sort/pagination
    parameters.** It includes `skip`, `take`, `where`, and `orderBy`.

## 4. Structure

```
packages/contracts/src/contracts/<domain>/<entity>.contract.ts
├── import { z } from "zod"
├── import { defineEndpoint } from "../base.types"
├── import { PaginatedResponseSchema } from "../../common/pagination"
├── import { MoneySchema } from "../../common/money"             // if monetary fields
├── import { AddressSchema } from "../../common/address"         // if address fields
├── import { BaseEntitySchema } from "../../common/base"         // optional
├── import { Routes } from "../routes"
│
├── // ═══ 1. Enum Schemas ═══
│   ├── export const <Entity>StatusSchema = z.enum([…])
│   ├── export type <Entity>Status = z.infer<typeof …>
│   ├── export const <Entity>TypeSchema = z.enum([…])
│   └── export type <Entity>Type = z.infer<typeof …>
│
├── // ═══ 2. Path Parameters ═══
│   ├── export const <Entity>IdParamsSchema = z.object({ id: z.string().uuid() })
│   └── export type <Entity>IdParams = z.infer<typeof …>
│
├── // ═══ 3. Query Parameters ═══
│   ├── export const <Entity>QuerySchema = z.object({ page, limit, search, …domain filters })
│   └── export type <Entity>Query = z.infer<typeof …>
│
├── // ═══ 4. Request Bodies ═══
│   ├── export const Create<Entity>BodySchema = z.object({ … })
│   ├── export type Create<Entity>Body = z.infer<typeof …>
│   ├── export const Update<Entity>BodySchema = Create<Entity>BodySchema.partial()
│   └── export type Update<Entity>Body = z.infer<typeof …>
│
├── // ═══ 5. Response Schemas ═══
│   ├── export const <Entity>ResponseSchema = z.object({ … })
│   ├── export type <Entity>Response = z.infer<typeof …>
│   ├── export const <Entity>ListResponseSchema = PaginatedResponseSchema(<Entity>ResponseSchema)
│   └── export type <Entity>ListResponse = z.infer<typeof …>
│
├── // ═══ 6. API Contract Definition ═══
│   ├── export const <Entity>Contract = {
│   │       list<Entities>:   defineEndpoint({ method: "GET",  path: Routes.<entities>, … }),
│   │       get<Entity>:      defineEndpoint({ method: "GET",  path: `${Routes.<entities>}/:id`, … }),
│   │       create<Entity>:   defineEndpoint({ method: "POST", path: Routes.<entities>, … }),
│   │       update<Entity>:   defineEndpoint({ method: "PUT",  path: `${Routes.<entities>}/:id`, … }),
│   │       delete<Entity>:   defineEndpoint({ method: "DELETE", path: `${Routes.<entities>}/:id`, … }),
│   │   } as const
│   └── export type <Entity>ContractType = typeof <Entity>Contract
│
└── // ═══ 7. Entity Model Schemas (Database Layer) ═══
    ├── export const <Entity>EntitySchema = z.object({ … all DB columns … })
    ├── export type <Entity>Entity = z.infer<typeof …>
    ├── export const <Entity>FindManyOptionsSchema = z.object({ skip, take, where, orderBy, …filters })
    └── export type <Entity>FindManyOptions = z.infer<typeof …>
```

## 5. Example Implementation

```typescript
// packages/contracts/src/contracts/revenue/property.contract.ts
import { z } from "zod";
import { defineEndpoint } from "../base.types";
import { PaginatedResponseSchema } from "../../common/pagination";
import { AddressSchema } from "../../common/address";
import { Routes } from "../routes";

// ============================================
// 1. Enum Schemas
// ============================================

export const PropertyClassSchema = z.enum([
    "RESIDENTIAL",
    "MULTI_RESIDENTIAL",
    "COMMERCIAL",
    "INDUSTRIAL",
    "PIPELINE",
    "FARM",
    "MANAGED_FOREST",
    "NEW_CONSTRUCTION_RES",
    "NEW_CONSTRUCTION_NON_RES",
]);
export type PropertyClass = z.infer<typeof PropertyClassSchema>;

export const SchoolSupportSchema = z.enum([
    "PUBLIC",
    "SEPARATE",
    "FRENCH_PUBLIC",
    "FRENCH_SEPARATE",
]);
export type SchoolSupport = z.infer<typeof SchoolSupportSchema>;

// ── PropertyStatus enum (mirrors Prisma PropertyStatus) ────
export const PropertyStatusValues = ["ACTIVE", "INACTIVE", "EXEMPT", "DEMOLISHED"] as const;
export const PropertyStatusSchema = z.enum(PropertyStatusValues);
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

// ============================================
// 2. Path Parameters
// ============================================

export const PropertyIdParamsSchema = z.object({
    id: z.string().uuid(),
});
export type PropertyIdParams = z.infer<typeof PropertyIdParamsSchema>;

export const PropertyRollNumberParamsSchema = z.object({
    rollNumber: z.string(),
});
export type PropertyRollNumberParams = z.infer<typeof PropertyRollNumberParamsSchema>;

// ============================================
// 3. Query Parameters
// ============================================

export const PropertyQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    rollNumber: z.string().optional(),
    ward: z.string().optional(),
    propertyClass: PropertyClassSchema.optional(),
    ownerName: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
    search: z.string().optional(),
});
export type PropertyQuery = z.infer<typeof PropertyQuerySchema>;

// ============================================
// 4. Request Bodies
// ============================================

export const CreatePropertyBodySchema = z.object({
    rollNumber: z.string().min(1),
    address: AddressSchema,
    propertyClass: PropertyClassSchema,
    schoolSupport: SchoolSupportSchema,
    frontage: z.number().optional(),
    depth: z.number().optional(),
    acreage: z.number().optional(),
    lot: z.string().optional(),
    plan: z.string().optional(),
    ward: z.string().optional(),
    zoning: z.string().optional(),
});
export type CreatePropertyBody = z.infer<typeof CreatePropertyBodySchema>;

export const UpdatePropertyBodySchema = CreatePropertyBodySchema.partial();
export type UpdatePropertyBody = z.infer<typeof UpdatePropertyBodySchema>;

// ============================================
// 5. Response Schemas
// ============================================

export const PropertyResponseSchema = z.object({
    id: z.string().uuid(),
    rollNumber: z.string(),
    address: AddressSchema,
    propertyClass: PropertyClassSchema,
    schoolSupport: SchoolSupportSchema,
    frontage: z.number().nullable(),
    depth: z.number().nullable(),
    acreage: z.number().nullable(),
    lot: z.string().nullable(),
    plan: z.string().nullable(),
    ward: z.string().nullable(),
    zoning: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    // Assessment and owner data for downstream billing consumers
    latestAssessment: z
        .object({
            assessmentYear: z.number(),
            currentValueCents: z.number(),
            phasedInValueCents: z.number(),
        })
        .nullable()
        .optional(),
    primaryOwner: z
        .object({
            name: z.string(),
            mailingAddress: z.string(),
        })
        .nullable()
        .optional(),
});
export type PropertyResponse = z.infer<typeof PropertyResponseSchema>;

export const PropertyListResponseSchema = PaginatedResponseSchema(PropertyResponseSchema);
export type PropertyListResponse = z.infer<typeof PropertyListResponseSchema>;

// ============================================
// 6. API Contract Definition
// ============================================

export const PropertyContract = {
    listProperties: defineEndpoint({
        method: "GET",
        path: Routes.properties,
        query: PropertyQuerySchema,
        response: PropertyListResponseSchema,
        summary: "List properties with pagination and filters",
        tags: ["revenue", "assessment-roll"],
    }),
    getProperty: defineEndpoint({
        method: "GET",
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        response: PropertyResponseSchema,
        summary: "Get property by ID",
        tags: ["revenue", "assessment-roll"],
    }),
    createProperty: defineEndpoint({
        method: "POST",
        path: Routes.properties,
        body: CreatePropertyBodySchema,
        response: PropertyResponseSchema,
        summary: "Create a new property",
        tags: ["revenue", "assessment-roll"],
    }),
    updateProperty: defineEndpoint({
        method: "PUT",
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        body: UpdatePropertyBodySchema,
        response: PropertyResponseSchema,
        summary: "Update an existing property",
        tags: ["revenue", "assessment-roll"],
    }),
    deleteProperty: defineEndpoint({
        method: "DELETE",
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        response: z.object({ success: z.literal(true) }),
        summary: "Delete a property",
        tags: ["revenue", "assessment-roll"],
    }),
} as const;

export type PropertyContractType = typeof PropertyContract;

// ============================================
// 7. Entity Model Schemas (Database Layer)
// ============================================

export const PropertyEntitySchema = z.object({
    id: z.string().uuid(),
    rollNumber: z.string(),
    streetNumber: z.string(),
    streetName: z.string(),
    unit: z.string().nullable(),
    city: z.string(),
    province: z.string(),
    postalCode: z.string(),
    country: z.string(),
    propertyClass: PropertyClassSchema,
    schoolSupport: SchoolSupportSchema,
    frontage: z.number().nullable(),
    depth: z.number().nullable(),
    acreage: z.number().nullable(),
    lot: z.string().nullable(),
    plan: z.string().nullable(),
    ward: z.string().nullable(),
    zoning: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});
export type PropertyEntity = z.infer<typeof PropertyEntitySchema>;

export const PropertyFindManyOptionsSchema = z.object({
    rollNumber: z.string().optional(),
    ward: z.string().optional(),
    propertyClass: z.string().optional(),
    ownerName: z.string().optional(),
    skip: z.number().int(),
    take: z.number().int(),
    where: z.record(z.string(), z.unknown()).optional(),
    orderBy: z.record(z.string(), z.enum(["asc", "desc"])).optional(),
});
export type PropertyFindManyOptions = z.infer<typeof PropertyFindManyOptionsSchema>;
```

### Monetary Field Example (Tax Bill Contract)

When an entity has monetary fields, use `MoneySchema` in responses and
`z.number().int()` (cents) in entity schemas:

```typescript
// packages/contracts/src/contracts/revenue/tax-bills.contract.ts
import { z } from "zod";
import { defineEndpoint } from "../base.types";
import { PaginatedResponseSchema } from "../../common/pagination";
import { MoneySchema } from "../../common/money";
import { Routes } from "../routes";

// ============================================
// 1. Enum Schemas
// ============================================

export const TaxBillTypeSchema = z.enum(["INTERIM", "FINAL", "SUPPLEMENTARY"]);
export type TaxBillType = z.infer<typeof TaxBillTypeSchema>;

export const TaxBillStatusSchema = z.enum([
    "DRAFT",
    "GENERATED",
    "MAILED",
    "PAID",
    "OVERDUE",
    "CANCELLED",
]);
export type TaxBillStatus = z.infer<typeof TaxBillStatusSchema>;

// ============================================
// 2. Path Parameters
// ============================================

export const TaxBillIdParamsSchema = z.object({
    id: z.string().uuid(),
});
export type TaxBillIdParams = z.infer<typeof TaxBillIdParamsSchema>;

// ============================================
// 3. Query Parameters
// ============================================

export const TaxBillQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    rollNumber: z.string().optional(),
    taxYear: z.coerce.number().int().optional(),
    billType: TaxBillTypeSchema.optional(),
    status: TaxBillStatusSchema.optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
});
export type TaxBillQuery = z.infer<typeof TaxBillQuerySchema>;

// ============================================
// 4. Request Bodies
// ============================================

export const CreateTaxBillBodySchema = z.object({
    rollNumber: z.string().min(1),
    taxYear: z.number().int(),
    billType: TaxBillTypeSchema,
    dueDateInterim: z.coerce.date(),
    dueDateFinal: z.coerce.date(),
    totalLeviedCents: z.number().int(),
});
export type CreateTaxBillBody = z.infer<typeof CreateTaxBillBodySchema>;

export const UpdateTaxBillBodySchema = CreateTaxBillBodySchema.partial();
export type UpdateTaxBillBody = z.infer<typeof UpdateTaxBillBodySchema>;

// ============================================
// 5. Response Schemas
// ============================================

export const TaxBillResponseSchema = z.object({
    id: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    billType: TaxBillTypeSchema,
    status: TaxBillStatusSchema,
    totalLevied: MoneySchema, // ← MoneySchema for monetary values
    totalPaid: MoneySchema,
    balanceDue: MoneySchema,
    dueDateInterim: z.coerce.date(),
    dueDateFinal: z.coerce.date(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});
export type TaxBillResponse = z.infer<typeof TaxBillResponseSchema>;

export const TaxBillListResponseSchema = PaginatedResponseSchema(TaxBillResponseSchema);
export type TaxBillListResponse = z.infer<typeof TaxBillListResponseSchema>;

// ============================================
// 6. API Contract Definition
// ============================================

export const TaxBillContract = {
    listTaxBills: defineEndpoint({
        method: "GET",
        path: Routes.taxBills,
        query: TaxBillQuerySchema,
        response: TaxBillListResponseSchema,
        summary: "List tax bills with pagination and filters",
        tags: ["revenue", "billing"],
    }),
    getTaxBill: defineEndpoint({
        method: "GET",
        path: `${Routes.taxBills}/:id`,
        params: TaxBillIdParamsSchema,
        response: TaxBillResponseSchema,
        summary: "Get tax bill by ID",
        tags: ["revenue", "billing"],
    }),
    createTaxBill: defineEndpoint({
        method: "POST",
        path: Routes.taxBills,
        body: CreateTaxBillBodySchema,
        response: TaxBillResponseSchema,
        summary: "Generate a new tax bill",
        tags: ["revenue", "billing"],
    }),
    updateTaxBill: defineEndpoint({
        method: "PUT",
        path: `${Routes.taxBills}/:id`,
        params: TaxBillIdParamsSchema,
        body: UpdateTaxBillBodySchema,
        response: TaxBillResponseSchema,
        summary: "Update an existing tax bill",
        tags: ["revenue", "billing"],
    }),
} as const;

export type TaxBillContractType = typeof TaxBillContract;

// ============================================
// 7. Entity Model Schemas (Database Layer)
// ============================================

// Note: BigInt cents columns stored as-is; service layer converts via toMoney()
export const TaxBillEntitySchema = z.object({
    id: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    billType: TaxBillTypeSchema,
    status: TaxBillStatusSchema,
    totalLeviedCents: z.bigint(), // ← BigInt in DB, converted via toMoney()
    totalPaidCents: z.bigint(),
    penaltyCents: z.bigint(),
    dueDateInterim: z.coerce.date(),
    dueDateFinal: z.coerce.date(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});
export type TaxBillEntity = z.infer<typeof TaxBillEntitySchema>;

export const TaxBillFindManyOptionsSchema = z.object({
    rollNumber: z.string().optional(),
    taxYear: z.number().int().optional(),
    billType: TaxBillTypeSchema.optional(),
    status: TaxBillStatusSchema.optional(),
    skip: z.number().int(),
    take: z.number().int(),
    where: z.record(z.string(), z.unknown()).optional(),
    orderBy: z.record(z.string(), z.enum(["asc", "desc"])).optional(),
});
export type TaxBillFindManyOptions = z.infer<typeof TaxBillFindManyOptionsSchema>;
```
