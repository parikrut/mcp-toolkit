# URL State

> Pattern documentation for managing page filters and pagination as URL search parameters via `nuqs`.

## 1. Component Pattern

**URL State** is the pattern of storing all filter, pagination, and sort values
as URL search parameters instead of React state. The `nuqs` library provides
type-safe parsers that serialise/deserialise values to and from the query string.
Parsers are defined once in the [Data Table](data-table.md) file and shared with
the [Toolbar](toolbar.md) via imports.

## 2. Overview

Using URL state instead of `useState` provides:

- **Bookmarkable views** — a filtered, paginated table state is captured in the URL.
- **Shareable links** — colleagues can share a URL with the exact same filters.
- **Browser navigation** — Back / Forward buttons restore previous filter states.
- **No prop drilling** — the Toolbar and Table both call `useQueryStates(parsers)`
  independently; they sync through the URL.
- **SSR-safe** — the URL is the state; there is no hydration mismatch risk.

`nuqs` parsers are analogous to Zod schemas for URL values: they define the
type, default value, and serialisation format for each parameter.

## 3. Rules

1. **Parsers are defined in the table file** (`<domain>.table.tsx`) and
   exported for the toolbar to import. This makes the table the
   "schema owner" for URL state.
2. **Every filter has a default value.** Use `.withDefault(…)` on every
   parser so missing query params resolve to sensible defaults.
3. **Use the correct parser for the type:**
    - `parseAsString` — free text fields.
    - `parseAsInteger` — `page`, `limit`.
    - `parseAsStringLiteral(schema.options)` — Zod enum values.
4. **Options object:** `{ history: "push" }` so every filter change creates
   a history entry (user can press Back to undo).
5. **Reset `page` to 1** whenever a non-page filter changes. Include
   `page: 1` in every `setQs()` call that modifies filters.
6. **Null vs empty string:** Enum filters use `null` for "no selection"
   (removes the param from the URL). Text filters use `""`.
7. **Naming convention:** Export as `<domain>TableParsers` and
   `<domain>TableNuqsOptions` (camelCase).

## 4. Structure

```
// Defined in: src/features/<domain>/<domain>.table.tsx

export const <domain>TableParsers = {
    page:          parseAsInteger.withDefault(1),
    limit:         parseAsInteger.withDefault(20),
    <textFilter>:  parseAsString.withDefault(""),
    <enumFilter>:  parseAsStringLiteral(<EnumSchema>.options),
    // Add more filters as needed
}

export const <domain>TableNuqsOptions = {
    history: "push" as const,
}
```

**Usage in Toolbar:**

```tsx
import { <domain>TableParsers, <domain>TableNuqsOptions } from "./<domain>.table";
const [qs, setQs] = useQueryStates(<domain>TableParsers, <domain>TableNuqsOptions);
```

**Usage in Table:**

```tsx
const [qs, setQs] = useQueryStates(<domain>TableParsers, <domain>TableNuqsOptions);
const { data } = use<Domain>({ ...qs });
```

**Parser Type Reference:**

| Parser                    | URL Representation   | TypeScript Type    |
| ------------------------- | -------------------- | ------------------ |
| `parseAsString`           | `?field=value`       | `string`           |
| `parseAsInteger`          | `?page=2`            | `number`           |
| `parseAsStringLiteral(…)` | `?class=RESIDENTIAL` | union literal type |
| `parseAsBoolean`          | `?active=true`       | `boolean`          |
| `parseAsFloat`            | `?amount=12.5`       | `number`           |

## 5. Example Implementation

```tsx
// Defined in: src/features/properties/properties.table.tsx
import { parseAsInteger, parseAsString, parseAsStringLiteral } from "nuqs";
import { PropertyClassSchema } from "@myorg/contracts";

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
```

**Toolbar consuming the parsers:**

```tsx
// src/features/properties/properties.toolbar.tsx
import { useQueryStates } from "nuqs";
import { propertiesTableParsers, propertiesTableNuqsOptions } from "./properties.table";

const [qs, setQs] = useQueryStates(propertiesTableParsers, propertiesTableNuqsOptions);

// Update a filter (always reset page to 1)
setQs({ ward: "3", page: 1 });

// Clear all filters
setQs({ rollNumber: "", ward: "", propertyClass: null, page: 1 });
```
