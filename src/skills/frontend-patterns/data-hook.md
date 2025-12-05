# Data Hook

> Pattern documentation for domain-specific TanStack Query hooks that power data-list pages.

## 1. Component Pattern

A **Data Hook** file is a collection of TanStack Query hooks for a single
domain entity. It centralises all API communication, Zod response validation,
query-key management, and cache invalidation for that domain. Every feature
component ([Stats Panel](stats-panel.md), [Data Table](data-table.md)) calls
these hooks directly — data is never passed as props from the
[Master Page](master-page.md).

## 2. Overview

Each hook file follows a layered structure:

| Section               | Purpose                                                             |
| --------------------- | ------------------------------------------------------------------- |
| **Imports**           | TanStack Query, API client, parse utilities, contracts              |
| **Type re-exports**   | Convenient aliases for page-level consumers                         |
| **Query-key factory** | Hierarchical key factory for cache management                       |
| **List hook**         | `use<Domain>(filters)` — paginated list with typed query            |
| **Detail hook**       | `use<Domain>(id)` — single entity fetch                             |
| **Mutation hooks**    | `useCreate<Domain>()`, `useUpdate<Domain>()`, `useDelete<Domain>()` |

The list hook uses `useTypedListQuery` — a thin wrapper around TanStack
`useQuery` that automatically validates the response array against a Zod item
schema (see [api-service.md](api-service.md)). Mutations use `useMutation`
and invalidate the relevant query keys on success.

## 3. Rules

1. **Name convention:** `use-<domain>.ts` in `src/hooks/`.
   Exports: `use<Domain>`, `use<Domain>Detail`, `useCreate<Domain>`, etc.
2. **Query-key factory is mandatory.** Define a `<domain>Keys` object with
   `all`, `lists`, `list(filters)`, `details`, `detail(id)` entries using
   the hierarchical array pattern.
3. **All response data is Zod-validated** via `parseResponse()` or
   `useTypedListQuery({ itemSchema })`. Never trust raw API responses.
4. **Schemas and types come from `@myorg/contracts`.** Never define response
   shapes locally.
5. **`staleTime` should be set** (typically `30_000` ms) to prevent cascading
   refetches when multiple components share the same query key.
6. **Mutations invalidate the broadest relevant key.** After a create/update/
   delete, call `qc.invalidateQueries({ queryKey: <domain>Keys.all })`.
7. **Re-export convenience type aliases** at the top of the file for
   page-level consumers (e.g. `export type { PropertyResponse as Property }`).
8. **No UI code.** Hook files must not import React components or JSX.

## 4. Structure

```
src/hooks/use-<domain>.ts
├── import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
├── import { api } from "../services/api"
├── import { parseResponse } from "../lib/parse-response"
├── import { useTypedListQuery } from "../lib/use-typed-query"
├── import { <ResponseSchema>, Routes } from "@myorg/contracts"
├── import type { <Response>, <Query>, <CreateBody>, … } from "@myorg/contracts"
│
├── export type { <Response> as <Alias> }
│
├── export const <domain>Keys = {
│       all: ["<domain>"],
│       lists: () => [...all, "list"],
│       list: (filters) => [...lists(), filters],
│       details: () => [...all, "detail"],
│       detail: (id) => [...details(), id],
│   }
│
├── export function use<Domain>(filters) {
│       return useTypedListQuery<Item>({
│           queryKey: keys.list(filters),
│           path: Routes.<domain>,
│           params: filters,
│           itemSchema: <ResponseSchema>,
│           staleTime: 30_000,
│       })
│   }
│
├── export function use<Domain>Detail(id) { … useQuery … }
├── export function useCreate<Domain>() { … useMutation … }
├── export function useUpdate<Domain>() { … useMutation … }
└── export function useDelete<Domain>() { … useMutation … }
```

**Helper: `useTypedListQuery`**

A generic wrapper that fetches a paginated list endpoint and validates each
item against a Zod schema. Returns `{ items: T[], pagination: PaginationMeta }`.

**Helper: `parseResponse`**

Validates a single-object response against a Zod schema. In development it
logs warnings but returns data as-is; in production it throws on mismatch.

## 5. Example Implementation

```tsx
// src/hooks/use-properties.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { parseResponse } from "../lib/parse-response";
import { useTypedListQuery } from "../lib/use-typed-query";
import { PropertyResponseSchema, AssessmentResponseSchema, Routes } from "@myorg/contracts";
import type {
    PropertyResponse,
    PaginatedResponse,
    PropertyQuery,
    CreatePropertyBody,
    UpdatePropertyBody,
} from "@myorg/contracts";

export type { PropertyResponse as Property, PropertyQuery as PropertyFilters };

// ─── Query-key factory ──────────────────────────────────────

export const propertyKeys = {
    all: ["properties"] as const,
    lists: () => [...propertyKeys.all, "list"] as const,
    list: (filters: PropertyQuery) => [...propertyKeys.lists(), filters] as const,
    details: () => [...propertyKeys.all, "detail"] as const,
    detail: (id: string) => [...propertyKeys.details(), id] as const,
};

// ─── List hook ──────────────────────────────────────────────

export function useProperties(filters: PropertyQuery = {}) {
    return useTypedListQuery<PropertyResponse>({
        queryKey: propertyKeys.list(filters),
        path: Routes.properties,
        params: filters as Record<string, unknown>,
        itemSchema: PropertyResponseSchema,
        staleTime: 30 * 1000,
    });
}

// ─── Detail hook ────────────────────────────────────────────

export function useProperty(id: string | undefined) {
    return useQuery({
        queryKey: propertyKeys.detail(id!),
        queryFn: async ({ signal }) => {
            const { data } = await api.get<PropertyResponse>(`${Routes.properties}/${id}`, {
                signal,
            });
            return parseResponse(PropertyResponseSchema, data);
        },
        enabled: !!id,
        staleTime: 30 * 1000,
    });
}

// ─── Create mutation ────────────────────────────────────────

export function useCreateProperty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: CreatePropertyBody) => {
            const { data } = await api.post<PropertyResponse>(Routes.properties, body);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: propertyKeys.all });
        },
    });
}

// ─── Update mutation ────────────────────────────────────────

export function useUpdateProperty() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...body }: UpdatePropertyBody & { id: string }) => {
            const { data } = await api.patch<PropertyResponse>(`${Routes.properties}/${id}`, body);
            return data;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: propertyKeys.all });
        },
    });
}
```
