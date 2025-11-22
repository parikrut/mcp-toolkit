# Chart Component

> Pattern documentation for Recharts-based data visualisation components used in dashboards and report pages.

## 1. Component Pattern

A **Chart Component** is a presentational wrapper around the `recharts`
library. It receives pre-fetched data as a prop, configures the chart type
(Bar, Line, Pie, etc.), and renders inside a `ResponsiveContainer`. Charts
are theme-aware — they use CSS custom property references (`var(--color-*)`)
for colours so they automatically adapt to light/dark mode.

## 2. Overview

Charts live in a shared `components/charts/` directory and are consumed by
the [Dashboard Page](dashboard-page.md) and report pages. They are not
domain-specific — they render whatever data shape they receive.

| Aspect            | Convention                                        |
| ----------------- | ------------------------------------------------- |
| **Library**       | `recharts` (React wrappers around D3)             |
| **Container**     | `ResponsiveContainer width="100%" height={320}`   |
| **Colours**       | CSS variables: `var(--color-nordic-blue)`, etc.   |
| **Tooltip**       | Custom `CustomTooltip` component for styling      |
| **Fallback data** | Optional: generate sample data when prop is empty |
| **Location**      | `src/components/charts/<name>-chart.tsx`          |

## 3. Rules

1. **Name convention:** `<name>-chart.tsx` in `src/components/charts/`.
   Component name: `<Name>Chart` (e.g. `RevenueTrendChart`).
2. **Data is a prop.** The chart never fetches data itself. The calling
   page/component passes data from a hook.
3. **Optional `data` prop.** When `undefined`, the chart may render sample
   data with an italic note "Sample data — API pending". This keeps the
   dashboard functional during development.
4. **`ResponsiveContainer`** must wrap the chart for fluid resizing.
   Set explicit `height` (typically 280-360px).
5. **CSS variable colours** — use `var(--color-nordic-blue)` etc. for
   fills and strokes so charts respect light/dark mode. Provide a fallback
   hex: `var(--color-nordic-blue, #5b7c99)`.
6. **Custom tooltip component** renders a styled container using theme
   tokens. Defined as a local component in the same file.
7. **Axis styling:** Use `fill: "var(--color-text-muted)"` for tick labels,
   `stroke: "var(--color-border)"` for grid lines. Remove axis lines
   (`axisLine={false}`) for cleaner look.
8. **Legend** uses `iconType="circle"` with small icon sizes (8px).
9. **Barrel export** from `components/charts/index.ts`.
10. **No business logic.** Charts are pure rendering components.

## 4. Structure

```
src/components/charts/
├── <name>-chart.tsx
│   ├── import { BarChart, Bar, XAxis, … } from "recharts"
│   ├── const CustomTooltip = (…) => (…)
│   ├── interface <Name>ChartProps { data?: DataType[]; className?: string }
│   └── export const <Name>Chart = ({ data, className }) => (
│           <ResponsiveContainer width="100%" height={320}>
│               <BarChart data={data ?? sampleData}>
│                   <CartesianGrid stroke="var(--color-border)" />
│                   <XAxis … />
│                   <YAxis … />
│                   <Tooltip content={<CustomTooltip />} />
│                   <Bar fill="var(--color-nordic-blue)" … />
│               </BarChart>
│           </ResponsiveContainer>
│       )
└── index.ts  ← barrel exports
```

## 5. Example Implementation

```tsx
// src/components/charts/revenue-trend-chart.tsx
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";

const formatMillions = (value: number) => `$${(value / 1_000_000).toFixed(0)}M`;

const CustomTooltip = ({
    active,
    payload,
    label,
}: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="rounded-lg bg-(--color-background) p-3 shadow-lg ring-1 ring-(--color-border)">
            <p className="mb-2 text-sm font-semibold text-(--color-text-primary)">{label}</p>
            {payload.map((entry) => (
                <p key={entry.name} className="text-xs text-(--color-text-muted)">
                    <span
                        className="mr-2 inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                    />
                    {entry.name}: {formatMillions(entry.value)}
                </p>
            ))}
        </div>
    );
};

interface RevenueTrendChartProps {
    data?: Array<{
        year: string;
        levied: number;
        collected: number;
        outstanding: number;
    }>;
    className?: string;
}

export const RevenueTrendChart = ({ data, className }: RevenueTrendChartProps) => {
    const chartData = data ?? []; // or sample data fallback

    return (
        <div className={className}>
            <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--color-border, #e2e8f0)"
                        vertical={false}
                    />
                    <XAxis
                        dataKey="year"
                        tick={{
                            fontSize: 12,
                            fill: "var(--color-text-muted, #64748b)",
                        }}
                        tickLine={false}
                    />
                    <YAxis
                        tickFormatter={formatMillions}
                        tick={{
                            fontSize: 12,
                            fill: "var(--color-text-muted, #64748b)",
                        }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" iconSize={8} />
                    <Bar
                        dataKey="levied"
                        name="Total Levied"
                        fill="var(--color-text-secondary, #475569)"
                        radius={[4, 4, 0, 0]}
                    />
                    <Bar
                        dataKey="collected"
                        name="Collected"
                        fill="var(--color-nordic-blue, #3b82f6)"
                        radius={[4, 4, 0, 0]}
                    />
                    <Bar
                        dataKey="outstanding"
                        name="Outstanding"
                        fill="var(--color-nordic-amber, #f59e0b)"
                        radius={[4, 4, 0, 0]}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
```
