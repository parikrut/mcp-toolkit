# App Shell & Router

> Pattern documentation for the application entry point, provider stack, lazy-loaded routing, and layout shells.

## 1. Component Pattern

The **App Shell** is the outermost structural layer of the frontend. It
consists of three files: `main.tsx` (provider stack + render), `App.tsx`
(lazy routes + `ProtectedRoute`), and `AppLayout` (sidebar + header +
content outlet). Together they establish the provider hierarchy, code-split
every page, and render the authenticated shell.

## 2. Overview

```
main.tsx  (providers)
└── App.tsx  (routes)
    ├── /login          → LoginPage
    ├── / (protected)   → AppLayout
    │   ├── Sidebar
    │   ├── Header
    │   └── <Outlet />  → lazy-loaded pages
    ├── /portal         → PortalLayout → citizen pages
    └── *               → NotFoundPage
```

**Provider stack** (outermost → innermost):

| Provider              | Source                  | Purpose                            |
| --------------------- | ----------------------- | ---------------------------------- |
| `QueryClientProvider` | `@tanstack/react-query` | Data-fetching cache                |
| `ThemeProvider`       | `@myorg/ui`             | Light/dark mode                    |
| `ToastProvider`       | `hooks/use-toast`       | Toast notification context         |
| `ScrollProgress`      | `@myorg/ui`             | Page scroll indicator              |
| `NuqsAdapter`         | `nuqs`                  | URL state adapter for React Router |
| `BrowserRouter`       | `react-router`          | Client-side routing                |
| `AuthProvider`        | `lib/auth-context`      | Authentication state               |

## 3. Rules

1. **Every page module is lazy-loaded** via `lazy(() => import(...))`.
   The import uses `.then(m => ({ default: m.NamedExport }))` to convert
   named exports to default exports for React.lazy compatibility.
2. **`Suspense` fallback** is a centered `<Spinner size="lg" />` component.
3. **`ErrorBoundary`** from `@myorg/ui` wraps the route tree to catch
   rendering errors.
4. **`QueryClient`** is configured with global defaults:
    - `staleTime: 30_000` (30s cache freshness)
    - `retry: 1`
    - `refetchOnWindowFocus: false`
    - Global `QueryCache.onError` for background refetch toasts
    - Global `MutationCache.onError` for unhandled mutation errors
5. **`AppLayout`** renders: `SkipNav` → `Sidebar` → `Header` + `<main>` →
   `<Outlet />`. The main area has `overflow-y-auto` for page scrolling.
6. **`main` has `tabIndex={-1}`** and receives focus on route change for
   screen-reader accessibility (`useFocusOnRouteChange` hook).
7. **Route nesting:** Authenticated routes are children of a `<Route>`
   with `element={<ProtectedRoute><AppLayout /></ProtectedRoute>}`.
   Role-restricted routes wrap their element in a nested `ProtectedRoute`.
8. **Portal routes** use a separate `PortalLayout` with its own auth
   context (`CitizenAuthProvider`), separate from the admin `AppLayout`.
9. **Sidebar navigation** is defined as a `NavGroup[]` config array at
   module scope in `sidebar.tsx`, using Lucide icons and `NavLink`.
10. **No business logic** in `main.tsx` or `App.tsx`. They are purely
    structural — providers and route definitions only.

## 4. Structure

```
src/
├── main.tsx            ← ReactDOM.createRoot + provider stack
├── App.tsx             ← lazy imports + <Routes> tree + ProtectedRoute
├── components/layout/
│   ├── app-layout.tsx  ← Sidebar + Header + Outlet
│   ├── sidebar.tsx     ← Nav groups + NavLink + collapse toggle
│   ├── header.tsx      ← Top bar (breadcrumbs, user menu, theme toggle)
│   └── page-layout.tsx ← see page-layout.md
└── pages/
    ├── login.tsx
    ├── dashboard.tsx
    ├── <domain>.tsx         ← list pages
    ├── <domain>-detail.tsx  ← detail pages
    └── portal/
        ├── portal-layout.tsx
        └── portal-<page>.tsx
```

## 5. Example Implementation

**Entry point:**

```tsx
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react-router/v7";
import { ThemeProvider, ScrollProgress } from "@myorg/ui";
import { AuthProvider } from "./lib/auth-context";
import { ToastProvider } from "./hooks/use-toast";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <ThemeProvider>
                <ToastProvider>
                    <ScrollProgress />
                    <NuqsAdapter>
                        <BrowserRouter>
                            <AuthProvider>
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

**Router:**

```tsx
// src/App.tsx (abbreviated)
import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router";
import { AppLayout } from "./components/layout";
import { ErrorBoundary, Spinner } from "@myorg/ui";
import { useAuth } from "./lib/auth-context";

const LoginPage = lazy(() => import("./pages/login").then((m) => ({ default: m.LoginPage })));
const Dashboard = lazy(() =>
    import("./pages/dashboard").then((m) => ({ default: m.DashboardPage })),
);
const Properties = lazy(() =>
    import("./pages/properties").then((m) => ({ default: m.PropertiesPage })),
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) return <Navigate to="/login" replace />;
    return <>{children}</>;
};

export const App = () => (
    <ErrorBoundary>
        <Suspense
            fallback={
                <div className="flex items-center justify-center py-20">
                    <Spinner size="lg" />
                </div>
            }
        >
            <Routes>
                <Route path="login" element={<LoginPage />} />
                <Route
                    element={
                        <ProtectedRoute>
                            <AppLayout />
                        </ProtectedRoute>
                    }
                >
                    <Route index element={<Dashboard />} />
                    <Route path="properties" element={<Properties />} />
                    {/* …more routes */}
                </Route>
                <Route path="*" element={<div>404</div>} />
            </Routes>
        </Suspense>
    </ErrorBoundary>
);
```

**App Layout:**

```tsx
// src/components/layout/app-layout.tsx
import { Suspense } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { SkipNav, ErrorBoundary, Spinner } from "@myorg/ui";

export const AppLayout = () => (
    <div className="flex h-screen bg-(--color-background)">
        <SkipNav />
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main
                id="main-content"
                tabIndex={-1}
                className="flex-1 overflow-y-auto px-6 py-8 sm:px-10 lg:px-16 focus:outline-none"
            >
                <ErrorBoundary>
                    <Suspense
                        fallback={
                            <div className="flex items-center justify-center py-20">
                                <Spinner size="lg" />
                            </div>
                        }
                    >
                        <Outlet />
                    </Suspense>
                </ErrorBoundary>
            </main>
        </div>
    </div>
);
```
