# Stats Panel

> Pattern documentation for the KPI stats section displayed at the top of a data-list page.

## 1. Component Pattern

The **Stats Panel** is a domain-specific feature component that renders a
horizontal row of `StatCard` components inside a responsive grid. It fetches
its own data using a domain hook, derives aggregates via `useMemo`, and
renders the result inside a `ScrollReveal` animation wrapper.

## 2. Overview

Every data-list page can optionally include a Stats Panel to surface key
metrics at a glance. The panel:

- Uses the **same domain hook** as the table (see [data-hook.md](data-hook.md))
  to avoid duplicate API calls (TanStack Query deduplicates automatically).
- Derives computed values (counts, sums, percentages) from the response items
  using `useMemo`.
- Renders 1–4 `StatCard` components in a responsive grid
  (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`).
- Wraps the grid in `ScrollReveal` for a scroll-triggered entrance animation
  (see [nordic-styles.md](nordic-styles.md)).

This component is the **only** place where raw domain response data is
transformed into human-readable summary metrics for a page.

## 3. Rules

1. **Name convention:** `<Domain>Stats` (e.g. `PropertiesStats`).
   File lives at `src/features/<domain>/<domain>.stats.tsx`.
2. **Self-contained data fetching.** The component calls the domain list hook
   directly — it never receives data as props from the
   [Master Page](master-page.md).
3. **Derived values in `useMemo`.** All count / sum / percentage calculations
   must be memoised with the response items array as the dependency.
4. **Max 4 stat cards.** The responsive grid is designed for 4 columns at
   `lg` breakpoint. Exceeding 4 breaks the layout.
5. **Icons from `lucide-react`.** Each `StatCard` icon should be a 24 × 24
   Lucide icon wrapped in `aria-hidden="true"`.
6. **Exports from the feature barrel.** Re-export via
   `src/features/<domain>/index.ts` (see [barrel-exports.md](barrel-exports.md)).
7. **Uses `@civic/ui` shared components.** `StatCard` and `ScrollReveal` are
   imported from the design-system package.

## 4. Structure

```
src/features/<domain>/<domain>.stats.tsx
├── import { useMemo } from "react"
├── import { Icon1, Icon2, … } from "lucide-react"
├── import { StatCard, ScrollReveal } from "@civic/ui"
├── import { use<Domain> } from "../../hooks/use-<domain>"
├── import type { <Domain>Response } from "@civic/contracts"
│
└── export const <Domain>Stats = () => {
        const { data } = use<Domain>({ limit: 100 })
        const items = data?.items ?? []
        const total = data?.pagination?.totalItems ?? items.length

        const derived = useMemo(() => {
            // compute counts / aggregates from items
        }, [items])

        return (
            <ScrollReveal>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="…" value="…" icon={<Icon />} … />
                    <StatCard … />
                    <StatCard … />
                    <StatCard … />
                </div>
            </ScrollReveal>
        )
    }
```

**`StatCard` Props:**

| Prop         | Type                                    | Required | Description                     |
| ------------ | --------------------------------------- | -------- | ------------------------------- |
| `title`      | `string`                                | Yes      | Metric label                    |
| `value`      | `ReactNode`                             | Yes      | Metric value (usually a string) |
| `change`     | `string`                                | No       | Subtitle / context text         |
| `changeType` | `"positive" \| "negative" \| "neutral"` | No       | Colour hint for the change line |
| `icon`       | `ReactNode`                             | No       | Lucide icon element             |

## 5. Example Implementation

```tsx
// src/features/properties/properties.stats.tsx
import { useMemo } from "react";
import { Building2, Home, Briefcase, Factory } from "lucide-react";
import { StatCard, ScrollReveal } from "@civic/ui";
import { useProperties } from "../../hooks/use-properties";
import type { PropertyResponse } from "@civic/contracts";

export const PropertiesStats = () => {
    const { data } = useProperties({ limit: 100 });

    const items: PropertyResponse[] = data?.items ?? [];
    const total = data?.pagination?.totalItems ?? items.length;

    const classCounts = useMemo(() => {
        const residential = items.filter((p) => p.propertyClass === "RESIDENTIAL").length;
        const commercial = items.filter(
            (p) => p.propertyClass === "COMMERCIAL" || p.propertyClass === "INDUSTRIAL",
        ).length;
        const farm = items.filter(
            (p) => p.propertyClass === "FARM" || p.propertyClass === "MANAGED_FOREST",
        ).length;
        return { residential, commercial, farm };
    }, [items]);

    return (
        <ScrollReveal>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Properties"
                    value={String(total)}
                    change="All registered"
                    changeType="positive"
                    icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
                />
                <StatCard
                    title="Residential"
                    value={String(classCounts.residential)}
                    change="Residential class"
                    changeType="positive"
                    icon={<Home className="h-6 w-6" aria-hidden="true" />}
                />
                <StatCard
                    title="Commercial / Industrial"
                    value={String(classCounts.commercial)}
                    change="Business properties"
                    changeType="positive"
                    icon={<Briefcase className="h-6 w-6" aria-hidden="true" />}
                />
                <StatCard
                    title="Farm / Managed Forest"
                    value={String(classCounts.farm)}
                    change="Agricultural class"
                    changeType="positive"
                    icon={<Factory className="h-6 w-6" aria-hidden="true" />}
                />
            </div>
        </ScrollReveal>
    );
};
```
