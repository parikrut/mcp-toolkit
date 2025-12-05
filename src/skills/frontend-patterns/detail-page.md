# Detail Page

> Pattern documentation for entity detail pages that display a single record with related data, edit/delete actions, and modal forms.

## 1. Component Pattern

The **Detail Page** is a domain-specific page component that fetches a single
entity by URL parameter (`useParams`), displays its fields in a multi-card
grid layout, loads related data (owners, assessments, bills, payments), and
provides edit/delete actions via modal forms. It handles loading, error, and
not-found states inline.

## 2. Overview

A Detail Page is the counterpart to a [Data-List Page](master-page.md). When a
user clicks a row in a [Data Table](data-table.md), they navigate to
`/<domain>/:id`, which renders the Detail Page.

| Zone              | Purpose                                                     |
| ----------------- | ----------------------------------------------------------- |
| **Header**        | Back button, entity title, badge, Edit / Delete buttons     |
| **Card grid**     | 2-column responsive grid of `Card` components               |
| **Primary card**  | Entity's own fields rendered as `DetailRow` key-value pairs |
| **Related cards** | Related data (assessments, owners, bills, payments, etc.)   |
| **Modals**        | Edit form + Delete confirmation, controlled by `useState`   |

The page fetches multiple queries in parallel: the primary entity by ID, plus
related entities by a linking field (e.g. `rollNumber`). Related queries are
conditionally enabled only once the primary entity loads.

## 3. Rules

1. **File lives at `src/pages/<domain>-detail.tsx`.** Named export:
   `<Domain>DetailPage`.
2. **`useParams<{ id: string }>()`** extracts the route parameter.
3. **Primary query is unconditional.** `use<Domain>(id)` fetches immediately.
4. **Related queries are conditional.** Enable related hooks only when the
   primary entity has loaded (e.g. `{ enabled: !!rollNumber }`).
5. **Three render states:** Loading (`<Spinner />`), Error/Not-found
   (error card + back button), and Success (card grid).
6. **Back button** navigates to the list page via `useNavigate()`.
7. **Edit/Delete use `Modal` from `@myorg/ui`.** Open state is controlled
   by local `useState<boolean>`. The modal renders an edit form or delete
   confirmation form as its children.
8. **`DetailRow` is a local helper component** — a `<div>` with `<dt>` (muted
   label) and `<dd>` (primary value) in a flex-between layout.
9. **Card grid** uses `grid grid-cols-1 gap-6 lg:grid-cols-2`.
10. **Header row** uses `flex items-center gap-4` with a `Badge` for status
    and action buttons aligned right.
11. **Related data lists** show up to 5 items with a summary row layout.
    Empty states display a centered muted message.
12. **Lazy-loaded via `App.tsx`** — the detail page is code-split with
    `lazy(() => import(...))`.

## 4. Structure

```
src/pages/<domain>-detail.tsx
├── import { useState } from "react"
├── import { useParams, useNavigate } from "react-router"
├── import { ArrowLeft, Edit, Trash2 } from "lucide-react"
├── import { Card, Badge, Button, Spinner, Modal, … } from "@myorg/ui"
├── import { use<Domain>, use<Related>… } from "../hooks"
├── import { <Domain>EditForm } from "../features/<domain>/…"
├── import { <Domain>DeleteForm } from "../features/<domain>/…"
│
└── export const <Domain>DetailPage = () => {
        const { id } = useParams<{ id: string }>()
        const navigate = useNavigate()
        const { data, isLoading, isError } = use<Domain>(id)
        const [editOpen, setEditOpen] = useState(false)
        const [deleteOpen, setDeleteOpen] = useState(false)

        // Related queries (conditional)
        const { data: related } = use<Related>({ … }, { enabled: !!data })

        if (isLoading) return <Spinner />
        if (isError || !data) return <ErrorState />

        return (
            <div className="space-y-8">
                {/* Header: back, title, badge, actions */}
                {/* Card grid */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <Card title="…"><dl>…DetailRows…</dl></Card>
                    <Card title="…">…related data…</Card>
                </div>
                {/* Modals */}
                <Modal open={editOpen} …><EditForm /></Modal>
                <Modal open={deleteOpen} …><DeleteForm /></Modal>
            </div>
        )
    }

    const DetailRow = ({ label, value }) => (…)
```

## 5. Example Implementation

```tsx
// src/pages/property-detail.tsx
import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Edit, Trash2 } from "lucide-react";
import {
    Card,
    Badge,
    Button,
    Spinner,
    Modal,
    formatCurrency,
    formatAddress,
    formatFullAddress,
} from "@myorg/ui";
import { useProperty, useOwners, useAssessments } from "../hooks";
import { PropertyEditForm } from "../features/properties/property-edit-form";
import { PropertyDeleteForm } from "../features/properties/property-delete.form";

export const PropertyDetailPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { data: property, isLoading, isError } = useProperty(id);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const rollNumber = property?.rollNumber;
    const { data: ownersData } = useOwners({ rollNumber }, { enabled: !!rollNumber });
    const { data: assessmentsData } = useAssessments({ rollNumber });
    const owner = ownersData?.items?.[0];
    const assessment = assessmentsData?.items?.[0];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Spinner size="lg" />
            </div>
        );
    }

    if (isError || !property) {
        return (
            <div className="space-y-4">
                <Button variant="ghost" onClick={() => navigate("/properties")}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Properties
                </Button>
                <div className="rounded-xl bg-(--color-nordic-rose)/10 p-8 text-center">
                    <p className="text-sm text-(--color-nordic-rose)">
                        Property not found or failed to load.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={() => navigate("/properties")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1">
                    <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                        {property.rollNumber}
                    </h2>
                    <p className="text-sm text-text-muted">{formatAddress(property.address)}</p>
                </div>
                <Badge variant="active">
                    {property.propertyClass
                        .charAt(0)
                        .concat(property.propertyClass.slice(1).toLowerCase().replace(/_/g, " "))}
                </Badge>
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                    <Edit className="mr-1.5 h-4 w-4" /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
            </div>

            {/* Card Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card title="Property Details">
                    <dl className="space-y-3">
                        <DetailRow label="Roll Number" value={property.rollNumber} />
                        <DetailRow label="Address" value={formatFullAddress(property.address)} />
                        <DetailRow label="Ward" value={property.ward ?? ""} />
                        <DetailRow label="Zoning" value={property.zoning ?? ""} />
                    </dl>
                </Card>

                <Card title="Current Assessment">
                    {assessment ? (
                        <dl className="space-y-3">
                            <DetailRow label="CVA" value={formatCurrency(assessment.cva.amount)} />
                            <DetailRow label="Tax Year" value={String(assessment.taxYear)} />
                        </dl>
                    ) : (
                        <div className="py-12 text-center text-sm text-text-muted">
                            No assessment data available.
                        </div>
                    )}
                </Card>

                <Card title="Owner Information">
                    {owner ? (
                        <dl className="space-y-3">
                            <DetailRow label="Name" value={owner.name} />
                            <DetailRow
                                label="Mailing Address"
                                value={formatFullAddress(owner.mailingAddress)}
                            />
                        </dl>
                    ) : (
                        <div className="py-12 text-center text-sm text-text-muted">
                            No owner data available.
                        </div>
                    )}
                </Card>
            </div>

            {/* Modals */}
            <Modal
                open={editOpen}
                onClose={() => setEditOpen(false)}
                title="Edit Property"
                size="lg"
            >
                <PropertyEditForm
                    property={property}
                    onSuccess={() => setEditOpen(false)}
                    onCancel={() => setEditOpen(false)}
                />
            </Modal>
            <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Property">
                <PropertyDeleteForm propertyId={property.id} onClose={() => setDeleteOpen(false)} />
            </Modal>
        </div>
    );
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-4">
        <dt className="text-sm text-text-muted">{label}</dt>
        <dd className="text-sm font-medium text-text-primary text-right">{value}</dd>
    </div>
);
```
