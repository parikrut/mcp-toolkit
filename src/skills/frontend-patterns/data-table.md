# Data Table

> Pattern documentation for the paginated data grid displayed on a data-list page.

## 1. Component Pattern

The **Data Table** is a domain-specific feature component that defines URL-state
parsers, column definitions, and renders the shared `DataTable` component from
`@myorg/ui`. It owns the page's query-state contract (parsers + nuqs options)
which the [Toolbar](toolbar.md) also imports to stay in sync.

## 2. Overview

The Data Table file is the central feature file for a data-list page. It has
three distinct responsibilities co-located in one file:

| Section       | Purpose                                                      |
| ------------- | ------------------------------------------------------------ |
| **URL-state** | `nuqs` parsers that define every filter, page, and limit     |
| **Columns**   | Array of `Column<T>` definitions for the generic DataTable   |
| **Component** | Fetches data via the domain hook and renders `<DataTable />` |

The URL state parsers are exported so the [Toolbar](toolbar.md) can read and
write the same query parameters without shared React state. TanStack Query
handles deduplication when both Stats and Table call the same hook with the
same filters.

The generic `DataTable` from `@myorg/ui` handles loading skeletons, empty
states, error display, row click, and pagination controls.

## 3. Rules

1. **Name convention:** `<Domain>Table` (e.g. `PropertiesTable`).
   File lives at `src/features/<domain>/<domain>.table.tsx`.
2. **Export three things from the file:**
    - `<domain>TableParsers` — the `nuqs` parser map.
    - `<domain>TableNuqsOptions` — the nuqs options object (usually `{ history: "push" }`).
    - `<Domain>Table` — the React component.
3. **Parsers are the single source of truth for URL state.** Every filter,
   pagination, and sort parameter must be declared here. The
   [Toolbar](toolbar.md) imports them — never duplicates.
4. **Column definitions are a module-scope constant.** Defined outside the
   component as `const columns: Column<T>[]` to avoid re-allocation.
5. **Accessor can be a string key or a function.** Use a string for direct
   field access; use `(row) => …` for computed / formatted display values.
6. **`onRowClick` navigates to the detail page** using
   `useNavigate()` from `react-router`.
7. **Pagination is derived from the API response.** Pass `data.pagination`
   fields into the `pagination` prop; `onPageChange` calls
   `setQs({ page: p })`.
8. **Loading and empty states are delegated.** Pass `loading={isLoading}` and
   `emptyMessage="…"` — the shared `DataTable` renders the appropriate UI.
9. **Uses `@myorg/ui`:** `DataTable`, `Column`, `formatAddress` (or other
   format utilities). Domain types from `@myorg/contracts`.

## 4. Structure

```
src/features/<domain>/<domain>.table.tsx
│
├── // ── URL state parsers ──
│   export const <domain>TableParsers = {
│       page: parseAsInteger.withDefault(1),
│       limit: parseAsInteger.withDefault(20),
│       <filter>: parseAsString.withDefault(""),
│       <enumFilter>: parseAsStringLiteral(<EnumSchema>.options),
│   }
│   export const <domain>TableNuqsOptions = { history: "push" as const }
│
├── // ── Columns ──
│   const columns: Column<DomainResponse>[] = [
│       { header: "…", accessor: "fieldName" },
│       { header: "…", accessor: (row) => formatSomething(row.field) },
│   ]
│
└── // ── Component ──
    export const <Domain>Table = () => {
        const navigate = useNavigate()
        const [qs, setQs] = useQueryStates(parsers, options)
        const { data, isLoading } = use<Domain>({ …qs })

        return (
            <DataTable
                columns={columns}
                data={data?.items ?? []}
                loading={isLoading}
                emptyMessage="…"
                onRowClick={(row) => navigate(`/<domain>/${row.id}`)}
                pagination={data ? {
                    page: data.pagination.page,
                    totalPages: data.pagination.totalPages,
                    onPageChange: (p) => setQs({ page: p }),
                } : undefined}
            />
        )
    }
```

**`DataTable` Props:**

| Prop           | Type                                 | Required | Description                |
| -------------- | ------------------------------------ | -------- | -------------------------- |
| `columns`      | `Column<T>[]`                        | Yes      | Column header + accessor   |
| `data`         | `T[]`                                | Yes      | Row data array             |
| `loading`      | `boolean`                            | No       | Show skeleton rows         |
| `emptyMessage` | `string`                             | No       | Text when `data` is empty  |
| `onRowClick`   | `(row: T) => void`                   | No       | Handler for row navigation |
| `pagination`   | `{ page, totalPages, onPageChange }` | No       | Pagination controls        |
| `error`        | `string`                             | No       | Error banner               |
| `className`    | `string`                             | No       | Additional wrapper classes |

**`Column<T>` Shape:**

| Field       | Type                               | Description                  |
| ----------- | ---------------------------------- | ---------------------------- |
| `header`    | `string`                           | Column header text           |
| `accessor`  | `keyof T \| (row: T) => ReactNode` | Field key or render function |
| `className` | `string` (optional)                | Cell-level CSS class         |

## 5. Example Implementation

```tsx
// src/features/properties/properties.table.tsx
import { useNavigate } from "react-router";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { DataTable, formatAddress, type Column } from "@myorg/ui";
import { useProperties } from "../../hooks/use-properties";
import type { PropertyResponse as Property } from "@myorg/contracts";
import { PropertyClassSchema } from "@myorg/contracts";

// ─── URL state parsers ──────────────────────────────────────

export const propertiesTableParsers = {
    page: parseAsInteger.withDefault(1),
    limit: parseAsInteger.withDefault(20),
    rollNumber: parseAsString.withDefault(""),
    ward: parseAsString.withDefault(""),
    propertyClass: parseAsStringLiteral(PropertyClassSchema.options),
};

export const propertiesTableNuqsOptions = {
    history: "push" as const,
};

// ─── Columns ────────────────────────────────────────────────

const columns: Column<Property>[] = [
    {
        header: "Roll Number",
        accessor: "rollNumber",
        className: "font-mono",
    },
    {
        header: "Address",
        accessor: (row) => formatAddress(row.address),
    },
    {
        header: "Property Class",
        accessor: (row) =>
            row.propertyClass.charAt(0) +
            row.propertyClass.slice(1).toLowerCase().replace(/_/g, " "),
    },
    { header: "Ward", accessor: "ward" },
    { header: "Zoning", accessor: "zoning" },
];

// ─── Component ──────────────────────────────────────────────

export const PropertiesTable = () => {
    const navigate = useNavigate();
    const [qs, setQs] = useQueryStates(propertiesTableParsers, propertiesTableNuqsOptions);

    const { data, isLoading } = useProperties({
        rollNumber: qs.rollNumber || undefined,
        ward: qs.ward || undefined,
        propertyClass: qs.propertyClass ?? undefined,
        page: qs.page,
        limit: qs.limit,
    });

    return (
        <DataTable
            columns={columns}
            data={data?.items ?? []}
            loading={isLoading}
            emptyMessage="No properties found. Import an imported record to get started."
            onRowClick={(row) => navigate(`/properties/${row.id}`)}
            pagination={
                data
                    ? {
                          page: data.pagination.page,
                          totalPages: data.pagination.totalPages,
                          onPageChange: (p) => setQs({ page: p }),
                      }
                    : undefined
            }
        />
    );
};
```
