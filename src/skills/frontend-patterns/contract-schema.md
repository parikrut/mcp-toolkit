# Contract Schema

> Pattern documentation for Zod-based API contracts shared between frontend and backend.

## 1. Component Pattern

A **Contract Schema** file defines the complete API surface for a domain entity
using Zod schemas. It is the single source of truth for enums, query parameters,
request bodies, response shapes, and endpoint definitions — shared between
frontend and backend via the `@civic/contracts` package.

## 2. Overview

Each contract file lives in `packages/contracts/src/contracts/<module>/` and
follows a numbered section layout:

| Section | Contents                                                    |
| ------- | ----------------------------------------------------------- |
| 1       | **Enum schemas** — Zod `z.enum()` + inferred types          |
| 2       | **Path parameters** — `z.object({ id: z.string().uuid() })` |
| 3       | **Query parameters** — pagination, filters, sort            |
| 4       | **Request bodies** — create + update (partial)              |
| 5       | **Response schemas** — single entity + paginated list       |
| 6       | **API contract definition** — route metadata                |
| 7       | **Entity model** — database-layer shapes (optional)         |

Re-exports flow through barrels:
`contracts/<module>/index.ts` → `contracts/index.ts` → package root `index.ts`.

## 3. Rules

1. **Zod is the only schema library.** No `yup`, `io-ts`, or manual
   type guards.
2. **Every schema exports a companion type** via `z.infer<typeof Schema>`.
3. **Enums mirror Prisma enums exactly.** The Zod `z.enum()` values must
   match the Prisma model enum values 1-to-1.
4. **Query schemas use `z.coerce.number()`** for page/limit so string query
   params are parsed correctly.
5. **Create body → Update body** follows the `partial()` pattern:
   `UpdateBodySchema = CreateBodySchema.partial()`.
6. **Response schemas include timestamps** (`createdAt`, `updatedAt`) as
   `z.coerce.date()` to handle ISO string → Date conversion.
7. **Paginated responses** use the shared `PaginatedResponseSchema(itemSchema)`
   factory from `common/pagination`.
8. **`Routes` object** provides the base path constants used by both the
   API contract and the frontend hooks.
9. **No runtime logic.** Contract files are pure schema + type definitions.

## 4. Structure

```
packages/contracts/src/contracts/<module>/<domain>.contract.ts
├── // 1. Enum Schemas
│   export const <Enum>Schema = z.enum([…])
│   export type <Enum> = z.infer<typeof <Enum>Schema>
│
├── // 2. Path Parameters
│   export const <Domain>IdParamsSchema = z.object({ id: z.string().uuid() })
│
├── // 3. Query Parameters
│   export const <Domain>QuerySchema = z.object({
│       page: z.coerce.number().int().min(1).optional(),
│       limit: z.coerce.number().int().min(1).max(100).optional(),
│       <filter>: z.string().optional(),
│       <enumFilter>: <EnumSchema>.optional(),
│   })
│
├── // 4. Request Bodies
│   export const Create<Domain>BodySchema = z.object({ … })
│   export const Update<Domain>BodySchema = Create<Domain>BodySchema.partial()
│
├── // 5. Response Schemas
│   export const <Domain>ResponseSchema = z.object({ id, …, createdAt, updatedAt })
│   export const <Domain>ListResponseSchema = PaginatedResponseSchema(<Domain>ResponseSchema)
│
├── // 6. API Contract
│   export const <Domain>Contract = { list, get, create, update }
│
└── // 7. Entity Model (optional)
    export const <Domain>EntitySchema = z.object({ … })
```

**Re-export Chain:**

```
<domain>.contract.ts
  └── <module>/index.ts      (export * from "./<domain>.contract")
        └── contracts/index.ts  (export * from "./<module>")
              └── src/index.ts    (export * from "./contracts")
```

## 5. Example Implementation

```tsx
// packages/contracts/src/contracts/revenue/property.contract.ts
import { z } from "zod";
import { PaginatedResponseSchema } from "../../common/pagination";
import { AddressSchema } from "../../common/address";
import { Routes } from "../routes";

// ── 1. Enum Schemas ─────────────────────────────────────────

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

export const PropertyStatusSchema = z.enum(["ACTIVE", "INACTIVE", "EXEMPT", "DEMOLISHED"]);
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

// ── 2. Path Parameters ──────────────────────────────────────

export const PropertyIdParamsSchema = z.object({
    id: z.string().uuid(),
});
export type PropertyIdParams = z.infer<typeof PropertyIdParamsSchema>;

// ── 3. Query Parameters ─────────────────────────────────────

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

// ── 4. Request Bodies ───────────────────────────────────────

export const CreatePropertyBodySchema = z.object({
    rollNumber: z.string().min(1),
    address: AddressSchema,
    propertyClass: PropertyClassSchema,
    frontage: z.number().optional(),
    depth: z.number().optional(),
    ward: z.string().optional(),
    zoning: z.string().optional(),
});
export type CreatePropertyBody = z.infer<typeof CreatePropertyBodySchema>;

export const UpdatePropertyBodySchema = CreatePropertyBodySchema.partial();
export type UpdatePropertyBody = z.infer<typeof UpdatePropertyBodySchema>;

// ── 5. Response Schemas ─────────────────────────────────────

export const PropertyResponseSchema = z.object({
    id: z.string().uuid(),
    rollNumber: z.string(),
    address: AddressSchema,
    propertyClass: PropertyClassSchema,
    frontage: z.number().nullable(),
    depth: z.number().nullable(),
    ward: z.string().nullable(),
    zoning: z.string().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    latestAssessment: z
        .object({
            assessmentYear: z.number(),
            currentValueCents: z.number(),
            phasedInValueCents: z.number(),
        })
        .nullable()
        .optional(),
});
export type PropertyResponse = z.infer<typeof PropertyResponseSchema>;

export const PropertyListResponseSchema = PaginatedResponseSchema(PropertyResponseSchema);
export type PropertyListResponse = z.infer<typeof PropertyListResponseSchema>;

// ── 6. API Contract ─────────────────────────────────────────

export const PropertyContract = {
    listProperties: {
        method: "GET" as const,
        path: Routes.properties,
        query: PropertyQuerySchema,
        response: PropertyListResponseSchema,
        summary: "List properties with pagination and filters",
    },
    getProperty: {
        method: "GET" as const,
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        response: PropertyResponseSchema,
        summary: "Get property by ID",
    },
    createProperty: {
        method: "POST" as const,
        path: Routes.properties,
        body: CreatePropertyBodySchema,
        response: PropertyResponseSchema,
        summary: "Create a new property",
    },
};
```
