# Auth & Protected Routes

> Pattern documentation for the authentication context, login flow, and role-based route protection.

## 1. Component Pattern

The **Auth** pattern consists of three co-ordinated pieces: an `AuthProvider`
React context that manages user state, a `ProtectedRoute` wrapper component
that enforces authentication (and optional role checks) on route groups, and a
`LoginPage` that collects credentials and calls the context's `login` method.
Authentication tokens are stored in httpOnly cookies; only non-sensitive user
metadata is kept in `localStorage`.

## 2. Overview

| Piece            | File                   | Responsibility                              |
| ---------------- | ---------------------- | ------------------------------------------- |
| `AuthProvider`   | `lib/auth-context.tsx` | Context + `login` / `signup` / `logout`     |
| `useAuth`        | `lib/auth-context.tsx` | Hook to access current user + methods       |
| `ProtectedRoute` | `App.tsx` (inline)     | Redirects unauthenticated users to `/login` |
| `LoginPage`      | `pages/login.tsx`      | Email + password form                       |

The flow:

1. `main.tsx` wraps the app in `AuthProvider`.
2. `App.tsx` wraps authenticated routes in `<ProtectedRoute>`.
3. On mount, `AuthProvider` verifies the session via `GET /auth/me`.
4. Login POSTs to `/auth/login` → server sets httpOnly cookie →
   provider stores user info in state + `localStorage`.
5. Logout POSTs to `/auth/logout` → clears cookies, state, query cache.

## 3. Rules

1. **Tokens are httpOnly cookies.** Never store JWTs in `localStorage` or
   React state. The Axios client uses `withCredentials: true`.
2. **`localStorage` stores only user metadata** (name, role, id) for
   hydration on refresh. Validated against a Zod schema on read.
3. **Session verification on mount:** `AuthProvider` calls `/auth/me` on
   mount only if a stored user exists (avoids unnecessary 401s).
4. **`flushSync`** is used in `login()` to ensure state updates propagate
   before the navigation that follows.
5. **`ProtectedRoute` is a component, not a hook.** It wraps `<Route>`
   elements and accepts an optional `allowedRoles` prop for RBAC.
6. **`allowedRoles`** is an array of `CivicRole` values from
   `@civic/contracts`. If the user's role is not in the array, they are
   redirected to `/`.
7. **Login page** stores the attempted path in `location.state.from` so
   `ProtectedRoute` can redirect back after successful login.
8. **Logout clears everything:** user state, `localStorage`, and the
   TanStack Query cache (`queryClient.clear()`).
9. **Login form uses controlled `useState`**, not `react-hook-form`,
   since it is simple (2-3 fields).
10. **Error display** uses a rose-coloured inline message, not a toast.

## 4. Structure

```
src/lib/auth-context.tsx
├── AuthContext (createContext)
├── AuthProvider
│   ├── useState<AuthUser | null>  ← hydrated from localStorage
│   ├── useEffect → GET /auth/me   ← verify session on mount
│   ├── login(email, password)     ← POST /auth/login + persistAuth
│   ├── signup(data)               ← POST /auth/register + persistAuth
│   └── logout()                   ← POST /auth/logout + clearAuth + queryClient.clear()
└── useAuth() hook                 ← { user, isAuthenticated, login, signup, logout }

src/App.tsx
├── ProtectedRoute({ children, allowedRoles? })
│   ├── if (!isAuthenticated) → Navigate to /login
│   └── if (allowedRoles && !includes(user.role)) → Navigate to /
└── <Routes>
    ├── <Route path="login" element={<LoginPage />} />
    └── <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        ├── <Route index element={<Dashboard />} />
        ├── <Route path="settings" element={
        │       <ProtectedRoute allowedRoles={["SYSTEM_ADMIN","TREASURER"]}>
        │           <SettingsPage />
        │       </ProtectedRoute>
        │   } />
        └── …
```

## 5. Example Implementation

**Auth context:**

```tsx
// src/lib/auth-context.tsx (abbreviated)
import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Routes, LoginResponseSchema } from "@civic/contracts";
import { api, USER_STORAGE_KEY } from "../services/api";

type AuthUser = { id: string; email: string; role: string; firstName: string };

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const [user, setUser] = useState<AuthUser | null>(() => {
        const stored = localStorage.getItem(USER_STORAGE_KEY);
        return stored ? JSON.parse(stored) : null;
    });

    useEffect(() => {
        if (!localStorage.getItem(USER_STORAGE_KEY)) return;
        api.get(`${Routes.auth}/me`)
            .then(({ data }) => setUser(data))
            .catch(() => {
                setUser(null);
                localStorage.removeItem(USER_STORAGE_KEY);
            });
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const { data } = await api.post(`${Routes.auth}/login`, { email, password });
        const validated = LoginResponseSchema.parse(data);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(validated.user));
        flushSync(() => setUser(validated.user));
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post(`${Routes.auth}/logout`);
        } catch {}
        setUser(null);
        localStorage.removeItem(USER_STORAGE_KEY);
        queryClient.clear();
    }, [queryClient]);

    return (
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
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

**Protected route:**

```tsx
// Inside src/App.tsx
const ProtectedRoute = ({
    children,
    allowedRoles,
}: {
    children: ReactNode;
    allowedRoles?: CivicRole[];
}) => {
    const { user, isAuthenticated } = useAuth();
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }
    if (allowedRoles && user && !allowedRoles.includes(user.role)) {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
};
```
