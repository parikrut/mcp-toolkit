# Form

> Pattern documentation for domain-specific forms that create or update entities via mutation hooks.

## 1. Component Pattern

A **Form** is a domain-specific feature component that collects user input,
validates it client-side with a Zod schema, and submits it to the API via a
TanStack Query mutation hook. It uses `react-hook-form` with `zodResolver` for
declarative validation, reports success/error feedback via the toast system,
and delegates all API interaction to the mutation hook (see
[data-hook.md](data-hook.md)).

## 2. Overview

Forms are rendered inside modals, side panels, or inline within a page. They
are self-contained: each form owns its own schema, default values, submit
handler, and mutation call. The form never fetches list data — it only
**writes** (create or update).

A form file has three distinct sections:

| Section       | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| **Schema**    | Zod schema derived from the contract body schema         |
| **Types**     | `z.infer<>` type alias for the form values               |
| **Component** | `react-hook-form` + `@civic/ui` inputs + mutation submit |

The form communicates completion to its parent via callback props (`onSuccess`,
`onCancel`) — it does not manage its own open/close state or navigation.

### Key Libraries

| Library               | Role                                           |
| --------------------- | ---------------------------------------------- |
| `react-hook-form`     | Uncontrolled form state, field registration    |
| `@hookform/resolvers` | Bridges Zod schema → react-hook-form           |
| `zod`                 | Client-side validation schema                  |
| `@civic/ui`           | `Input`, `Select`, `Button`, `extractApiError` |
| `@civic/contracts`    | Source contract body schema + enum schemas     |
| Domain mutation hook  | `useCreate<Entity>()` / `useUpdate<Entity>()`  |
| `useToast`            | Success / error toast notifications            |

## 3. Rules

1. **Name convention:** `<entity>-form.tsx` in kebab-case
   (e.g. `appeal-form.tsx`, `appeal-decision-form.tsx`).
   Component name is PascalCase: `AppealForm`, `AppealDecisionForm`.
2. **Schema is derived from the contract.** Use `.pick()`, `.extend()`,
   or `.partial()` on the contract's `Create<Entity>BodySchema` /
   `Update<Entity>BodySchema` from `@civic/contracts`. Add frontend-only
   refinements (e.g. custom error messages, string-to-number coercion)
   in the `.extend()` block.
3. **One form per mutation.** A "Create" form and an "Edit/Decision" form
   are separate files with separate schemas — never a single multi-mode form.
4. **`useForm` with `zodResolver` is mandatory.**
   Configure `resolver: zodResolver(schema)` and provide `defaultValues`.
5. **Default values must be explicit.** Every field in the schema must have
   a corresponding entry in `defaultValues` — never rely on `undefined`.
6. **Mutation is called in `onSubmit`.** The `handleSubmit` callback receives
   validated values, transforms them if needed (e.g. dollars → cents,
   string year → number), then calls `mutation.mutate(payload, { onSuccess, onError })`.
7. **Toast feedback is mandatory.** Call `toast.success()` on success and
   `toast.error()` with `extractApiError()` on failure. Never use `alert()`.
8. **Callback props for lifecycle.** Accept `onSuccess?: () => void` and
   `onCancel?: () => void`. Call `onSuccess` after the mutation succeeds.
   `onCancel` renders a secondary "Cancel" button when provided.
9. **Submit button shows loading state.** Pass `loading={mutation.isPending}`
   and swap the label text to a gerund form (e.g. "Filing…", "Recording…").
10. **No inline styles or custom Tailwind.** Use `space-y-4` for field
    spacing, `flex justify-end gap-2 pt-2` for the button row.
11. **Pre-populated forms** (edit / decision) receive the entity as a prop
    and derive `defaultValues` from it.
12. **Exports from the feature barrel.** Re-export via
    `src/features/<domain>/index.ts` (see [barrel-exports.md](barrel-exports.md)).
13. **Uses `@civic/ui` form components** — `Input`, `Select`, `Button`.
    Wire errors via `error={errors.<field>?.message}`. Use `{...register("<field>")}` spread.

## 4. Structure

```
src/features/<domain>/<entity>-form.tsx
│
├── // ── Schema (derived from contract) ──
│   import { Create<Entity>BodySchema } from "@civic/contracts"
│
│   const <entity>FormSchema = Create<Entity>BodySchema
│       .pick({ field1: true, field2: true })
│       .extend({
│           field1: z.string().min(1, "Field is required"),
│           // frontend-only refinements
│       })
│
│   type <Entity>FormValues = z.infer<typeof <entity>FormSchema>
│
├── // ── Props ──
│   interface <Entity>FormProps {
│       entity?: <EntityResponse>     // for edit forms (pre-populate)
│       onSuccess?: () => void
│       onCancel?: () => void
│   }
│
└── // ── Component ──
    export const <Entity>Form = ({ onSuccess, onCancel }: <Entity>FormProps) => {
        const { register, handleSubmit, formState: { errors } } = useForm({
            resolver: zodResolver(<entity>FormSchema),
            defaultValues: { … },
        })

        const mutation = useCreate<Entity>()
        const toast = useToast()

        const onSubmit = (values: <Entity>FormValues) => {
            mutation.mutate(
                { /* transform values → API payload */ },
                {
                    onSuccess: () => {
                        toast.success("Title", "Description")
                        onSuccess?.()
                    },
                    onError: (error) => {
                        toast.error("Error", extractApiError(error, "Fallback message"))
                    },
                },
            )
        }

        return (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input label="…" error={errors.field?.message} {...register("field")} />
                <Select label="…" options={[…]} {...register("enumField")} />
                <div className="flex justify-end gap-2 pt-2">
                    {onCancel && (
                        <Button type="button" variant="secondary" onClick={onCancel}>
                            Cancel
                        </Button>
                    )}
                    <Button type="submit" loading={mutation.isPending}>
                        {mutation.isPending ? "Submitting…" : "Submit"}
                    </Button>
                </div>
            </form>
        )
    }
```

**Dependency Graph:**

```
<Entity>Form
  ├── react-hook-form + zodResolver     →  form state + validation
  ├── <entity>FormSchema (Zod)          →  derived from @civic/contracts
  ├── useCreate<Entity>() / useUpdate   →  see data-hook.md
  ├── useToast()                        →  success / error feedback
  ├── Input, Select, Button             →  see @civic/ui
  └── extractApiError()                 →  error message extraction
```

## 5. Example Implementation

**Create form (new entity):**

```tsx
// src/features/appeals/appeal-form.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Select, extractApiError } from "@civic/ui";
import { useCreateAppeal } from "../../hooks/use-appeals";
import { useToast } from "../../hooks/use-toast";
import { CreateAppealBodySchema } from "@civic/contracts";

// ─── Schema (derived from contract) ─────────────────────────

const appealFormSchema = CreateAppealBodySchema.pick({
    rollNumber: true,
    grounds: true,
}).extend({
    rollNumber: z.string().min(1, "Roll number is required"),
    taxYear: z.string().min(1, "Tax year is required"),
    grounds: z.string().min(1, "Grounds for appeal is required"),
});

type AppealFormValues = z.infer<typeof appealFormSchema>;

// ─── Component ──────────────────────────────────────────────

interface AppealFormProps {
    onSuccess?: () => void;
    onCancel?: () => void;
}

export const AppealForm = ({ onSuccess, onCancel }: AppealFormProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<AppealFormValues>({
        resolver: zodResolver(appealFormSchema),
        defaultValues: {
            rollNumber: "",
            taxYear: String(new Date().getFullYear()),
            grounds: "",
        },
    });

    const createMutation = useCreateAppeal();
    const toast = useToast();

    const onSubmit = (values: AppealFormValues) => {
        createMutation.mutate(
            {
                rollNumber: values.rollNumber,
                taxYear: Number(values.taxYear),
                grounds: values.grounds,
            },
            {
                onSuccess: () => {
                    toast.success("Appeal Filed", "Assessment appeal filed successfully.");
                    onSuccess?.();
                },
                onError: (error: unknown) => {
                    toast.error(
                        "Error",
                        extractApiError(error, "Failed to file appeal. Please try again."),
                    );
                },
            },
        );
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
                label="Roll Number"
                placeholder="e.g. 0401-010-001-12345"
                error={errors.rollNumber?.message}
                {...register("rollNumber")}
            />
            <Select
                label="Tax Year"
                options={Array.from({ length: 5 }, (_, i) => {
                    const y = new Date().getFullYear() - i;
                    return { label: String(y), value: String(y) };
                })}
                {...register("taxYear")}
            />
            <Input
                label="Grounds for Appeal"
                placeholder="Describe the grounds for this appeal"
                error={errors.grounds?.message}
                {...register("grounds")}
            />
            <div className="flex justify-end gap-2 pt-2">
                {onCancel && (
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button type="submit" loading={createMutation.isPending}>
                    {createMutation.isPending ? "Filing…" : "File Appeal"}
                </Button>
            </div>
        </form>
    );
};
```

**Decision / edit form (pre-populated from entity prop):**

```tsx
// src/features/appeals/appeal-decision-form.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Input, Select, extractApiError } from "@civic/ui";
import { useRecordAppealDecision } from "../../hooks/use-appeals";
import { useToast } from "../../hooks/use-toast";
import { AppealDecisionSchema } from "@civic/contracts";
import type { AppealResponse } from "@civic/contracts";

// ─── Schema ─────────────────────────────────────────────────

const decisionFormSchema = z.object({
    decision: AppealDecisionSchema,
    revisedCvaDollars: z.string().optional(),
    decisionNotes: z.string().optional(),
    decisionDate: z.string().min(1, "Decision date is required"),
});

type DecisionFormValues = z.infer<typeof decisionFormSchema>;

// ─── Component ──────────────────────────────────────────────

interface AppealDecisionFormProps {
    appeal: AppealResponse;
    onSuccess?: () => void;
    onCancel?: () => void;
}

export const AppealDecisionForm = ({ appeal, onSuccess, onCancel }: AppealDecisionFormProps) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<DecisionFormValues>({
        resolver: zodResolver(decisionFormSchema),
        defaultValues: {
            decision: "ALLOWED",
            revisedCvaDollars: "",
            decisionNotes: "",
            decisionDate: new Date().toISOString().split("T")[0],
        },
    });

    const mutation = useRecordAppealDecision();
    const toast = useToast();

    const onSubmit = (values: DecisionFormValues) => {
        // Transform dollars → cents for the API
        const revisedCvaCents = values.revisedCvaDollars
            ? Math.round(Number(values.revisedCvaDollars) * 100)
            : undefined;

        mutation.mutate(
            {
                id: appeal.id,
                decision: values.decision,
                revisedCvaCents,
                decisionNotes: values.decisionNotes || undefined,
                decisionDate: new Date(values.decisionDate),
            },
            {
                onSuccess: () => {
                    toast.success(
                        "Decision Recorded",
                        "Appeal decision has been recorded successfully.",
                    );
                    onSuccess?.();
                },
                onError: (error: unknown) => {
                    toast.error(
                        "Error",
                        extractApiError(error, "Failed to record decision. Please try again."),
                    );
                },
            },
        );
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-md bg-(--color-surface-secondary) p-3 text-sm">
                <span className="font-medium">Appeal:</span>{" "}
                <span className="font-mono">{appeal.rollNumber}</span> — {appeal.taxYear}
            </div>

            <Select
                label="Decision"
                options={[
                    { label: "Allowed (Reduced)", value: "ALLOWED" },
                    { label: "Maintained", value: "MAINTAINED" },
                    { label: "Partially Allowed", value: "PARTIALLY_ALLOWED" },
                    { label: "Withdrawn", value: "WITHDRAWN" },
                ]}
                error={errors.decision?.message}
                {...register("decision")}
            />

            <Input
                label="Revised CVA (dollars)"
                type="number"
                placeholder="e.g. 350000"
                error={errors.revisedCvaDollars?.message}
                {...register("revisedCvaDollars")}
            />

            <Input
                label="Decision Notes"
                placeholder="Optional notes about this decision"
                error={errors.decisionNotes?.message}
                {...register("decisionNotes")}
            />

            <Input
                label="Decision Date"
                type="date"
                error={errors.decisionDate?.message}
                {...register("decisionDate")}
            />

            <div className="flex justify-end gap-2 pt-2">
                {onCancel && (
                    <Button type="button" variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
                <Button type="submit" loading={mutation.isPending}>
                    {mutation.isPending ? "Recording…" : "Record Decision"}
                </Button>
            </div>
        </form>
    );
};
```
