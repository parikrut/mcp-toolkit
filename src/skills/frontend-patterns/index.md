# Frontend Patterns

> Canonical reference for building pages and features in the Civic Modules frontend.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

Every data-list page (properties, tax accounts, permits, etc.) follows an
identical composition model. The **Master Page** is a thin orchestrator that
composes a **Page Layout** shell with three feature slices: **Stats Panel**,
**Toolbar**, and **Data Table**. Data flows from the API through **Contract
Schemas**, an **API Service**, and domain **Data Hooks** — never via props
from the page. Filter state lives in the **URL** via `nuqs`. Visuals follow
the **Nordic minimal** design system.

```
┌──────────────────────────────────────────────────────────┐
│  Master Page                                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Page Layout (title + space-y-6)                   │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  Stats Panel  (KPI cards, ScrollReveal)      │  │  │
│  │  ├──────────────────────────────────────────────┤  │  │
│  │  │  Toolbar  (search, filters, actions)         │  │  │
│  │  ├──────────────────────────────────────────────┤  │  │
│  │  │  Data Table  (columns, pagination, row nav)  │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
          │               │               │
      URL State      Data Hooks      Contracts
       (nuqs)     (TanStack Query)  (@civic/contracts)
          │               │               │
          └───────┬───────┘               │
                  ▼                       │
            API Service  ◄────────────────┘
             (Axios)
```

## Pattern Documents

| #   | Pattern                                  | Description                                 |
| --- | ---------------------------------------- | ------------------------------------------- |
| 1   | [master-page.md](master-page.md)         | Top-level page component — composition only |
| 2   | [page-layout.md](page-layout.md)         | Shared layout shell (h1 + spacing)          |
| 3   | [stats-panel.md](stats-panel.md)         | KPI stat cards with scroll-reveal animation |
| 4   | [toolbar.md](toolbar.md)                 | Search, filters, and action buttons         |
| 5   | [data-table.md](data-table.md)           | Paginated data grid with URL-state columns  |
| 6   | [nordic-styles.md](nordic-styles.md)     | Design tokens, dark mode, animations        |
| 7   | [data-hook.md](data-hook.md)             | TanStack Query hooks per domain entity      |
| 8   | [api-service.md](api-service.md)         | Axios client, Zod validation, typed queries |
| 9   | [contract-schema.md](contract-schema.md) | Zod API contracts shared frontend ↔ backend |
| 10  | [url-state.md](url-state.md)             | `nuqs` parsers for URL search parameters    |
| 11  | [barrel-exports.md](barrel-exports.md)   | `index.ts` module boundaries                |
| 12  | [form.md](form.md)                       | Create / edit forms with react-hook-form    |

### Page-Level Patterns

| #   | Pattern                                | Description                                 |
| --- | -------------------------------------- | ------------------------------------------- |
| 13  | [detail-page.md](detail-page.md)       | Single-entity detail page with related data |
| 14  | [dashboard-page.md](dashboard-page.md) | Aggregation page — stats, charts, actions   |
| 15  | [wizard.md](wizard.md)                 | Multi-step wizard flow with StepIndicator   |

### Feature-Level Patterns

| #   | Pattern                                  | Description                          |
| --- | ---------------------------------------- | ------------------------------------ |
| 16  | [detail-modal.md](detail-modal.md)       | Read-only entity detail modal        |
| 17  | [action-dialog.md](action-dialog.md)     | Confirm / action mutation dialogs    |
| 18  | [chart-component.md](chart-component.md) | Recharts data-visualisation wrappers |

### Infrastructure Patterns

| #   | Pattern                                            | Description                                 |
| --- | -------------------------------------------------- | ------------------------------------------- |
| 19  | [app-shell-router.md](app-shell-router.md)         | Provider stack, lazy routing, layout shell  |
| 20  | [auth-protected-route.md](auth-protected-route.md) | Auth context, login flow, role-based guards |
| 21  | [toast-system.md](toast-system.md)                 | Toast notification context and emitter      |

## File Map (Properties example)

```
apps/property-tax-web/src/
├── main.tsx                        → app-shell-router.md
├── App.tsx                         → app-shell-router.md, auth-protected-route.md
├── pages/
│   ├── properties.tsx              → master-page.md
│   ├── property-detail.tsx         → detail-page.md
│   ├── dashboard.tsx               → dashboard-page.md
│   ├── payment-wizard.tsx          → wizard.md
│   ├── login.tsx                   → auth-protected-route.md
│   └── settings.tsx                → form.md
├── components/layout/
│   ├── app-layout.tsx              → app-shell-router.md
│   ├── sidebar.tsx                 → app-shell-router.md
│   ├── page-layout.tsx             → page-layout.md
│   └── index.ts                    → barrel-exports.md
├── components/charts/
│   ├── revenue-trend-chart.tsx     → chart-component.md
│   └── index.ts                    → barrel-exports.md
├── features/properties/
│   ├── properties.stats.tsx        → stats-panel.md
│   ├── properties.toolbar.tsx      → toolbar.md
│   ├── properties.table.tsx        → data-table.md, url-state.md
│   └── index.ts                    → barrel-exports.md
├── features/<domain>/
│   ├── <entity>-form.tsx           → form.md
│   ├── <entity>-decision-form.tsx  → form.md
│   ├── <entity>-detail-modal.tsx   → detail-modal.md
│   ├── <entity>-action-dialogs.tsx → action-dialog.md
│   └── index.ts                    → barrel-exports.md
├── features/payment-wizard/
│   ├── property-search-step.tsx    → wizard.md
│   ├── confirm-step.tsx            → wizard.md
│   └── index.ts                    → barrel-exports.md
├── hooks/
│   ├── use-properties.ts           → data-hook.md
│   └── use-toast.tsx               → toast-system.md
├── services/
│   └── api.ts                      → api-service.md
├── lib/
│   ├── auth-context.tsx            → auth-protected-route.md
│   ├── parse-response.ts           → api-service.md
│   └── use-typed-query.ts          → api-service.md
└── index.css                       → nordic-styles.md

packages/
├── contracts/src/contracts/revenue/
│   └── property.contract.ts        → contract-schema.md
└── ui/src/
    ├── styles/theme.css            → nordic-styles.md
    └── components/                 → (design system)
```

## Quick-Start: Creating a New Data-List Page

1. **Define the contract** in `packages/contracts` following [contract-schema.md](contract-schema.md).
2. **Create the data hook** in `src/hooks/use-<domain>.ts` following [data-hook.md](data-hook.md).
3. **Build the table** in `src/features/<domain>/<domain>.table.tsx` following [data-table.md](data-table.md) and [url-state.md](url-state.md).
4. **Build the toolbar** in `src/features/<domain>/<domain>.toolbar.tsx` following [toolbar.md](toolbar.md).
5. **Build the stats** in `src/features/<domain>/<domain>.stats.tsx` following [stats-panel.md](stats-panel.md).
6. **Create the barrel** in `src/features/<domain>/index.ts` following [barrel-exports.md](barrel-exports.md).
7. **Compose the page** in `src/pages/<domain>.tsx` following [master-page.md](master-page.md).
8. **Add the route** to the router following [app-shell-router.md](app-shell-router.md).

## Quick-Start: Creating a New Detail Page

1. **Ensure the data hook** has a single-entity fetch (e.g. `use<Domain>(id)`) following [data-hook.md](data-hook.md).
2. **Create the page** at `src/pages/<domain>-detail.tsx` following [detail-page.md](detail-page.md).
3. **Create the edit form** at `src/features/<domain>/<domain>-edit-form.tsx` following [form.md](form.md).
4. **Add the `:id` route** as a child of the protected layout in [app-shell-router.md](app-shell-router.md).

## Quick-Start: Creating a Wizard

1. **Create step components** in `src/features/<workflow>/` following [wizard.md](wizard.md).
2. **Create the wizard page** at `src/pages/<workflow>.tsx` with `StepIndicator` + step state.
3. **Create the mutation hook** in `src/hooks/` following [data-hook.md](data-hook.md).
4. **Add the route** to the router.
