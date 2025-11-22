# Action Dialog

> Pattern documentation for confirmation/action modal dialogs that perform a single mutation with user input.

## 1. Component Pattern

An **Action Dialog** is a lightweight modal component that confirms or
collects minimal input for a single mutation (approve, reject, process,
cancel, waive, etc.). It combines `Modal` from `@civic/ui` with a small
form (1-2 inputs), a mutation hook, and toast feedback. Multiple related
action dialogs are co-located in a single file.

## 2. Overview

Action Dialogs are distinct from [Forms](form.md) in scope: a Form creates
or fully edits an entity, while an Action Dialog performs a state transition
or targeted operation (approve a refund, waive a penalty, cancel a plan).

| Part               | Description                                         |
| ------------------ | --------------------------------------------------- |
| **Modal wrapper**  | Uses `Modal` from `@civic/ui`, controlled by parent |
| **Context line**   | Brief summary of the entity being acted upon        |
| **Input(s)**       | 0-2 fields (reason, approver name, cheque number)   |
| **Action buttons** | Cancel + primary action button with loading state   |

Multiple dialogs that share the same entity type (e.g. Approve, Reject,
Process for Refunds) are defined in the same file as separate named
exports.

## 3. Rules

1. **Name convention:** `<entity>-action-dialogs.tsx` (plural when
   containing multiple related dialogs). Component names:
   `<Entity><Action>Dialog` (e.g. `RefundApproveDialog`).
2. **Props pattern:** `{ entity: T | null; onClose; onSuccess }`.
   The `entity | null` pattern lets the parent control open state:
   `open={!!entity}`.
3. **Validation is minimal.** Use simple `if (!value)` checks with
   `toast.error()` rather than `react-hook-form`. Only use
   `react-hook-form` for complex multi-field cases.
4. **Mutation is called inline** in the handler function. Use the same
   `mutation.mutate(payload, { onSuccess, onError })` pattern as
   [Form](form.md).
5. **Toast feedback is mandatory.** `toast.success()` on success,
   `toast.error()` with `extractApiError()` on failure.
6. **`onSuccess` callback** is called after mutation success to let the
   parent close the dialog and refresh data.
7. **Submit button shows loading state**: `disabled={mutation.isPending}`
   with a gerund label (e.g. "Approving…").
8. **Destructive actions** (reject, delete, cancel) use
   `variant="danger"` or a rose-coloured background on the button.
9. **Co-locate related dialogs.** If a domain has approve + reject +
   process actions, put them in one file with separate exports.
10. **Exported from feature barrel** `index.ts`.

## 4. Structure

```
src/features/<domain>/<entity>-action-dialogs.tsx
│
├── import { useState } from "react"
├── import { Button, Input, Modal, extractApiError, formatCurrency } from "@civic/ui"
├── import { use<Action> } from "../../hooks/…"
├── import { useToast } from "../../hooks/use-toast"
├── import type { <Entity> } from "@civic/contracts"
│
├── /* ── Approve Dialog ── */
│   interface <Entity>ApproveDialogProps {
│       entity: Entity | null
│       onClose: () => void
│       onSuccess: () => void
│   }
│   export const <Entity>ApproveDialog = ({ entity, onClose, onSuccess }) => {
│       const [field, setField] = useState("")
│       const mutation = useApprove<Entity>()
│       const toast = useToast()
│
│       const handleApprove = () => {
│           if (!entity || !field) { toast.error(…); return }
│           mutation.mutate(payload, {
│               onSuccess: () => { toast.success(…); onSuccess() },
│               onError: (err) => { toast.error(…, extractApiError(…)) },
│           })
│       }
│
│       return (
│           <Modal open={!!entity} onClose={onClose} title="Approve …">
│               <p>Confirm text with entity summary</p>
│               <Input label="…" value={field} onChange={…} />
│               <div className="flex justify-end gap-2 pt-2">
│                   <Button variant="secondary" onClick={onClose}>Cancel</Button>
│                   <Button onClick={handleApprove} disabled={mutation.isPending}>
│                       {mutation.isPending ? "Approving…" : "Approve"}
│                   </Button>
│               </div>
│           </Modal>
│       )
│   }
│
├── /* ── Reject Dialog ── */
│   export const <Entity>RejectDialog = (…) => { … }
│
└── /* ── Process Dialog ── */
    export const <Entity>ProcessDialog = (…) => { … }
```

## 5. Example Implementation

```tsx
// src/features/refunds/refund-action-dialogs.tsx
import { useState } from "react";
import { Button, Input, Modal, extractApiError, formatCurrency } from "@civic/ui";
import { useApproveRefund, useRejectRefund } from "../../hooks/use-refunds";
import { useToast } from "../../hooks/use-toast";
import type { Refund } from "@civic/contracts";

/* ── Approve Dialog ────────────────────────────── */

interface RefundApproveDialogProps {
    refund: Refund | null;
    onClose: () => void;
    onSuccess: () => void;
}

export const RefundApproveDialog = ({ refund, onClose, onSuccess }: RefundApproveDialogProps) => {
    const [approveBy, setApproveBy] = useState("");
    const toast = useToast();
    const mutation = useApproveRefund();

    const handleApprove = () => {
        if (!refund || !approveBy) {
            toast.error("Validation", "Please enter the approver name.");
            return;
        }
        mutation.mutate(
            { id: refund.id, approvedBy: approveBy },
            {
                onSuccess: () => {
                    toast.success("Refund Approved", "The refund has been approved.");
                    onSuccess();
                },
                onError: (error: unknown) => {
                    toast.error("Error", extractApiError(error, "Failed to approve refund."));
                },
            },
        );
    };

    return (
        <Modal open={!!refund} onClose={onClose} title="Approve Refund">
            {refund && (
                <div className="space-y-4">
                    <p className="text-sm text-(--color-text-muted)">
                        Approve refund of{" "}
                        <strong>{formatCurrency(refund.amount?.amount ?? 0)}</strong> for roll
                        number <strong className="font-mono">{refund.rollNumber}</strong>?
                    </p>
                    <Input
                        label="Approved By"
                        value={approveBy}
                        onChange={(e) => setApproveBy(e.target.value)}
                        placeholder="Approver name"
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button onClick={handleApprove} disabled={mutation.isPending}>
                            {mutation.isPending ? "Approving…" : "Approve"}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
};

/* ── Reject Dialog ─────────────────────────────── */

interface RefundRejectDialogProps {
    refund: Refund | null;
    onClose: () => void;
    onSuccess: () => void;
}

export const RefundRejectDialog = ({ refund, onClose, onSuccess }: RefundRejectDialogProps) => {
    const [reason, setReason] = useState("");
    const toast = useToast();
    const mutation = useRejectRefund();

    const handleReject = () => {
        if (!refund || !reason) {
            toast.error("Validation", "Please enter a rejection reason.");
            return;
        }
        mutation.mutate(
            { id: refund.id, reason },
            {
                onSuccess: () => {
                    toast.success("Refund Rejected", "Refund has been rejected.");
                    onSuccess();
                },
                onError: (error: unknown) => {
                    toast.error("Error", extractApiError(error, "Failed to reject refund."));
                },
            },
        );
    };

    return (
        <Modal open={!!refund} onClose={onClose} title="Reject Refund">
            {refund && (
                <div className="space-y-4">
                    <p className="text-sm text-(--color-text-muted)">
                        Reject refund of{" "}
                        <strong>{formatCurrency(refund.amount?.amount ?? 0)}</strong>?
                    </p>
                    <Input
                        label="Rejection Reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                    />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleReject}
                            disabled={mutation.isPending}
                            className="bg-(--color-nordic-rose) hover:bg-(--color-nordic-rose)/90"
                        >
                            {mutation.isPending ? "Rejecting…" : "Reject"}
                        </Button>
                    </div>
                </div>
            )}
        </Modal>
    );
};
```
