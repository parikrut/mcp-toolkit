# Master Page

> Pattern documentation for the top-level page component that composes an entire data-list view.

## 1. Component Pattern

The **Master Page** is a thin orchestrator. It imports a shared layout shell and
domain-specific feature slices, then composes them in a declarative, predictable
order. It contains **zero business logic**, **no local state**, and **no hooks**.
Its only job is to declare _what_ appears on the page and _in which order_.

## 2. Overview

Every data-list page in the application follows an identical composition recipe:

| Slot         | Responsibility                           | Related Pattern                            |
| ------------ | ---------------------------------------- | ------------------------------------------ |
| `PageLayout` | Chrome (heading, spacing)                | [page-layout.md](page-layout.md)           |
| `Stats`      | High-level KPI cards                     | [stats-panel.md](stats-panel.md)           |
| `Toolbar`    | Filters, search, actions                 | [toolbar.md](toolbar.md)                   |
| `Table`      | Paginated data grid                      | [data-table.md](data-table.md)             |
| Modals       | Optional overlays (wizards, forms, etc.) | Rendered inside Toolbar or Table as needed |

The Master Page does **not** provide data to children — each child fetches its
own data via domain hooks (see [data-hook.md](data-hook.md)). This keeps the
page trivially composable and eliminates prop-drilling.

## 3. Rules

1. **One file per page.** The file lives at `src/pages/<domain>.tsx` and is
   named after the domain in kebab-case (e.g. `properties.tsx`, `tax-accounts.tsx`).
2. **Imports only from two places:** `../features/<domain>` and
   `../components/layout`. Feature imports come from the barrel `index.ts`.
3. **No hooks, no state, no effects.** The page is a pure function of its
   composition — a stateless functional component returning JSX.
4. **Child ordering is fixed:** `Stats → Toolbar → Table → (Modals)`.
   Deviating from this order breaks the visual rhythm and UX consistency.
5. **Export a named const** (e.g. `PropertiesPage`). Use PascalCase with
   the domain name followed by `Page`.
6. **No inline styles or Tailwind classes.** All visual concerns are
   delegated to `PageLayout` and the child components.

## 4. Structure

```
src/pages/<domain>.tsx
├── import { <Domain>Stats, <Domain>Table, <Domain>Toolbar } from "../features/<domain>"
├── import { PageLayout } from "../components/layout"
└── export const <Domain>Page = () => (
        <PageLayout title="<Human-readable Title>">
            <DomainStats />
            <DomainToolbar />
            <DomainTable />
        </PageLayout>
    )
```

**Dependency Graph:**

```
<Domain>Page
  ├── PageLayout          →  see page-layout.md
  ├── <Domain>Stats       →  see stats-panel.md
  ├── <Domain>Toolbar     →  see toolbar.md
  └── <Domain>Table       →  see data-table.md
```

## 5. Example Implementation

```tsx
// src/pages/properties.tsx
import { PropertiesStats, PropertiesTable, PropertiesToolbar } from "../features/properties";
import { PageLayout } from "../components/layout";

export const PropertiesPage = () => (
    <PageLayout title="Properties">
        <PropertiesStats />
        <PropertiesToolbar />
        <PropertiesTable />
    </PageLayout>
);
```
