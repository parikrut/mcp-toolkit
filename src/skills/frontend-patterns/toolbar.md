# Toolbar

> Pattern documentation for the filter / action toolbar rendered between the stats panel and the data table.

## 1. Component Pattern

The **Toolbar** is a domain-specific feature component that provides search,
filter, and action controls for a data-list page. It reads and writes URL query
state via `nuqs`, syncing user input bi-directionally with the browser address
bar. Optional domain actions (import wizards, create dialogs) are co-located
here as modals controlled by local `useState`.

## 2. Overview

The Toolbar sits between the [Stats Panel](stats-panel.md) and the
[Data Table](data-table.md) in the standard page composition (see
[master-page.md](master-page.md)). It has three zones:

| Zone        | Purpose                                         |
| ----------- | ----------------------------------------------- |
| **Search**  | Primary text search (`SearchInput`)             |
| **Filters** | Domain-specific selectors (`Input`, `Select`)   |
| **Actions** | Buttons for bulk actions, import, clear filters |

All filter values are managed as URL search parameters via `nuqs` so that:

- The table can read the same URL state to derive its query.
- Filters are bookmarkable, shareable, and survive page refreshes.
- The Toolbar and the Table never need to share React state or props.

Filter enum options reference Zod schemas from `@civic/contracts` to stay in
sync with the backend (see [contract-schema.md](contract-schema.md)).

## 3. Rules

1. **Name convention:** `<Domain>Toolbar` (e.g. `PropertiesToolbar`).
   File lives at `src/features/<domain>/<domain>.toolbar.tsx`.
2. **Imports URL-state parsers from the sibling table file.** The parsers and
   options object are defined in `<domain>.table.tsx` and re-exported via the
   barrel (see [url-state.md](url-state.md) and [data-table.md](data-table.md)).
3. **Resets `page` to 1 on every filter change.** When any filter value changes,
   include `page: 1` in the `setQs` call to avoid viewing an empty page.
4. **Enum select options are a local static array.** Declare the options array
   at module scope (outside the component) to avoid re-allocations.
5. **Clear Filters button** resets all filters to their defaults (`""`, `null`)
   while setting `page: 1`.
6. **Modal state is local.** If the toolbar includes an action that opens a
   modal/wizard, manage the `open` boolean with `useState` and render the
   modal as a sibling inside a Fragment.
7. **Uses `@civic/ui` components:** `Button`, `SearchInput`, `Input`, `Select`.
   Icons from `lucide-react`.
8. **Flex-wrap layout:** `flex flex-wrap items-end gap-3` so controls reflow
   gracefully on smaller screens.

## 4. Structure

```
src/features/<domain>/<domain>.toolbar.tsx
├── import { useState } from "react"
├── import { Upload, X } from "lucide-react"
├── import { useQueryStates } from "nuqs"
├── import { Button, SearchInput, Input, Select } from "@civic/ui"
├── import { <EnumSchema> } from "@civic/contracts"
├── import { <domain>TableParsers, <domain>TableNuqsOptions } from "./<domain>.table"
├── import { <Optional>Modal } from "./<optional>-modal"
│
├── const enumOptions = [ { label, value }, … ]   // static, module-scope
│
└── export const <Domain>Toolbar = () => {
        const [qs, setQs] = useQueryStates(parsers, options)
        const [modalOpen, setModalOpen] = useState(false)

        return (
            <>
                <div className="flex flex-wrap items-end gap-3">
                    <SearchInput … onSearch={v => setQs({ search: v, page: 1 })} />
                    <Input … onChange={e => setQs({ field: e.target.value, page: 1 })} />
                    <Select … onChange={…} />
                    <Button variant="secondary" onClick={() => setQs({ …defaults, page: 1 })}>
                        <X /> Clear Filters
                    </Button>
                    <Button onClick={() => setModalOpen(true)}>
                        <Upload /> Primary Action
                    </Button>
                </div>
                <OptionalModal open={modalOpen} onClose={() => setModalOpen(false)} />
            </>
        )
    }
```

## 5. Example Implementation

```tsx
// src/features/properties/properties.toolbar.tsx
import { useState } from "react";
import { Upload, X } from "lucide-react";
import { useQueryStates } from "nuqs";
import { Button, SearchInput, Input, Select } from "@civic/ui";
import { PropertyClassSchema } from "@civic/contracts";
import { propertiesTableParsers, propertiesTableNuqsOptions } from "./properties.table";
import { AssessmentImportWizard } from "./assessment-import-wizard";

const propertyClassOptions = [
    { label: "Residential", value: "RESIDENTIAL" },
    { label: "Multi-Residential", value: "MULTI_RESIDENTIAL" },
    { label: "Commercial", value: "COMMERCIAL" },
    { label: "Industrial", value: "INDUSTRIAL" },
    { label: "Pipeline", value: "PIPELINE" },
    { label: "Farm", value: "FARM" },
    { label: "Managed Forest", value: "MANAGED_FOREST" },
];

export const PropertiesToolbar = () => {
    const [qs, setQs] = useQueryStates(propertiesTableParsers, propertiesTableNuqsOptions);
    const [importOpen, setImportOpen] = useState(false);

    return (
        <>
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-50">
                    <SearchInput
                        placeholder="Search by roll number…"
                        value={qs.rollNumber}
                        onSearch={(v) => setQs({ rollNumber: v, page: 1 })}
                    />
                </div>
                <div className="w-40">
                    <Input
                        label="Ward"
                        placeholder="Ward"
                        value={qs.ward}
                        onChange={(e) => setQs({ ward: e.target.value, page: 1 })}
                    />
                </div>
                <div className="w-48">
                    <Select
                        label="Property Class"
                        options={propertyClassOptions}
                        placeholder="All Classes"
                        value={qs.propertyClass ?? ""}
                        onChange={(e) => {
                            const parsed = PropertyClassSchema.safeParse(e.target.value);
                            setQs({
                                propertyClass: parsed.success ? parsed.data : null,
                                page: 1,
                            });
                        }}
                    />
                </div>
                <Button
                    variant="secondary"
                    onClick={() =>
                        setQs({
                            rollNumber: "",
                            ward: "",
                            propertyClass: null,
                            page: 1,
                        })
                    }
                >
                    <X className="mr-1 h-4 w-4" /> Clear Filters
                </Button>
                <Button className="font-semibold" onClick={() => setImportOpen(true)}>
                    <Upload className="mr-1.5 h-4 w-4" />
                    Import MPAC Roll
                </Button>
            </div>
            <AssessmentImportWizard open={importOpen} onClose={() => setImportOpen(false)} />
        </>
    );
};
```
