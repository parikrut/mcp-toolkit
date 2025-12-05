# Toast System

> Pattern documentation for the toast notification system used for success, error, and info feedback.

## 1. Component Pattern

The **Toast System** is a React context + provider that renders transient
notification banners at the bottom-right of the viewport. Components call
`toast.success()`, `toast.error()`, or `toast.info()` via the `useToast`
hook. A global `emitToast()` function allows non-React code (e.g.
`QueryClient` error handlers) to surface toasts without hook access.

## 2. Overview

| Piece           | Location              | Purpose                              |
| --------------- | --------------------- | ------------------------------------ |
| `ToastProvider` | `hooks/use-toast.tsx` | Context + auto-dismiss + render      |
| `useToast()`    | `hooks/use-toast.tsx` | Hook API: `success`, `error`, `info` |
| `emitToast()`   | `@myorg/ui`           | Global event emitter (non-React)     |
| `onToast()`     | `@myorg/ui`           | Subscribe to global toast events     |

Toasts auto-dismiss after 4 seconds. The provider subscribes to the global
`onToast` emitter so that the `QueryClient` global error handlers (configured
in `main.tsx`) can emit toasts without being inside a React component tree.

## 3. Rules

1. **Always use `useToast()` inside React components** — never call
   `emitToast()` from within a component; that is reserved for non-React
   code (query/mutation cache handlers).
2. **Three variants:** `success` (nordic-green), `error` (nordic-rose),
   `info` (nordic-blue).
3. **Method signature:** `toast.success(title, description?)`. Title is
   required; description is optional.
4. **Auto-dismiss in 4 seconds.** No manual close button — toasts are
   ephemeral.
5. **Position:** `fixed bottom-4 right-4 z-9999`.
6. **Accessible:** Each toast has `role="alert"` for screen readers.
7. **`extractApiError()`** from `@myorg/ui` should be used to extract a
   human-readable message from Axios errors before passing to `toast.error()`.
8. **`ToastProvider` wraps the entire app** in `main.tsx`, above
   `BrowserRouter` and `AuthProvider`.
9. **Mutation inline `onError`**: When a mutation has its own `onError`
   handler (page-level toast with contextual message), the global
   `MutationCache.onError` skips the generic toast to avoid duplicates.
10. **Do not use `window.alert()`** — always use the toast system.

## 4. Structure

```
src/hooks/use-toast.tsx
├── ToastContext (createContext)
├── ToastProvider
│   ├── useState<Toast[]>
│   ├── push(variant, title, description)  ← adds toast + setTimeout(4000)
│   ├── success / error / info             ← convenience wrappers
│   ├── useEffect → onToast(push)          ← subscribe to global emitter
│   └── render: {children} + fixed toast container
└── useToast() hook → { success, error, info }
```

**Global emitter (in @myorg/ui):**

```
emitToast({ variant, title, description })  ← fires a custom event
onToast(callback)                           ← returns unsubscribe fn
```

## 5. Example Implementation

```tsx
// src/hooks/use-toast.tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { onToast } from "@myorg/ui";

type ToastVariant = "success" | "error" | "info";

interface Toast {
    id: number;
    variant: ToastVariant;
    title: string;
    description?: string;
}

interface ToastContextValue {
    success: (title: string, description?: string) => void;
    error: (title: string, description?: string) => void;
    info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let nextId = 0;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const push = useCallback((variant: ToastVariant, title: string, description?: string) => {
        const id = ++nextId;
        setToasts((prev) => [...prev, { id, variant, title, description }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
    }, []);

    const success = useCallback(
        (title: string, desc?: string) => push("success", title, desc),
        [push],
    );
    const error = useCallback((title: string, desc?: string) => push("error", title, desc), [push]);
    const info = useCallback((title: string, desc?: string) => push("info", title, desc), [push]);

    // Subscribe to global emitter for non-React code
    useEffect(() => {
        return onToast((event) => push(event.variant, event.title, event.description));
    }, [push]);

    const variantStyles: Record<ToastVariant, string> = {
        success:
            "border-(--color-nordic-green) bg-(--color-nordic-green)/10 text-(--color-nordic-green)",
        error: "border-(--color-nordic-rose) bg-(--color-nordic-rose)/10 text-(--color-nordic-rose)",
        info: "border-(--color-nordic-blue) bg-(--color-nordic-blue)/10 text-(--color-nordic-blue)",
    };

    return (
        <ToastContext.Provider value={{ success, error, info }}>
            {children}
            <div className="fixed bottom-4 right-4 z-9999 flex flex-col gap-2">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={`rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm ${variantStyles[t.variant]}`}
                        role="alert"
                    >
                        <p className="text-sm font-semibold">{t.title}</p>
                        {t.description && (
                            <p className="mt-0.5 text-xs opacity-90">{t.description}</p>
                        )}
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToast must be used within a ToastProvider");
    return ctx;
}
```

**Usage in a form/hook:**

```tsx
const toast = useToast();

mutation.mutate(payload, {
    onSuccess: () => {
        toast.success("Saved", "Record updated successfully.");
    },
    onError: (error) => {
        toast.error("Error", extractApiError(error, "Operation failed."));
    },
});
```
