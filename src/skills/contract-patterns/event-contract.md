# Event Schema Contract

> Pattern documentation for async event contracts that define event name constants and Zod-validated payload schemas for RabbitMQ message bus communication between microservice modules.

## 1. Component Pattern

The **Event Schema Contract** defines the async messaging boundary between
modules. Each event file lives in `packages/contracts/src/events/<domain>/`
and contains two things: an **event name constants object** (routing keys)
and **Zod payload schemas** (one per event). Publishers validate payloads
before emitting, and subscribers parse payloads on receive — both using the
same Zod schema from the shared contract package.

## 2. Overview

| Concept                  | Description                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Event name constants** | `as const` object mapping semantic keys to dot-notation routing key strings                    |
| **Routing key format**   | `domain.entity.action` (e.g., `"assessment.roll.imported"`, `"tax.bill.generated"`)            |
| **Payload schema**       | One Zod schema per event with all required fields + mandatory `correlationId`                  |
| **File location**        | `packages/contracts/src/events/<domain>/<entity>.events.ts`                                    |
| **Barrel exports**       | Each domain has an `index.ts`, rolled up to `events/index.ts`, then `src/index.ts`             |
| **Consumers**            | RabbitMQ publishers (service layer), RabbitMQ subscribers (event handlers), saga orchestrators |

Event contracts are the **async equivalent** of `defineEndpoint()` — they
define the shape of data that crosses module boundaries, but via message
queues instead of HTTP.

### Directory Organization

```
packages/contracts/src/events/
├── index.ts                              ← re-exports all domain barrels
├── revenue/
│   ├── index.ts                          ← re-exports all revenue event files
│   ├── assessment-roll.events.ts         ← assessment + property events
│   ├── tax-bill.events.ts               ← billing events
│   ├── tax-certificate.events.ts        ← certificate events
│   ├── tax-levy-rate.events.ts          ← levy/rate events
│   ├── tax-sale.events.ts              ← tax sale events
│   └── payment-processing.events.ts     ← payment events
├── platform/
│   ├── index.ts
│   └── notification.events.ts           ← notification delivery events
└── shared/
    ├── index.ts
    └── billing.events.ts                ← cross-domain billing events
```

## 3. Rules

1. **Every event payload schema MUST include `correlationId: z.string().uuid()`.**
   This is mandatory for distributed tracing across services.

    ```typescript
    export const MyEventSchema = z.object({
        // ... domain fields
        correlationId: z.string().uuid(), // ← REQUIRED on every event
    });
    ```

2. **Event names are `as const` objects, not enums.** Use a plain object with
   `as const` assertion for better type inference and tree-shaking:

    ```typescript
    // ✅ Correct — as const object
    export const TaxBillEvents = {
        BILL_GENERATED: "tax.bill.generated",
        BILL_MAILED: "tax.bill.mailed",
    } as const;

    // ❌ Wrong — native enum
    export enum TaxBillEvents {
        BILL_GENERATED = "tax.bill.generated",
    }
    ```

3. **Routing keys use dot notation: `domain.entity.action`.**

    ```typescript
    "assessment.roll.imported"; // domain=assessment, entity=roll, action=imported
    "tax.bill.generated"; // domain=tax, entity=bill, action=generated
    "property.ownership.changed"; // domain=property, entity=ownership, action=changed
    ```

4. **Publishers MUST Zod-validate before emitting.** The service layer calls
   `schema.parse(payload)` before publishing to the message bus:

    ```typescript
    const validated = AssessmentCreatedEventSchema.parse(payload);
    await this.rabbitPublisher.emit(AssessmentRollEvents.ASSESSMENT_CREATED, validated);
    ```

5. **Subscribers MUST Zod-parse on receive.** Event handlers parse the
   incoming payload to ensure type safety:

    ```typescript
    @Subscribe(AssessmentRollEvents.ASSESSMENT_CREATED)
    async handle(raw: unknown) {
        const event = AssessmentCreatedEventSchema.parse(raw);
        // event is fully typed
    }
    ```

6. **One events file per aggregate/entity group.** Group related events
   together (e.g., all assessment + property events in
   `assessment-roll.events.ts`).

7. **Event schemas can import from entity contracts.** Reuse enum schemas
   from the contract layer:

    ```typescript
    import { PropertyClassSchema } from "../../contracts/revenue/property.contract";
    ```

8. **Organized by domain:** `events/revenue/`, `events/platform/`,
   `events/shared/`. Match the contract directory structure.

9. **Every events file must be added to its domain barrel** (`events/revenue/index.ts`)
   and the top-level barrel (`events/index.ts`).

10. **Monetary values in event payloads use integer cents** (`z.number().int()`),
    not `MoneySchema`. Events are internal — the `MoneySchema` wrapper is only
    for API responses.

11. **Date fields use `z.coerce.date()`** to handle serialized JSON date strings.

12. **Event name constant keys are `SCREAMING_SNAKE_CASE`.** Routing key values
    are `dot.notation.lowercase`.

## 4. Structure

```
packages/contracts/src/events/<domain>/<entity>.events.ts
├── import { z } from "zod"
├── import { SomeEnumSchema } from "../../contracts/<domain>/<entity>.contract"  // optional
│
├── // ─── Event Name Constants ──────────────────────────────
│   export const <Entity>Events = {
│       CREATED: "<domain>.<entity>.created",
│       UPDATED: "<domain>.<entity>.updated",
│       DELETED: "<domain>.<entity>.deleted",
│       // ... domain-specific events
│   } as const
│
├── // ─── Event Payload Schemas ─────────────────────────────
│   export const <Entity>CreatedEventSchema = z.object({
│       <entity>Id: z.string().uuid(),
│       // ... domain fields
│       createdAt: z.coerce.date(),
│       correlationId: z.string().uuid(),          // ← ALWAYS required
│   })
│   export type <Entity>CreatedEvent = z.infer<typeof …>
│
│   export const <Entity>UpdatedEventSchema = z.object({
│       <entity>Id: z.string().uuid(),
│       previous<Field>: z.<type>(),               // before value
│       new<Field>: z.<type>(),                    // after value
│       reason: z.enum([…]),                       // why it changed
│       updatedAt: z.coerce.date(),
│       correlationId: z.string().uuid(),
│   })
│   export type <Entity>UpdatedEvent = z.infer<typeof …>
│
└── // ... one schema per event in the constants object
```

## 5. Example Implementation

### assessment-roll.events.ts — Full Source (Revenue Domain)

```typescript
// packages/contracts/src/events/revenue/assessment-roll.events.ts
import { z } from "zod";
import { PropertyClassSchema } from "../../contracts/revenue/property.contract";

// ─── Assessment Roll Events ─────────────────────────────────

export const AssessmentRollEvents = {
    ROLL_IMPORTED: "assessment.roll.imported",
    ASSESSMENT_CREATED: "assessment.created",
    ASSESSMENT_UPDATED: "assessment.updated",
    PROPERTY_CREATED: "property.created",
    PROPERTY_DELETED: "property.deleted",
    PROPERTY_OWNERSHIP_CHANGED: "property.ownership.changed",
    APPEAL_FILED: "assessment.appeal.filed",
    APPEAL_DECIDED: "assessment.appeal.decided",
    SUPPLEMENTARY_ASSESSMENT_CREATED: "assessment.supplementary.created",
    OMITTED_ASSESSMENT_CREATED: "assessment.omitted.created",
    EXEMPTION_GRANTED: "assessment.exemption.granted",
    EXEMPTION_REVOKED: "assessment.exemption.revoked",
    SCHOOL_SUPPORT_CHANGED: "assessment.school.support.changed",
    PHASE_IN_CALCULATED: "assessment.phase.in.calculated",
    PHASE_IN_ADVANCED: "assessment.phase.in.advanced",
} as const;

// ─── Payload Schemas ────────────────────────────────────────

export const AssessmentRollImportedEventSchema = z.object({
    batchId: z.string().uuid(),
    taxYear: z.number().int(),
    rollType: z.enum(["INITIAL", "SUPPLEMENTARY", "OMITTED"]),
    totalRecords: z.number().int(),
    importedCount: z.number().int(),
    errorCount: z.number().int(),
    importedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type AssessmentRollImportedEvent = z.infer<typeof AssessmentRollImportedEventSchema>;

export const AssessmentCreatedEventSchema = z.object({
    assessmentId: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    propertyClass: PropertyClassSchema,
    cvaCents: z.number().int(),
    phasedInCvaCents: z.number().int(),
    assessmentYear: z.number().int(),
    createdAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type AssessmentCreatedEvent = z.infer<typeof AssessmentCreatedEventSchema>;

export const AssessmentUpdatedEventSchema = z.object({
    assessmentId: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    previousCvaCents: z.number().int(),
    newCvaCents: z.number().int(),
    reason: z.enum(["APPEAL_DECISION", "SUPPLEMENTARY", "CORRECTION"]),
    updatedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type AssessmentUpdatedEvent = z.infer<typeof AssessmentUpdatedEventSchema>;

export const PropertyCreatedEventSchema = z.object({
    propertyId: z.string().uuid(),
    rollNumber: z.string(),
    propertyClass: PropertyClassSchema,
    ward: z.string().nullable(),
    createdAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type PropertyCreatedEvent = z.infer<typeof PropertyCreatedEventSchema>;

export const PropertyDeletedEventSchema = z.object({
    propertyId: z.string().uuid(),
    rollNumber: z.string(),
    deletedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type PropertyDeletedEvent = z.infer<typeof PropertyDeletedEventSchema>;

export const PropertyOwnershipChangedEventSchema = z.object({
    propertyId: z.string().uuid(),
    rollNumber: z.string(),
    previousOwnerName: z.string(),
    newOwnerName: z.string(),
    ownershipType: z.enum(["SOLE", "JOINT", "TENANTS_IN_COMMON"]),
    changedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type PropertyOwnershipChangedEvent = z.infer<typeof PropertyOwnershipChangedEventSchema>;

export const AppealFiledEventSchema = z.object({
    appealId: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    currentValueCents: z.number().int(),
    requestedReductionCents: z.number().int().nullable(),
    filedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type AppealFiledEvent = z.infer<typeof AppealFiledEventSchema>;

export const AppealDecidedEventSchema = z.object({
    appealId: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    decision: z.string(),
    previousValueCents: z.number().int(),
    revisedValueCents: z.number().int().nullable(),
    taxAdjustmentCents: z.number().int().nullable(),
    refundCents: z.number().int().nullable(),
    decidedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type AppealDecidedEvent = z.infer<typeof AppealDecidedEventSchema>;
```

### Tax Bill Events — Billing Domain

```typescript
// packages/contracts/src/events/revenue/tax-bill.events.ts
import { z } from "zod";
import { TaxBillTypeSchema } from "../../contracts/revenue/tax-bills.contract";

// ─── Tax Bill Events ────────────────────────────────────────

export const TaxBillEvents = {
    BILL_GENERATED: "tax.bill.generated",
    BILL_MAILED: "tax.bill.mailed",
    BILL_EMAILED: "billing.bill.emailed",
    BILL_BATCH_EMAILED: "billing.bill.batch.emailed",
    PENALTY_APPLIED: "tax.penalty.applied",
    PENALTY_BATCH_APPLIED: "tax.penalty.batch.applied",
    PENALTY_WAIVED: "tax.penalty.waived",
} as const;

export const BillGeneratedEventSchema = z.object({
    billId: z.string().uuid(),
    rollNumber: z.string(),
    taxYear: z.number().int(),
    billType: TaxBillTypeSchema,
    totalLeviedCents: z.number().int(),
    dueDateInterim: z.coerce.date(),
    dueDateFinal: z.coerce.date(),
    generatedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type BillGeneratedEvent = z.infer<typeof BillGeneratedEventSchema>;

export const BillMailedEventSchema = z.object({
    billId: z.string().uuid(),
    rollNumber: z.string(),
    mailedAt: z.coerce.date(),
    trackingNumber: z.string().optional(),
    correlationId: z.string().uuid(),
});
export type BillMailedEvent = z.infer<typeof BillMailedEventSchema>;

export const PenaltyAppliedEventSchema = z.object({
    billId: z.string().uuid(),
    rollNumber: z.string(),
    penaltyCents: z.number().int(),
    penaltyRate: z.number(),
    appliedAt: z.coerce.date(),
    correlationId: z.string().uuid(),
});
export type PenaltyAppliedEvent = z.infer<typeof PenaltyAppliedEventSchema>;
```

### Publisher Usage (Service Layer)

```typescript
// modules/domain/revenue/billing/src/services/tax-bill.service.ts
import { TaxBillEvents, BillGeneratedEventSchema } from "@civic/contracts";

@Injectable()
export class TaxBillService {
    constructor(private readonly rabbitPublisher: RabbitPublisher) {}

    async generateBill(input: CreateTaxBillBody): Promise<TaxBillResponse> {
        const bill = await this.repository.create(input);

        // Validate payload BEFORE publishing
        const eventPayload = BillGeneratedEventSchema.parse({
            billId: bill.id,
            rollNumber: bill.rollNumber,
            taxYear: bill.taxYear,
            billType: bill.billType,
            totalLeviedCents: Number(bill.totalLeviedCents),
            dueDateInterim: bill.dueDateInterim,
            dueDateFinal: bill.dueDateFinal,
            generatedAt: new Date(),
            correlationId: crypto.randomUUID(),
        });

        await this.rabbitPublisher.emit(TaxBillEvents.BILL_GENERATED, eventPayload);

        return this.toResponse(bill);
    }
}
```

### Subscriber Usage (Event Handler)

```typescript
// modules/domain/revenue/arrears/src/handlers/bill-generated.handler.ts
import { TaxBillEvents, BillGeneratedEventSchema, type BillGeneratedEvent } from "@civic/contracts";

@Injectable()
export class BillGeneratedHandler {
    @Subscribe(TaxBillEvents.BILL_GENERATED)
    async handle(raw: unknown): Promise<void> {
        // Parse and validate on receive
        const event: BillGeneratedEvent = BillGeneratedEventSchema.parse(raw);

        // event is now fully typed — safe to use
        await this.arrearsService.trackNewBill({
            billId: event.billId,
            rollNumber: event.rollNumber,
            totalLeviedCents: event.totalLeviedCents,
            dueDateFinal: event.dueDateFinal,
        });
    }
}
```

### Creating a New Event File

When adding events for a new entity, follow this template:

```typescript
// packages/contracts/src/events/<domain>/<entity>.events.ts
import { z } from "zod";
// Import any reusable enum schemas from entity contracts
import { ResourceStatusSchema } from "../../contracts/<domain>/<entity>.contract";

// ─── <Entity> Events ────────────────────────────────────────

export const <Entity>Events = {
    CREATED: "<domain>.<entity>.created",
    UPDATED: "<domain>.<entity>.updated",
    DELETED: "<domain>.<entity>.deleted",
    // ... domain-specific events
    STATUS_CHANGED: "<domain>.<entity>.status.changed",
} as const;

export const <Entity>CreatedEventSchema = z.object({
    <entity>Id: z.string().uuid(),
    // ... all fields the subscriber needs to react
    createdAt: z.coerce.date(),
    correlationId: z.string().uuid(),    // ← MANDATORY
});
export type <Entity>CreatedEvent = z.infer<typeof <Entity>CreatedEventSchema>;

export const <Entity>UpdatedEventSchema = z.object({
    <entity>Id: z.string().uuid(),
    // Include before/after values for audit trail
    previous<Field>: z.<type>(),
    new<Field>: z.<type>(),
    updatedAt: z.coerce.date(),
    correlationId: z.string().uuid(),    // ← MANDATORY
});
export type <Entity>UpdatedEvent = z.infer<typeof <Entity>UpdatedEventSchema>;
```

Then add to the domain barrel:

```typescript
// packages/contracts/src/events/<domain>/index.ts
export * from "./<entity>.events";
```

### Event Barrel Files

```typescript
// packages/contracts/src/events/index.ts
export * from "./platform";
export * from "./shared";
export * from "./revenue";
```

```typescript
// packages/contracts/src/events/revenue/index.ts
export * from "./assessment-roll.events";
export * from "./tax-bill.events";
export * from "./tax-certificate.events";
export * from "./tax-levy-rate.events";
export * from "./tax-sale.events";
export * from "./payment-processing.events";
```
