# Detail Modal

> Pattern documentation for read-only modal dialogs that display a single entity's details.

## 1. Component Pattern

A **Detail Modal** is a feature component rendered inside a `Modal` from
`@civic/ui`. It receives an entity (or entity ID) as a prop, fetches
additional data if needed, and displays fields in a card-based
key-value layout. It is read-only — edit/delete actions are handled by
separate [Form](form.md) or [Action Dialog](action-dialog.md) components.

## 2. Overview

Detail Modals are opened from a [Data Table](data-table.md) row click or an
action button. They provide a quick-look view without navigating away from the
list page.

| Zone             | Content                                              |
| ---------------- | ---------------------------------------------------- |
| **Grid header**  | Key fields (`DetailRow` pairs) in a 2-column grid    |
| **Sub-sections** | Related data cards (instalments, line items, etc.)   |
| **Footer**       | Close button, optional action buttons (email, print) |

Some modals receive the full entity as a prop (pre-fetched by the parent).
Others receive only an `entityId` and fetch details internally via a hook.

## 3. Rules

1. **Name convention:** `<entity>-detail-modal.tsx` in the feature folder.
   Component name: `<Entity>DetailModal`.
2. **Props:** Either `{ entity: EntityResponse; onClose }` or
   `{ entityId: string; onClose }` when the modal fetches its own data.
3. **Loading / Error states** — if fetching internally, show `<Spinner />`
   for loading and an error message + Close button for errors.
4. **`DetailRow` helper** renders key-value pairs. It can accept `string`
   or `ReactNode` for the value (e.g. `Badge`, formatted currency).
5. **Status badge mapping** — define a `statusVariant` map at module scope
   that maps enum values to `BadgeVariant` strings.
6. **Format helpers** — use `formatCurrency`, `formatAddress`,
   `toLocaleDateString("en-CA")` for consistent display.
7. **Close button** is always present in `flex justify-end pt-2`.
8. **Optional actions** (e.g. email bill, print receipt) use domain mutation
   hooks with toast feedback.
9. **No form inputs** — this is a read-only component. Use [Form](form.md)
   or [Action Dialog](action-dialog.md) for mutations.
10. **Exported from feature barrel** `index.ts`.

## 4. Structure

```
src/features/<domain>/<entity>-detail-modal.tsx
├── import { Badge, Card, Spinner, Button, formatCurrency } from "@civic/ui"
├── import { use<Entity> } from "../../hooks/…"
├── import type { <Entity>Response } from "@civic/contracts"
│
├── const statusVariant: Record<Status, BadgeVariant> = { … }
│
├── interface <Entity>DetailModalProps {
│       entityId: string | entity: EntityResponse
│       onClose: () => void
│   }
│
└── export const <Entity>DetailModal = ({ … }) => {
        const { data, isLoading } = use<Entity>(entityId)  // if fetching

        if (isLoading) return <Spinner />
        if (!data) return <ErrorState + Close />

        return (
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <DetailRow label="…" value={…} />
                    <DetailRow label="Status" value={<Badge … />} />
                </div>
                {/* Optional sub-section */}
                <Card title="…">…</Card>
                <div className="flex justify-end pt-2">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </div>
            </div>
        )
    }
```

## 5. Example Implementation

```tsx
// src/features/appeals/appeal-detail-modal.tsx
import { Badge, Card, Button, formatCurrency, type BadgeVariant } from "@civic/ui";
import type { AppealResponse } from "@civic/contracts";

const statusVariant = (s: string): BadgeVariant => {
    const map: Record<string, BadgeVariant> = {
        FILED: "draft",
        IN_REVIEW: "generated",
        SCHEDULED: "mailed",
        DECIDED: "paid",
        WITHDRAWN: "partial",
    };
    return map[s] ?? "draft";
};

interface AppealDetailModalProps {
    appeal: AppealResponse;
    onClose: () => void;
}

export const AppealDetailModal = ({ appeal, onClose }: AppealDetailModalProps) => {
    return (
        <div className="space-y-4">
            <Card title="Appeal Details">
                <div className="grid grid-cols-2 gap-4 p-4">
                    <DetailRow label="Roll Number" value={appeal.rollNumber} mono />
                    <DetailRow label="Tax Year" value={String(appeal.taxYear)} />
                    <DetailRow
                        label="Status"
                        value={
                            <Badge variant={statusVariant(appeal.status)}>
                                {appeal.status
                                    .charAt(0)
                                    .concat(
                                        appeal.status.slice(1).toLowerCase().replace(/_/g, " "),
                                    )}
                            </Badge>
                        }
                    />
                    <DetailRow label="Grounds" value={appeal.grounds} />
                    <DetailRow
                        label="Requested Reduction"
                        value={
                            appeal.requestedReduction
                                ? formatCurrency(appeal.requestedReduction.amount)
                                : "—"
                        }
                    />
                    <DetailRow
                        label="Filing Date"
                        value={new Date(appeal.createdAt).toLocaleDateString("en-CA")}
                    />
                </div>
            </Card>

            {appeal.decision && (
                <Card title="Decision">
                    <div className="grid grid-cols-2 gap-4 p-4">
                        <DetailRow label="Decision" value={appeal.decision} />
                        <DetailRow
                            label="Revised CVA"
                            value={
                                appeal.revisedCva ? formatCurrency(appeal.revisedCva.amount) : "—"
                            }
                        />
                    </div>
                </Card>
            )}

            <div className="flex justify-end pt-2">
                <Button variant="secondary" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    );
};

const DetailRow = ({
    label,
    value,
    mono,
}: {
    label: string;
    value: React.ReactNode;
    mono?: boolean;
    fullWidth?: boolean;
}) => (
    <div>
        <dt className="text-xs text-text-muted">{label}</dt>
        <dd className={`text-sm font-medium text-text-primary ${mono ? "font-mono" : ""}`}>
            {value}
        </dd>
    </div>
);
```
