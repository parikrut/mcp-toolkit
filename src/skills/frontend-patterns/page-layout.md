# Page Layout

> Pattern documentation for the shared layout shell that wraps every data-list page.

## 1. Component Pattern

The **Page Layout** is a generic structural wrapper. It receives a `title` string
and renders it as an `<h1>`, then stacks its children with consistent vertical
spacing. It is **not domain-specific** — every page in the application uses the
same layout component.

## 2. Overview

`PageLayout` guarantees visual consistency across all pages:

- A single `<h1>` heading styled with the design-system text hierarchy.
- A vertical rhythm of `space-y-6` (1.5 rem gap) between all children.
- No background, no padding on the outer wrapper — those are handled by the
  app-level shell (`AppLayout` with sidebar + header).

The component is deliberately minimal so that all layout customisation happens
via the children it receives (see [master-page.md](master-page.md)).

## 3. Rules

1. **Exactly one `title` prop.** The title is rendered as the `<h1>` for the
   page and must be a plain string (no JSX).
2. **Children order is the caller's responsibility.** `PageLayout` does not
   enforce slot order — that is the [Master Page](master-page.md)'s concern.
3. **No domain logic.** The component must remain 100 % generic; it does not
   import anything from `features/`.
4. **Single export.** The file exports only `PageLayout` and its props
   interface `PageLayoutProps`.
5. **Uses semantic text colour** via `--color-text-primary` (see
   [nordic-styles.md](nordic-styles.md)) so it respects light/dark mode.
6. **Lives in `src/components/layout/`.** Re-exported via the layout barrel
   (see [barrel-exports.md](barrel-exports.md)).

## 4. Structure

```
src/components/layout/page-layout.tsx
├── interface PageLayoutProps { title: string; children: ReactNode }
└── export const PageLayout = ({ title, children }) => (
        <div className="space-y-6">
            <h1 …>{title}</h1>
            {children}
        </div>
    )
```

**Props API:**

| Prop       | Type        | Required | Description                          |
| ---------- | ----------- | -------- | ------------------------------------ |
| `title`    | `string`    | Yes      | Page heading displayed as `<h1>`     |
| `children` | `ReactNode` | Yes      | Stats, Toolbar, Table, and/or Modals |

## 5. Example Implementation

```tsx
// src/components/layout/page-layout.tsx
import type { ReactNode } from "react";

interface PageLayoutProps {
    /** Page heading displayed as h1 */
    title: string;
    /** Stats, Toolbar, Table, and Modals */
    children: ReactNode;
}

/**
 * Canonical page layout for all data-list pages.
 *
 * Renders a consistent `space-y-6` container with a styled h1 heading.
 * Children should follow the order: Stats → Toolbar → Table → Modals.
 */
export const PageLayout = ({ title, children }: PageLayoutProps) => (
    <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-(--color-text-primary)">{title}</h1>
        {children}
    </div>
);
```
