# API Endpoint Contract Definition

> Pattern documentation for the `defineEndpoint()` function and the `EndpointContract` interface that create typed API contracts consumed by backend, frontend, Swagger, and CI.

## 1. Component Pattern

The **API Endpoint Contract Definition** is a type-safe factory function
(`defineEndpoint()`) and its backing interface (`EndpointContract`) that
live in `packages/contracts/src/contracts/base.types.ts`. Every API route
in the system is declared via `defineEndpoint()`, which produces a typed
contract object consumed by four distinct systems:

1. **Backend controllers** — request/response validation via `nestjs-zod`
2. **Swagger auto-generation** — OpenAPI docs derived from Zod schemas
3. **Frontend typed API client** — `createTypedApi()` reads the contract to
   produce a fully-typed fetch wrapper
4. **CI backward-compatibility checks** — contract diffs detect breaking changes

## 2. Overview

| Concept                   | Description                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **`EndpointContract`**    | Generic interface parameterized by `TMethod`, `TParams`, `TQuery`, `TBody`, `TResponse`               |
| **`defineEndpoint()`**    | Identity function that narrows the generic and returns the same object, providing full type inference |
| **Method**                | HTTP method: `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`                                        |
| **Path**                  | Route string from the centralized `Routes` object (e.g., `Routes.properties`)                         |
| **Params**                | Zod schema for URL path parameters (`:id`, `:rollNumber`)                                             |
| **Query**                 | Zod schema for query string parameters (page, limit, filters)                                         |
| **Body**                  | Zod schema for request body (POST/PUT/PATCH only)                                                     |
| **Response**              | Zod schema for the success response body                                                              |
| **Summary / Description** | Human-readable strings for Swagger documentation                                                      |
| **Tags**                  | String array for Swagger tag grouping                                                                 |

The `defineEndpoint()` function is an **identity function** — it returns
exactly the object passed in. Its sole purpose is to provide TypeScript
with enough type information to infer all generics, enabling downstream
consumers to extract param/query/body/response types from the contract.

## 3. Rules

1. **All Zod schemas passed to `defineEndpoint()` must be `z.ZodTypeAny`.**
   This includes `z.object()`, `z.array()`, `z.enum()`, etc.
2. **`params` is optional.** Only needed when the route has path parameters
   (e.g., `/:id`). Omit for collection-level routes like `GET /properties`.
3. **`query` is optional.** Typically present on `GET` list endpoints. Omit
   when there are no query parameters.
4. **`body` is optional.** Only present on `POST`, `PUT`, and `PATCH`
   endpoints. Never set on `GET` or `DELETE`.
5. **`response` is required.** Every endpoint must declare its response schema.
6. **`summary` is required.** Short one-line description for Swagger UI.
7. **`description` is optional.** Longer multi-line description.
8. **`tags` is required.** Array of strings for Swagger grouping. First tag
   is the domain area (e.g., `"revenue"`), second is the sub-domain
   (e.g., `"billing"`).
9. **`path` uses route constants from `Routes`.** Never hardcode path strings.
   Use template literals for parameterized paths:
    ```typescript
    path: `${Routes.properties}/:id`;
    ```
10. **Contracts are grouped into a `const` object per entity,** not exported
    individually. This keeps Swagger grouping clean and enables contract-level
    type exports:
    ```typescript
    export const PropertyContract = { listProperties: …, getProperty: … } as const;
    export type PropertyContractType = typeof PropertyContract;
    ```
11. **The deprecated `EndpointDefinition` alias exists for backward
    compatibility** but new code must use `EndpointContract`.

## 4. Structure

```
packages/contracts/src/contracts/base.types.ts
├── import { z } from "zod"
│
├── export interface EndpointContract<TMethod, TParams, TQuery, TBody, TResponse>
│   ├── method: TMethod                         // "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
│   ├── path: string                            // Route from Routes constant
│   ├── params?: TParams                        // z.ZodTypeAny — URL path params
│   ├── query?: TQuery                          // z.ZodTypeAny — query string params
│   ├── body?: TBody                            // z.ZodTypeAny — request body
│   ├── response: TResponse                     // z.ZodTypeAny — response body
│   ├── summary: string                         // Swagger summary
│   ├── description?: string                    // Swagger description (optional)
│   └── tags: string[]                          // Swagger tags
│
├── /** @deprecated */ export type EndpointDefinition = EndpointContract
│
└── export function defineEndpoint<TMethod, TParams, TQuery, TBody, TResponse>(
        definition: EndpointContract<…>
    ): EndpointContract<…>
```

**Consumer architecture:**

```
                  ┌─────────────────────┐
                  │  defineEndpoint()    │
                  │  (base.types.ts)     │
                  └──────────┬──────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼────────┐  ┌───▼────────┐  ┌───▼──────────────┐
   │  NestJS Backend  │  │  Frontend   │  │  Swagger / CI    │
   │  Controller uses │  │  API client │  │  OpenAPI gen +   │
   │  schemas for     │  │  reads      │  │  backward-compat │
   │  validation      │  │  contract   │  │  checks          │
   └─────────────────┘  └────────────┘  └──────────────────┘
```

## 5. Example Implementation

### base.types.ts — Full Source

```typescript
// packages/contracts/src/contracts/base.types.ts
import { z } from "zod";

// ─── Endpoint Contract Helper ───────────────────────────────
// defineEndpoint() creates a typed contract for a single API endpoint.
// These contracts are used by:
//   1. Backend controllers for request/response validation
//   2. Swagger auto-generation via nestjs-zod
//   3. Frontend typed API client via createTypedApi()
//   4. CI backward-compatibility checks

export interface EndpointContract<
    TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    TParams extends z.ZodTypeAny = z.ZodTypeAny,
    TQuery extends z.ZodTypeAny = z.ZodTypeAny,
    TBody extends z.ZodTypeAny = z.ZodTypeAny,
    TResponse extends z.ZodTypeAny = z.ZodTypeAny,
> {
    method: TMethod;
    path: string;
    params?: TParams;
    query?: TQuery;
    body?: TBody;
    response: TResponse;
    summary: string;
    description?: string;
    tags: string[];
}

/** @deprecated Use EndpointContract instead */
export type EndpointDefinition<
    TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
    TParams extends z.ZodTypeAny = z.ZodTypeAny,
    TQuery extends z.ZodTypeAny = z.ZodTypeAny,
    TBody extends z.ZodTypeAny = z.ZodTypeAny,
    TResponse extends z.ZodTypeAny = z.ZodTypeAny,
> = EndpointContract<TMethod, TParams, TQuery, TBody, TResponse>;

export function defineEndpoint<
    TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    TParams extends z.ZodTypeAny,
    TQuery extends z.ZodTypeAny,
    TBody extends z.ZodTypeAny,
    TResponse extends z.ZodTypeAny,
>(
    definition: EndpointContract<TMethod, TParams, TQuery, TBody, TResponse>,
): EndpointContract<TMethod, TParams, TQuery, TBody, TResponse> {
    return definition;
}
```

### Usage in Entity Contracts

```typescript
// packages/contracts/src/contracts/revenue/property.contract.ts
import { defineEndpoint } from "../base.types";
import { Routes } from "../routes";

export const PropertyContract = {
    // GET /properties — list with pagination + filters
    listProperties: defineEndpoint({
        method: "GET",
        path: Routes.properties,
        query: PropertyQuerySchema,
        response: PropertyListResponseSchema,
        summary: "List properties with pagination and filters",
        tags: ["revenue", "assessment-roll"],
    }),

    // GET /properties/:id — single entity by UUID
    getProperty: defineEndpoint({
        method: "GET",
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        response: PropertyResponseSchema,
        summary: "Get property by ID",
        tags: ["revenue", "assessment-roll"],
    }),

    // POST /properties — create new entity
    createProperty: defineEndpoint({
        method: "POST",
        path: Routes.properties,
        body: CreatePropertyBodySchema,
        response: PropertyResponseSchema,
        summary: "Create a new property",
        tags: ["revenue", "assessment-roll"],
    }),

    // PUT /properties/:id — full update
    updateProperty: defineEndpoint({
        method: "PUT",
        path: `${Routes.properties}/:id`,
        params: PropertyIdParamsSchema,
        body: UpdatePropertyBodySchema,
        response: PropertyResponseSchema,
        summary: "Update an existing property",
        tags: ["revenue", "assessment-roll"],
    }),

    // DELETE /properties/:id — soft or hard delete
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
```

### Frontend Consumer — createTypedApi()

The frontend API service reads the contract to produce a typed fetch wrapper:

```typescript
// apps/property-tax-web/src/services/property.api.ts
import { PropertyContract } from "@civic/contracts";
import { createTypedApi } from "../lib/api-client";

// createTypedApi() infers params/query/body/response types from contract
export const propertyApi = {
    list: createTypedApi(PropertyContract.listProperties),
    getById: createTypedApi(PropertyContract.getProperty),
    create: createTypedApi(PropertyContract.createProperty),
    update: createTypedApi(PropertyContract.updateProperty),
    delete: createTypedApi(PropertyContract.deleteProperty),
};

// Usage in hooks — fully typed, no manual generics needed:
// const { data } = useQuery({ queryFn: () => propertyApi.list({ query: { page: 1 } }) });
// data is inferred as PropertyListResponse
```

### Backend Consumer — NestJS Controller

```typescript
// modules/domain/revenue/assessment-roll/src/controllers/property.controller.ts
import { PropertyContract, PropertyQuerySchema } from "@civic/contracts";

@Controller(PropertyContract.listProperties.path)
export class PropertyController {
    @Get()
    @ApiOperation({ summary: PropertyContract.listProperties.summary })
    async list(@Query() query: unknown) {
        const parsed = PropertyQuerySchema.parse(query);
        return this.propertyService.findMany(parsed);
    }
}
```

### Type Extraction from Contracts

```typescript
import { z } from "zod";
import { PropertyContract } from "@civic/contracts";

// Extract response type from any endpoint contract
type ListResponse = z.infer<typeof PropertyContract.listProperties.response>;
// → { items: PropertyResponse[]; pagination: PaginationMeta }

type SingleResponse = z.infer<typeof PropertyContract.getProperty.response>;
// → PropertyResponse

type CreateBody = z.infer<typeof PropertyContract.createProperty.body>;
// → { rollNumber: string; address: Address; propertyClass: PropertyClass; ... }
```
