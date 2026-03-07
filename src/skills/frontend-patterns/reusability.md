# Cross-App Reusability

> Pattern documentation for maximising code reuse when a monorepo hosts multiple web portals that share the same tech stack.

## 1. Component Pattern

When two or more portal apps live in the same monorepo (e.g. an HR portal and
a Tax portal), a large portion of their infrastructure code is **identical**.
The **Reusability** pattern introduces a layered package architecture with
clear extraction rules so that identical code is written once, configurable
code uses factory functions, and only truly domain-specific code stays inside
each app.

## 2. Overview

### Package Layers

```
┌───────────────────────────────────────────────────────┐
│  apps/hr-web/    apps/tax-web/    apps/permits-web/   │  ← Domain routes,
│  (domain pages, features, nav config, permissions)    │    domain hooks,
│                                                       │    app-specific UI
├───────────────────────────────────────────────────────┤
│  packages/app-core                                    │  ← Shared app infra:
│  (auth context, API client factory, query-client,     │    identical across
│   typed-query hooks, toast provider, layout shell,    │    all portals
│   parse-response, lazy-named, protected route)        │
├───────────────────────────────────────────────────────┤
│  packages/ui                                          │  ← Visual components:
│  (Button, DataTable, Modal, StatCard, Spinner, …)     │    design-system
│  (theme.css, formatCurrency, extractApiError)         │    primitives
├───────────────────────────────────────────────────────┤
│  packages/contracts                                   │  ← API contracts:
│  (Zod schemas, route constants, event schemas, types) │    shared with backend
└───────────────────────────────────────────────────────┘
```

| Package              | Contains                                                   | Consumers          |
| -------------------- | ---------------------------------------------------------- | ------------------ |
| `packages/contracts` | Zod schemas, route constants, event schemas, shared types  | Frontend + Backend |
| `packages/ui`        | Design-system components, CSS tokens, formatting utilities | Frontend apps      |
| `packages/app-core`  | App-level infrastructure (auth, API, query, layout, toast) | Frontend apps      |
| `apps/<product>-web` | Domain pages, feature slices, nav config, permission maps  | End users          |

### Reusability Decision Tree

```
Is the code identical across all portals?
├── YES → Extract to packages/app-core (or packages/ui for visual components)
│
├── MOSTLY — same structure, differs only in config values?
│   └── Extract a factory / configurable component
│       e.g. createApiClient({ storagePrefix }), <Sidebar navGroups={…} />
│
└── NO — fundamentally different per domain?
    └── Keep in apps/<product>-web/
        e.g. route definitions, nav config, domain permission booleans
```

## 3. Rules

### Extraction Rules

1.  **Identical code → extract immediately.** If a file is functionally
    identical in two or more apps, it belongs in a shared package. Do not
    tolerate copy-paste across portals.
2.  **Near-identical code → extract with config.** When files share 90%+
    logic but differ in a few config values (storage keys, product names,
    env vars), extract a **factory function** or a component with **props**
    that accept those values.
3.  **Domain-specific code stays in the app.** Route definitions, navigation
    groups, domain-specific permission booleans, and feature slices are
    inherently app-specific.
4.  **Never duplicate shared utilities.** If a utility already exists in
    `packages/ui` or `packages/app-core`, import it — do not copy it into
    `apps/`. If it only exists in one app and is generic, promote it.

### Package Boundary Rules

5.  **`packages/ui`** owns **visual** components (Button, Modal, DataTable)
    and **formatting** utilities (formatCurrency, extractApiError). It has
    **zero** app-state awareness — no auth, no API calls, no routing.
6.  **`packages/app-core`** owns **app orchestration** infrastructure that
    requires React context, routing, or API awareness: AuthProvider, API
    client factory, QueryClient config, ToastProvider, typed-query hooks,
    parse-response, layout shell components (AppLayout, Header, PageLayout).
7.  **`packages/contracts`** owns **API contracts** (Zod schemas, route
    constants, TypeScript types) shared between frontend and backend.
8.  **`apps/<product>-web/`** owns all **domain-specific** code: page
    components, feature slices, navigation config, route definitions, and
    role-permission maps.

### What to Extract (Canonical List)

9.  **Auth context** (`lib/auth-context.tsx`): `AuthProvider`, `useAuth`,
    `persistAuth`, `clearAuth`. Use a config object for the storage key.
10. **API client** (`services/api.ts`): export a `createApiClient(config)`
    factory. Each app calls it once with its storage prefix and base URL.
11. **QueryClient config** (`lib/query-client.ts`): `createQueryClient()`
    factory with standard defaults (staleTime, retry, error handlers).
12. **Typed-query hooks** (`lib/use-typed-query.ts`): `useTypedQuery`,
    `useTypedListQuery`, `useTypedMutation` — zero domain awareness.
13. **Parse-response** (`lib/parse-response.ts`): Zod response validation
    wrapper — identical logic, generic by design.
14. **Lazy-named** (`lib/lazy-named.ts`): React.lazy wrapper for named
    exports — pure utility.
15. **Toast provider** (`hooks/use-toast.tsx`): `ToastProvider`, `useToast`.
    Pairs with `emitToast`/`onToast` from `packages/ui`.
16. **Layout shell components**: `AppLayout`, `Header`, `PageLayout`.
    These are structural wrappers with no domain logic.
17. **ProtectedRoute** component and `useFocusOnRouteChange` hook — generic
    auth/routing guard.

### What Stays App-Specific

18. **Sidebar navigation config** — each portal has unique route groups,
    icons, and role-based visibility. The sidebar component itself may share
    logic, but the `navGroups` data is defined per-app.
19. **Route definitions** (`App.tsx` route tree) — unique to each portal.
20. **Domain permission booleans** (`use-auth.ts` `canManagePayroll`,
    `canManageProperties`, etc.) — app-specific. The core role hierarchy
    and `hasRole`/`hasAnyRole`/`hasMinimumRole` helpers are shared.
21. **Domain hooks** (`hooks/use-employees.ts`, `hooks/use-properties.ts`)
    — entity-specific data fetching stays in the consuming app.
22. **Feature slices** (`features/<domain>/`) — domain components (stats,
    toolbar, table, forms, modals) are unique to each portal.
23. **Login page** — same structure but different product branding and demo
    data. Can be made configurable or kept as thin app-specific wrappers
    around a shared `<LoginLayout>` from `packages/ui`.

### Maintenance Rules

24. **DRY audit on new features.** Before building a new piece of infra in
    an app, search the shared packages first. If it doesn't exist but is
    generic, build it in the shared package from day one.
25. **Promote on second use.** When a utility written for one app is needed
    by a second app, promote it to the shared package — do not copy.
26. **Version the shared packages** (even if only `workspace:*`) so apps
    have a clear dependency graph.

## 4. Structure

### Shared package layout

```
packages/app-core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                       ← barrel: re-exports everything
    ├── auth/
    │   ├── auth-context.tsx           ← AuthProvider + useAuth
    │   ├── protected-route.tsx        ← ProtectedRoute + useFocusOnRouteChange
    │   └── index.ts
    ├── api/
    │   ├── create-api-client.ts       ← factory: createApiClient(config)
    │   ├── parse-response.ts          ← Zod response validation
    │   ├── use-typed-query.ts         ← useTypedQuery + useTypedListQuery
    │   ├── create-query-client.ts     ← factory: createQueryClient()
    │   └── index.ts
    ├── toast/
    │   ├── toast-provider.tsx         ← ToastProvider + useToast
    │   └── index.ts
    ├── layout/
    │   ├── app-layout.tsx             ← Sidebar + Header + Outlet shell
    │   ├── header.tsx                 ← Top bar (user menu, theme toggle)
    │   ├── page-layout.tsx            ← h1 + space-y-6 wrapper
    │   └── index.ts
    └── utils/
        ├── lazy-named.ts             ← React.lazy named-export wrapper
        └── index.ts
```

### App-specific code (per portal)

```
apps/<product>-web/src/
├── main.tsx                           ← imports from @myorg/app-core
├── App.tsx                            ← domain route definitions
├── components/layout/
│   └── sidebar.tsx                    ← app-specific nav groups
├── hooks/
│   ├── use-auth.ts                    ← extends shared useAuth with
│   │                                    domain permission booleans
│   └── use-<domain>.ts               ← domain data hooks
├── features/<domain>/                 ← domain feature slices
├── pages/                             ← domain page components
└── services/
    └── api.ts                         ← calls createApiClient({ storagePrefix: "myapp" })
```

### Import flow after extraction

```tsx
// apps/hr-web/src/main.tsx
import { AuthProvider, ToastProvider, createQueryClient } from "@myorg/app-core";
import { ThemeProvider, ScrollProgress } from "@myorg/ui";

// apps/hr-web/src/services/api.ts
import { createApiClient } from "@myorg/app-core";
export const api = createApiClient({ storagePrefix: "civic_hr" });

// apps/hr-web/src/hooks/use-auth.ts
import { useAuth as useBaseAuth } from "@myorg/app-core";
export function useAuth() {
    const auth = useBaseAuth();
    return {
        ...auth,
        canManagePayroll: auth.hasMinimumRole("PAYROLL_MANAGER"),
        canManageEmployees: auth.hasMinimumRole("HR_OFFICER"),
    };
}
```

## 5. Example Implementation

### Factory: `createApiClient`

```tsx
// packages/app-core/src/api/create-api-client.ts
import axios, { type AxiosInstance } from "axios";

interface ApiClientConfig {
    /** Prefix for localStorage keys, e.g. "civic_hr" */
    storagePrefix: string;
    /** Base URL override. Defaults to VITE_API_BASE_URL or "/api/v1" */
    baseUrl?: string;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
    const { storagePrefix, baseUrl } = config;

    const instance = axios.create({
        baseURL: baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "/api/v1",
        headers: { "Content-Type": "application/json" },
        withCredentials: true,
    });

    // Unwrap response envelope: { data: T } → T
    instance.interceptors.response.use((res) => {
        if (res.data && typeof res.data === "object" && "data" in res.data) {
            res.data = res.data.data;
        }
        return res;
    });

    // 401 auto-refresh: queue requests during refresh, replay after success
    let isRefreshing = false;
    let failedQueue: Array<{
        resolve: (v: unknown) => void;
        reject: (e: unknown) => void;
    }> = [];

    const processQueue = (error: unknown) => {
        failedQueue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(undefined)));
        failedQueue = [];
    };

    instance.interceptors.response.use(undefined, async (error) => {
        const original = error.config;
        if (error.response?.status !== 401 || original._retry) {
            return Promise.reject(error);
        }
        if (isRefreshing) {
            return new Promise((resolve, reject) => {
                failedQueue.push({ resolve, reject });
            }).then(() => instance(original));
        }
        original._retry = true;
        isRefreshing = true;
        try {
            await instance.post("/auth/refresh");
            processQueue(null);
            return instance(original);
        } catch (refreshError) {
            processQueue(refreshError);
            localStorage.removeItem(`${storagePrefix}_user`);
            window.location.href = "/login";
            return Promise.reject(refreshError);
        } finally {
            isRefreshing = false;
        }
    });

    return instance;
}
```

### Factory: `createQueryClient`

```tsx
// packages/app-core/src/api/create-query-client.ts
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { emitToast, extractApiError } from "@myorg/ui";

export function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
        queryCache: new QueryCache({
            onError: (error) => {
                emitToast({
                    variant: "error",
                    title: "Data Fetch Error",
                    description: extractApiError(error, "Failed to load data."),
                });
            },
        }),
        mutationCache: new MutationCache({
            onError: (error, _vars, _ctx, mutation) => {
                if (!mutation.options.onError) {
                    emitToast({
                        variant: "error",
                        title: "Operation Failed",
                        description: extractApiError(error, "Something went wrong."),
                    });
                }
            },
        }),
    });
}
```

### Shared AuthProvider with config

```tsx
// packages/app-core/src/auth/auth-context.tsx
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Routes, LoginResponseSchema } from "@myorg/contracts";

type AuthUser = { id: string; email: string; role: string; firstName: string };

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (data: Record<string, unknown>) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
    children: ReactNode;
    /** The Axios instance to use for auth API calls */
    api: import("axios").AxiosInstance;
    /** localStorage key for persisting user metadata */
    storageKey: string;
}

export function AuthProvider({ children, api, storageKey }: AuthProviderProps) {
    const queryClient = useQueryClient();
    const [user, setUser] = useState<AuthUser | null>(() => {
        const stored = localStorage.getItem(storageKey);
        return stored ? JSON.parse(stored) : null;
    });

    useEffect(() => {
        if (!localStorage.getItem(storageKey)) return;
        api.get(`${Routes.auth}/me`)
            .then(({ data }) => setUser(data))
            .catch(() => {
                setUser(null);
                localStorage.removeItem(storageKey);
            });
    }, [api, storageKey]);

    const login = useCallback(
        async (email: string, password: string) => {
            const { data } = await api.post(`${Routes.auth}/login`, { email, password });
            const validated = LoginResponseSchema.parse(data);
            localStorage.setItem(storageKey, JSON.stringify(validated.user));
            flushSync(() => setUser(validated.user));
        },
        [api, storageKey],
    );

    const signup = useCallback(
        async (payload: Record<string, unknown>) => {
            const { data } = await api.post(`${Routes.auth}/register`, payload);
            const validated = LoginResponseSchema.parse(data);
            localStorage.setItem(storageKey, JSON.stringify(validated.user));
            flushSync(() => setUser(validated.user));
        },
        [api, storageKey],
    );

    const logout = useCallback(async () => {
        try {
            await api.post(`${Routes.auth}/logout`);
        } catch {}
        setUser(null);
        localStorage.removeItem(storageKey);
        queryClient.clear();
    }, [api, storageKey, queryClient]);

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, signup, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};
```

### App-specific auth extension

```tsx
// apps/hr-web/src/hooks/use-auth.ts
import { useAuth as useBaseAuth } from "@myorg/app-core";
import { CivicRole } from "@myorg/contracts";

const ROLE_HIERARCHY: Record<string, number> = {
    VIEWER: 0,
    DATA_ENTRY: 1,
    HR_OFFICER: 2,
    PAYROLL_MANAGER: 3,
    DEPARTMENT_HEAD: 4,
    TREASURER: 5,
    SYSTEM_ADMIN: 6,
};

export function useAuth() {
    const auth = useBaseAuth();
    const level = auth.user ? (ROLE_HIERARCHY[auth.user.role] ?? 0) : -1;

    return {
        ...auth,
        hasMinimumRole: (minimum: string) => level >= (ROLE_HIERARCHY[minimum] ?? 999),
        hasAnyRole: (roles: string[]) => roles.includes(auth.user?.role ?? ""),
        // Domain-specific permission booleans
        canManageEmployees: level >= ROLE_HIERARCHY.HR_OFFICER,
        canManagePayroll: level >= ROLE_HIERARCHY.PAYROLL_MANAGER,
        canManageTeams: level >= ROLE_HIERARCHY.DEPARTMENT_HEAD,
    };
}
```

### App entry point using shared infra

```tsx
// apps/hr-web/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { ThemeProvider, ScrollProgress } from "@myorg/ui";
import { AuthProvider, ToastProvider, createQueryClient } from "@myorg/app-core";
import { api } from "./services/api";
import { App } from "./App";
import "./index.css";

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <ToastProvider>
                    <ScrollProgress />
                    <NuqsAdapter>
                        <BrowserRouter>
                            <AuthProvider api={api} storageKey="civic_hr_user">
                                <App />
                            </AuthProvider>
                        </BrowserRouter>
                    </NuqsAdapter>
                </ToastProvider>
            </ThemeProvider>
        </QueryClientProvider>
    </React.StrictMode>,
);
```

## 6. Cross-App Reusability Checklist

Use this checklist when adding a new portal to the monorepo or auditing an
existing one for extraction opportunities.

| #   | Check                                                                  | Shared Package       |
| --- | ---------------------------------------------------------------------- | -------------------- |
| 1   | Auth context (login, logout, session verify, persist)                  | `packages/app-core`  |
| 2   | Protected route component + focus-on-route-change hook                 | `packages/app-core`  |
| 3   | API client (Axios instance, interceptors, 401 refresh)                 | `packages/app-core`  |
| 4   | QueryClient configuration (staleTime, retry, error toasts)             | `packages/app-core`  |
| 5   | Typed-query hooks (useTypedQuery, useTypedListQuery, useTypedMutation) | `packages/app-core`  |
| 6   | Response validation (parseResponse with Zod)                           | `packages/app-core`  |
| 7   | Toast provider (ToastProvider, useToast)                               | `packages/app-core`  |
| 8   | Lazy-named utility (React.lazy for named exports)                      | `packages/app-core`  |
| 9   | Layout shell (AppLayout, Header, PageLayout)                           | `packages/app-core`  |
| 10  | Design-system components (Button, Modal, DataTable, etc.)              | `packages/ui`        |
| 11  | Formatting utilities (formatCurrency, formatAddress)                   | `packages/ui`        |
| 12  | Toast emitter (emitToast, onToast, extractApiError)                    | `packages/ui`        |
| 13  | CSS theme tokens (theme.css, Nordic design system)                     | `packages/ui`        |
| 14  | API contracts (Zod schemas, route constants, types)                    | `packages/contracts` |
| 15  | Sidebar navigation config (navGroups, product name)                    | `apps/<product>-web` |
| 16  | Route definitions (App.tsx route tree)                                 | `apps/<product>-web` |
| 17  | Domain permission booleans (canManagePayroll, canManageProperties)     | `apps/<product>-web` |
| 18  | Domain data hooks (useEmployees, useProperties)                        | `apps/<product>-web` |
| 19  | Feature slices (stats, toolbar, table, forms, modals)                  | `apps/<product>-web` |
| 20  | Login page (product name, demo credentials, branding)                  | `apps/<product>-web` |
