# Dashboard Page

> Pattern documentation for the aggregation dashboard that combines stats, charts, tables, and quick actions.

## 1. Component Pattern

The **Dashboard Page** is a standalone page that aggregates data from multiple
domain hooks into a single overview. Unlike a [Master Page](master-page.md)
which composes exactly one domain's stats + toolbar + table, the Dashboard
pulls from several domains (properties, bills, payments, analytics) and
renders a mixed layout of stat cards, chart components, embedded data tables,
and quick-action buttons.

## 2. Overview

The dashboard is the application's landing page. It follows a scrollable
vertical layout with distinct visual rows:

| Row | Content                                          |
| --- | ------------------------------------------------ |
| 1   | KPI stat cards (4-up grid with `ScrollReveal`)   |
| 2   | Charts — large chart + smaller chart (3:1 grid)  |
| 3   | Charts — two equal-width charts (2-up grid)      |
| 4   | Full-width chart or table                        |
| 5   | Recent data table + Quick action card (3:1 grid) |

Each row is wrapped in `ScrollReveal` for staggered entrance animations
(see [nordic-styles.md](nordic-styles.md)). Charts live in a dedicated
`components/charts/` directory and are wrapped inside `Card` components.

## 3. Rules

1. **File lives at `src/pages/dashboard.tsx`.** Named export: `DashboardPage`.
2. **Fetches from multiple domain hooks.** Each hook call is independent;
   TanStack Query parallelises them automatically.
3. **Analytics hooks** (e.g. `useTaxationSummary`, `useRevenueTrend`) return
   pre-aggregated data from dedicated analytics endpoints.
4. **Loading state is combined:** `const isLoading = aLoading || bLoading`.
   Error state shows a full-page error message.
5. **Stat cards use `AnimatedCounter`** for numeric values that animate on
   mount.
6. **Charts are separate components** in `src/components/charts/`. Each
   chart accepts a `data` prop and uses `recharts` internally.
7. **Chart components accept optional `data` prop.** When `undefined`, they
   render sample/placeholder data with an italic note.
8. **Embedded `DataTable`** can be used for "recent items" panels. Define
   columns at module scope, pass sliced data.
9. **Quick Actions card** renders `Button` components that navigate to key
   workflows (e.g. generate bills, import data, new payment).
10. **All grid layouts** use Tailwind responsive classes:
    `grid-cols-1 xl:grid-cols-3`, `lg:grid-cols-2`, etc.
11. **No toolbar or URL state** — the dashboard is a read-only view.

## 4. Structure

```
src/pages/dashboard.tsx
├── import hooks: use<Domain>(), useAnalytics…()
├── import charts: from "../components/charts"
├── import { StatCard, ScrollReveal, AnimatedCounter, Card, DataTable, Button } from "@civic/ui"
│
├── const recentColumns: Column<T>[] = […]
│
└── export const DashboardPage = () => {
        // Multiple domain + analytics queries
        const { data: a } = useHookA()
        const { data: b } = useHookB()
        …

        return (
            <div className="space-y-8">
                <h1>Dashboard</h1>

                {/* Row 1: Stat Cards */}
                <ScrollReveal>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard … />
                    </div>
                </ScrollReveal>

                {/* Row 2: Charts */}
                <ScrollReveal>
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                        <Card className="xl:col-span-2"><Chart1 /></Card>
                        <Card><Chart2 /></Card>
                    </div>
                </ScrollReveal>

                {/* Row N: Recent + Quick Actions */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <Card className="lg:col-span-2" noPadding>
                        <DataTable columns={…} data={…} />
                    </Card>
                    <Card title="Quick Actions">
                        <Button … /> …
                    </Card>
                </div>
            </div>
        )
    }
```

**Chart component folder:**

```
src/components/charts/
├── revenue-trend-chart.tsx
├── collection-rate-chart.tsx
├── property-class-chart.tsx
├── payment-methods-chart.tsx
├── top-delinquent-chart.tsx
└── index.ts                  ← barrel exports
```

## 5. Example Implementation

```tsx
// src/pages/dashboard.tsx (abbreviated)
import { Building2, DollarSign, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router";
import {
    StatCard,
    ScrollReveal,
    AnimatedCounter,
    Card,
    Button,
    DataTable,
    formatCurrency,
    type Column,
} from "@civic/ui";
import { useProperties, useTaxBills, useTaxationSummary, useRevenueTrend } from "../hooks";
import { RevenueTrendChart, PropertyClassChart } from "../components/charts";

export const DashboardPage = () => {
    const navigate = useNavigate();
    const currentYear = new Date().getFullYear();

    const { data: propertiesData, isLoading: propsLoading } = useProperties({
        limit: 1,
    });
    const { data: billsData, isLoading: billsLoading } = useTaxBills({
        limit: 5,
    });
    const { data: summaryData } = useTaxationSummary(currentYear);
    const { data: revenueTrendData } = useRevenueTrend();

    const totalProperties = propertiesData?.pagination?.totalItems ?? 0;
    const collectionRate = summaryData?.collectionRatePercent;

    return (
        <div className="space-y-8">
            <h1 className="text-2xl font-semibold text-text-primary">Dashboard</h1>

            {/* Row 1 — Stat Cards */}
            <ScrollReveal>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                        title="Total Properties"
                        value={<AnimatedCounter value={totalProperties.toLocaleString()} />}
                        change="From assessment roll"
                        changeType="positive"
                        icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
                    />
                    <StatCard
                        title="Collection Rate"
                        value={
                            <AnimatedCounter
                                value={
                                    collectionRate != null ? `${collectionRate.toFixed(1)}%` : "—"
                                }
                            />
                        }
                        changeType={
                            collectionRate != null && collectionRate >= 95 ? "positive" : "negative"
                        }
                        icon={<TrendingUp className="h-6 w-6" aria-hidden="true" />}
                    />
                </div>
            </ScrollReveal>

            {/* Row 2 — Charts */}
            <ScrollReveal>
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                    <Card
                        title="Revenue Trend"
                        description="Year-over-year (5-year)"
                        className="xl:col-span-2"
                    >
                        <RevenueTrendChart data={revenueTrendData} />
                    </Card>
                    <Card title="Property Class Distribution">
                        <PropertyClassChart />
                    </Card>
                </div>
            </ScrollReveal>

            {/* Row 3 — Quick Actions */}
            <ScrollReveal>
                <Card title="Quick Actions">
                    <div className="space-y-3">
                        <Button
                            variant="primary"
                            className="w-full justify-start gap-3"
                            onClick={() => navigate("/tax-bills")}
                        >
                            Generate Bills
                        </Button>
                        <Button
                            variant="secondary"
                            className="w-full justify-start gap-3"
                            onClick={() => navigate("/payments")}
                        >
                            New Payment
                        </Button>
                    </div>
                </Card>
            </ScrollReveal>
        </div>
    );
};
```
