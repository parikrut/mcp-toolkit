# API Service

> Pattern documentation for the Axios-based API client and typed query/response helpers.

## 1. Component Pattern

The **API Service** layer consists of three files that form the HTTP foundation
for all data hooks. The Axios instance handles base URL, credentials, and token
refresh. Two helper modules provide type-safe wrappers: one for individual
responses (`parseResponse`) and one for paginated lists (`useTypedListQuery`).

## 2. Overview

| File                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `services/api.ts`        | Configures the shared Axios instance (base URL, cookies, 401 refresh/retry) |
| `lib/parse-response.ts`  | Validates a single API response against a Zod schema                        |
| `lib/use-typed-query.ts` | Generic TanStack Query wrappers with built-in Zod validation                |

Authentication is handled via **httpOnly cookies** (`withCredentials: true`).
No JWT tokens are stored in `localStorage`. A response interceptor silently
refreshes expired access tokens by calling the refresh endpoint, then replays
the failed request.

## 3. Rules

1. **One shared Axios instance.** All hooks import `api` from
   `../services/api`. Never create ad-hoc `axios.create()` calls.
2. **`withCredentials: true` is mandatory.** The backend sets httpOnly cookies;
   the client must send them on every request.
3. **Base URL** defaults to `/api/v1` and can be overridden via the
   `VITE_API_BASE_URL` environment variable.
4. **401 handling is automatic.** The response interceptor queues failed
   requests during a token refresh and replays them after success.
   If refresh fails, the user is redirected to `/login`.
5. **All GET responses must be Zod-validated.** Use `parseResponse()` for
   single-object fetches and `useTypedListQuery()` for paginated lists.
6. **Dev-mode lenience:** `parseResponse` logs validation warnings in
   development but returns data as-is. In production it throws.
7. **`useTypedListQuery` expects `{ items: T[], pagination: PaginationMeta }`**
   shaped responses. It validates each item individually.
8. **Pass `signal` to all GET requests** for automatic TanStack Query
   cancellation on unmount.

## 4. Structure

```
src/
├── services/
│   └── api.ts                    ← Axios instance + interceptors
└── lib/
    ├── parse-response.ts         ← Zod validation wrapper
    └── use-typed-query.ts        ← useTypedQuery + useTypedListQuery
```

**Axios Instance Config:**

| Setting           | Value                            | Reason                     |
| ----------------- | -------------------------------- | -------------------------- |
| `baseURL`         | `VITE_API_BASE_URL` or `/api/v1` | Proxy-friendly default     |
| `Content-Type`    | `application/json`               | All payloads are JSON      |
| `withCredentials` | `true`                           | Send httpOnly auth cookies |

**`useTypedListQuery<T>` Options:**

| Option       | Type                      | Description                   |
| ------------ | ------------------------- | ----------------------------- |
| `queryKey`   | `readonly unknown[]`      | TanStack Query cache key      |
| `path`       | `string`                  | API endpoint path             |
| `params`     | `Record<string, unknown>` | Query parameters              |
| `itemSchema` | `ZodSchema<T>`            | Zod schema for each list item |
| `staleTime`  | `number`                  | Cache freshness duration (ms) |
| `enabled`    | `boolean`                 | Conditional fetching          |

## 5. Example Implementation

**Axios client:**

```tsx
// src/services/api.ts
import axios from "axios";

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
    headers: { "Content-Type": "application/json" },
    withCredentials: true,
});

// 401 interceptor retries with refreshed cookie
api.interceptors.response.use(
    (res) => res,
    async (error) => {
        if (error.response?.status === 401 && !error.config._retry) {
            error.config._retry = true;
            await api.post("/auth/refresh");
            return api(error.config);
        }
        return Promise.reject(error);
    },
);
```

**Parse helper:**

```tsx
// src/lib/parse-response.ts
import { type ZodSchema, type ZodError } from "zod";

export function parseResponse<T>(schema: ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        console.warn("[API Response Validation]", result.error.issues);
        if (import.meta.env.PROD) {
            throw new Error(`API response validation failed: ${result.error.message}`);
        }
        return data as T;
    }
    return result.data;
}
```

**Typed list query:**

```tsx
// src/lib/use-typed-query.ts
import { useQuery } from "@tanstack/react-query";
import { type ZodSchema } from "zod";
import type { PaginationMeta } from "@civic/contracts";
import { api } from "../services/api";
import { parseResponse } from "./parse-response";

interface TypedListQueryOptions<TItem> {
    path: string;
    params?: Record<string, unknown>;
    itemSchema: ZodSchema<TItem>;
    queryKey: readonly unknown[];
    staleTime?: number;
    enabled?: boolean;
}

export function useTypedListQuery<TItem>({
    path,
    params,
    itemSchema,
    queryKey,
    ...options
}: TypedListQueryOptions<TItem>) {
    return useQuery<{ items: TItem[]; pagination: PaginationMeta }>({
        queryKey,
        queryFn: async ({ signal }) => {
            const { data } = await api.get(path, { params, signal });
            return {
                items: (data.items ?? []).map((item: unknown) => parseResponse(itemSchema, item)),
                pagination: data.pagination,
            };
        },
        ...options,
    });
}
```
