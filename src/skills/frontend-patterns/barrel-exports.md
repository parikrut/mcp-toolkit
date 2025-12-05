# Barrel Exports

> Pattern documentation for barrel `index.ts` files that control the public API of each module.

## 1. Component Pattern

A **Barrel Export** is an `index.ts` file that re-exports the public symbols
from a directory. It acts as the module boundary — consumers import from the
directory path, never from individual files. This allows internal refactoring
without breaking external imports.

## 2. Overview

The application uses barrels at two levels:

| Barrel Location                   | What it re-exports                       |
| --------------------------------- | ---------------------------------------- |
| `src/features/<domain>/index.ts`  | Feature components + URL-state parsers   |
| `src/components/layout/index.ts`  | Layout shell components                  |
| `packages/ui/src/index.ts`        | All design-system components + utilities |
| `packages/contracts/src/index.ts` | All contract schemas + types             |

The [Master Page](master-page.md) imports exclusively via barrels:

```tsx
import { PropertiesStats, PropertiesTable, PropertiesToolbar } from "../features/properties";
import { PageLayout } from "../components/layout";
```

## 3. Rules

1. **Every `features/<domain>/` directory must have an `index.ts`.**
2. **Export only public symbols.** Internal helpers (private utilities,
   sub-components not meant for direct import) are omitted.
3. **Named exports only.** No default exports — ever.
4. **Re-export URL-state parsers** (`<domain>TableParsers`,
   `<domain>TableNuqsOptions`) from the barrel so the toolbar can import
   them from the same path.
5. **Layout barrel** (`components/layout/index.ts`) exports `AppLayout`,
   `Header`, `PageLayout`, `Sidebar`.
6. **Package barrels** (`@myorg/ui`, `@myorg/contracts`) use
   `export * from "./…"` chains to flatten the public surface.
7. **Order exports alphabetically** within the barrel for easy scanning.

## 4. Structure

```
src/features/<domain>/index.ts
├── export { <Domain>Stats }            from "./<domain>.stats"
├── export { <Domain>Table,
│            <domain>TableParsers,
│            <domain>TableNuqsOptions } from "./<domain>.table"
└── export { <Domain>Toolbar }          from "./<domain>.toolbar"
```

```
src/components/layout/index.ts
├── export { AppLayout }  from "./app-layout"
├── export { Header }     from "./header"
├── export { PageLayout } from "./page-layout"
└── export { Sidebar }    from "./sidebar"
```

## 5. Example Implementation

**Feature barrel:**

```tsx
// src/features/properties/index.ts
export {
    PropertiesTable,
    propertiesTableParsers,
    propertiesTableNuqsOptions,
} from "./properties.table";
export { PropertiesToolbar } from "./properties.toolbar";
export { PropertiesStats } from "./properties.stats";
export { AssessmentImportWizard } from "./assessment-import-wizard";
```

**Layout barrel:**

```tsx
// src/components/layout/index.ts
export { AppLayout } from "./app-layout";
export { Header } from "./header";
export { PageLayout } from "./page-layout";
export { Sidebar } from "./sidebar";
```

**UI package barrel (abbreviated):**

```tsx
// packages/ui/src/index.ts
export { Button, type ButtonProps } from "./components/button";
export { DataTable, type Column } from "./components/data-table";
export { Input } from "./components/input";
export { SearchInput } from "./components/search-input";
export { Select, type SelectOption } from "./components/select";
export { StatCard } from "./components/stat-card";
export { ScrollReveal } from "./components/scroll-reveal";
export { formatCurrency, formatAddress, formatFullAddress } from "./utils/format";
```
