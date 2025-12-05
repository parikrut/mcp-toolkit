# Wizard (Multi-Step Flow)

> Pattern documentation for multi-step wizard pages that guide users through a sequential process.

## 1. Component Pattern

A **Wizard** is a page-level component that manages a linear sequence of steps
using numeric step state. It renders a shared `StepIndicator` progress bar and
conditionally renders one step component at a time inside a `Card`. All
inter-step state lives in the wizard page as `useState` variables; each step
receives its slice of state plus `onNext` / `onBack` callbacks as props.

## 2. Overview

Wizards are used for complex multi-step workflows where a single form would be
overwhelming. Examples include payment, PAP enrollment, and data
import flows.

| Layer               | Responsibility                                      |
| ------------------- | --------------------------------------------------- |
| **Wizard Page**     | Step state, shared data state, mutation, navigation |
| **StepIndicator**   | Visual progress bar (`@myorg/ui`)                   |
| **Step Components** | Individual step UI, receives props from wizard page |

Data flows **top-down only**: the wizard page holds all state and passes it
to step components. Steps communicate upward via callbacks (`onNext`,
`onBack`, `onSelect`, setters).

The final step typically triggers a mutation (see [data-hook.md](data-hook.md))
and then advances to a confirmation / receipt step.

## 3. Rules

1. **File structure:** Wizard page at `src/pages/<workflow>.tsx`. Step
   components at `src/features/<workflow>/<step-name>-step.tsx`.
2. **Step state is a simple integer.** `const [step, setStep] = useState(0)`.
   Use `next()` and `prev()` helper functions.
3. **`STEPS` constant array** defines step labels:
   `const STEPS = ["Search", "Details", "Review", "Confirmed"]`.
4. **`StepIndicator`** from `@myorg/ui` renders the progress bar:
   `<StepIndicator steps={STEPS} currentStep={step} />`.
5. **Each step is a separate component** in the feature folder. Each step
   receives only the props it needs — never the entire wizard state.
6. **Shared state lives in the wizard page** as multiple `useState` calls,
   not in a single object. This keeps the state granular and avoids
   unnecessary re-renders.
7. **`reset()` function** clears all state and returns to step 0.
8. **Mutation happens in the wizard page**, not in a step component. The
   wizard page defines `handleSubmit` which calls the mutation, handles
   `onSuccess` / `onError`, and advances to the confirmation step.
9. **Step components are stateless or minimally stateful.** They render
   form inputs and call parent callbacks.
10. **All steps render inside a single `Card`** wrapper for visual consistency.
11. **Step barrel:** `src/features/<workflow>/index.ts` re-exports all step
    components and any shared types.

## 4. Structure

```
src/pages/<workflow>.tsx
├── import { useState } from "react"
├── import { Card, StepIndicator } from "@myorg/ui"
├── import { use<Mutation>, useToast } from "../hooks"
├── import { Step1, Step2, Step3, Step4 } from "../features/<workflow>"
│
├── const STEPS = ["Step 1", "Step 2", "Step 3", "Done"]
│
└── export const <Workflow>Page = () => {
        const [step, setStep] = useState(0)
        const [field1, setField1] = useState(…)
        const [field2, setField2] = useState(…)

        const mutation = use<Mutation>()
        const toast = useToast()

        const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
        const prev = () => setStep(s => Math.max(s - 1, 0))
        const reset = () => { setStep(0); setField1(…); … }

        const handleSubmit = () => {
            mutation.mutate(payload, {
                onSuccess: () => { toast.success(…); next() },
                onError: (err) => { toast.error(…) },
            })
        }

        return (
            <div className="space-y-6">
                <h1>…</h1>
                <StepIndicator steps={STEPS} currentStep={step} />
                <Card>
                    {step === 0 && <Step1 onSelect={…} />}
                    {step === 1 && <Step2 … onNext={next} onBack={prev} />}
                    {step === 2 && <Step3 … onSubmit={handleSubmit} onBack={prev} />}
                    {step === 3 && <Step4 … onReset={reset} />}
                </Card>
            </div>
        )
    }
```

**Step component folder:**

```
src/features/<workflow>/
├── <step-name>-step.tsx     ← per-step UI component
├── index.ts                 ← barrel exports
└── types or shared interfaces (optional)
```

## 5. Example Implementation

```tsx
// src/pages/payment-wizard.tsx
import { useState } from "react";
import { Card, StepIndicator } from "@myorg/ui";
import { useApplyPayment, useToast } from "../hooks";
import {
    PropertySearchStep,
    BalanceStep,
    MethodStep,
    ConfirmStep,
    ReceiptStep,
} from "../features/payment-wizard";
import type { SelectedProperty } from "../features/payment-wizard";

const STEPS = ["Search", "Balance", "Payment", "Confirm", "Receipt"];

export const PaymentWizardPage = () => {
    const [step, setStep] = useState(0);
    const [selectedProperty, setSelectedProperty] = useState<SelectedProperty | null>(null);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentMethod, setPaymentMethod] = useState("CASH");
    const [chequeNumber, setChequeNumber] = useState("");
    const [receiptId, setReceiptId] = useState<string | null>(null);

    const toast = useToast();
    const applyPayment = useApplyPayment();

    const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
    const prev = () => setStep((s) => Math.max(s - 1, 0));
    const reset = () => {
        setStep(0);
        setSelectedProperty(null);
        setPaymentAmount("");
        setPaymentMethod("CASH");
        setChequeNumber("");
        setReceiptId(null);
    };

    const handleSubmitPayment = () => {
        if (!selectedProperty) return;
        const amountCents = Math.round(parseFloat(paymentAmount) * 100);
        applyPayment.mutate(
            {
                rollNumber: selectedProperty.rollNumber,
                amount: { amount: amountCents, currency: "CAD" },
                method: paymentMethod as "CASH" | "CHEQUE" | "EFT",
                receivedDate: new Date(),
            },
            {
                onSuccess: (data) => {
                    setReceiptId(data.id);
                    toast.success("Payment Applied", "Recorded successfully.");
                    next();
                },
                onError: () => {
                    toast.error("Error", "Failed to apply payment.");
                },
            },
        );
    };

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-text-primary">Payment Wizard</h1>
            <StepIndicator steps={STEPS} currentStep={step} />
            <Card className="mt-6">
                {step === 0 && (
                    <PropertySearchStep
                        onSelect={(p) => {
                            setSelectedProperty(p);
                            next();
                        }}
                    />
                )}
                {step === 1 && selectedProperty && (
                    <BalanceStep
                        property={selectedProperty}
                        paymentAmount={paymentAmount}
                        setPaymentAmount={setPaymentAmount}
                        onNext={next}
                        onBack={prev}
                    />
                )}
                {step === 2 && (
                    <MethodStep
                        paymentMethod={paymentMethod}
                        setPaymentMethod={setPaymentMethod}
                        chequeNumber={chequeNumber}
                        setChequeNumber={setChequeNumber}
                        onNext={next}
                        onBack={prev}
                    />
                )}
                {step === 3 && selectedProperty && (
                    <ConfirmStep
                        property={selectedProperty}
                        paymentAmount={paymentAmount}
                        paymentMethod={paymentMethod}
                        chequeNumber={chequeNumber}
                        onSubmit={handleSubmitPayment}
                        isSubmitting={applyPayment.isPending}
                        onBack={prev}
                    />
                )}
                {step === 4 && selectedProperty && (
                    <ReceiptStep
                        property={selectedProperty}
                        paymentAmount={paymentAmount}
                        receiptId={receiptId}
                        onReset={reset}
                    />
                )}
            </Card>
        </div>
    );
};
```
