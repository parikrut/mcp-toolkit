# Event Publisher

## 1. Component Pattern

**Type:** Event Publisher  
**Layer:** Events / Infrastructure  
**File Location:** `modules/domain/<domain>/<module>/src/events/publishers/<resource>.publisher.ts`  
**Naming Convention:** `<Resource>Publisher` (e.g., `AssessmentRollPublisher`, `TaxBillingPublisher`)  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/src/events/publishers/assessment-roll.publisher.ts`

## 2. Overview

The Event Publisher is responsible for emitting domain events to RabbitMQ via NestJS microservices. It acts as the outbound event gateway for a module — when a service completes a business operation that other modules need to know about, the service calls the publisher to broadcast an event.

Publishers are **injectable NestJS providers** that hold a reference to the RabbitMQ `ClientProxy`. They enforce a strict contract: every payload is **Zod-validated before emission**, ensuring that only schema-compliant messages ever reach the message broker. This prevents downstream subscribers from receiving malformed data and makes the event contract the single source of truth.

Key design principles:

- **Graceful degradation** — If RabbitMQ is unavailable (client is `null`), the publisher logs a warning and returns without crashing. The core business operation still succeeds; only the event broadcast is skipped.
- **One method per event** — Each event type (created, updated, deleted, etc.) has its own dedicated publish method with strongly-typed parameters.
- **Zod validation at the boundary** — The publisher is the last line of defense before data leaves the module. Validation here guarantees contract compliance.
- **Structured logging** — Every publish logs the event name, resource ID, and correlation ID for distributed tracing.
- **Correlation ID propagation** — Every event payload includes a `correlationId` passed from the controller/service layer, enabling end-to-end request tracing across modules.

## 3. Rules

1. **MUST** be decorated with `@Injectable()`.
2. **MUST** inject the RMQ client via `@Optional() @Inject(QUEUE_TOKEN)` — the `@Optional()` decorator is **mandatory** so the module still boots when RabbitMQ is unavailable (e.g., local dev, test environments).
3. **MUST** type the injected client as `ClientProxy | null` to reflect the optional nature.
4. **MUST** check `if (!this.client)` at the top of every publish method and return early with a warning log if the client is null.
5. **MUST** Zod-validate every payload before emitting — use the schema's `.parse()` method (not `.safeParse()`; let it throw on invalid data since this is a programming error, not user input).
6. **MUST** use `this.client.emit(routingKey, validatedPayload)` — `emit()` is fire-and-forget (no response expected). Never use `send()` for events.
7. **MUST** import routing keys from the event contract (e.g., `ResourceEvents.CREATED`) — never hardcode routing key strings.
8. **MUST** import payload schemas and types from `@civic/contracts`.
9. **MUST** create a structured logger via `createLogger({ module: "<module>-publisher" })`.
10. **MUST** log the event name, primary resource ID, and correlation ID after successful publish.
11. **MUST** have one publish method per event type — naming convention: `publish<Resource><Action>(payload)` (e.g., `publishAssessmentRollCreated`, `publishAssessmentRollUpdated`).
12. **MUST** define the `QUEUE_TOKEN` constant in the publisher file or a shared constants file.
13. **MUST NOT** contain any business logic — the publisher is a pure infrastructure concern.
14. **MUST NOT** catch and swallow Zod validation errors — if validation fails, it's a bug in the calling code and should propagate.
15. **MUST NOT** await the `emit()` call for acknowledgment — events are fire-and-forget by design.
16. **SHOULD** group all publishers for a module in the `events/publishers/` directory.
17. **SHOULD** keep each publisher focused on one resource/aggregate — do not create god-publishers that handle events for multiple unrelated resources.

## 4. Structure

```
modules/domain/<domain>/<module>/
└── src/
    └── events/
        └── publishers/
            ├── <resource>.publisher.ts        # Publisher class
            └── index.ts                       # Barrel export
```

### File Anatomy

```typescript
// ─── Imports ─────────────────────────────────────────────────────────
import { Injectable, Optional, Inject } from "@nestjs/common";    // NestJS decorators
import { ClientProxy } from "@nestjs/microservices";               // RMQ client type
import { createLogger } from "@civic/common";                      // Structured logger
import {                                                           // Event contracts
    ResourceEvents,                                                // Routing key enum
    ResourceCreatedSchema,                                         // Zod schemas
    ResourceUpdatedSchema,
    ResourceDeletedSchema,
    type ResourceCreatedPayload,                                   // TypeScript types
    type ResourceUpdatedPayload,
    type ResourceDeletedPayload,
} from "@civic/contracts";

// ─── Constants ───────────────────────────────────────────────────────
const QUEUE_TOKEN = "RESOURCE_QUEUE";                              // Injection token
const logger = createLogger({ module: "resource-publisher" });     // Module logger

// ─── Publisher Class ─────────────────────────────────────────────────
@Injectable()
export class ResourcePublisher {
    constructor(
        @Optional()                                                // Survives missing RMQ
        @Inject(QUEUE_TOKEN)                                       // Token-based injection
        private readonly client: ClientProxy | null,               // Nullable client
    ) {}

    // One method per event type
    async publishResourceCreated(payload: ResourceCreatedPayload): Promise<void> { ... }
    async publishResourceUpdated(payload: ResourceUpdatedPayload): Promise<void> { ... }
    async publishResourceDeleted(payload: ResourceDeletedPayload): Promise<void> { ... }
}
```

### Integration with Module Registration

The publisher must be registered as a provider in the module's NestJS module, alongside the `RmqModule`:

```typescript
import { Module } from "@nestjs/common";
import { RmqModule } from "@civic/common";
import { ResourcePublisher } from "./events/publishers/resource.publisher";

const QUEUE_TOKEN = "RESOURCE_QUEUE";

@Module({
    imports: [
        RmqModule.register({
            name: QUEUE_TOKEN,
            queue: "resource-events",
        }),
    ],
    providers: [ResourcePublisher],
    exports: [ResourcePublisher],
})
export class ResourceModule {}
```

### Integration with Service Layer

Services call the publisher after completing business operations:

```typescript
@Injectable()
export class ResourceService {
    constructor(
        private readonly repository: ResourceRepository,
        private readonly publisher: ResourcePublisher,
    ) {}

    async createResource(dto: CreateResourceDto, correlationId: string): Promise<Resource> {
        const resource = await this.repository.create(dto);

        // Publish event AFTER successful persistence
        await this.publisher.publishResourceCreated({
            resourceId: resource.id,
            correlationId,
            // ... other payload fields
        });

        return resource;
    }
}
```

## 5. Example Implementation

### Full Publisher — Assessment Roll Events

```typescript
import { Injectable, Optional, Inject } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { createLogger } from "@civic/common";
import {
    AssessmentRollEvents,
    AssessmentRollCreatedSchema,
    AssessmentRollUpdatedSchema,
    AssessmentRollDeletedSchema,
    AssessmentRollStatusChangedSchema,
    type AssessmentRollCreatedPayload,
    type AssessmentRollUpdatedPayload,
    type AssessmentRollDeletedPayload,
    type AssessmentRollStatusChangedPayload,
} from "@civic/contracts";

const QUEUE_TOKEN = "ASSESSMENT_ROLL_QUEUE";
const logger = createLogger({ module: "assessment-roll-publisher" });

@Injectable()
export class AssessmentRollPublisher {
    constructor(
        @Optional()
        @Inject(QUEUE_TOKEN)
        private readonly client: ClientProxy | null,
    ) {}

    /**
     * Publishes an event when a new assessment roll is created.
     * Downstream consumers (e.g., tax-billing-instalment) react to this
     * to generate initial billing records.
     */
    async publishAssessmentRollCreated(payload: AssessmentRollCreatedPayload): Promise<void> {
        if (!this.client) {
            logger.warn("RMQ client not available — skipping AssessmentRollCreated event publish");
            return;
        }

        const validated = AssessmentRollCreatedSchema.parse(payload);
        this.client.emit(AssessmentRollEvents.CREATED, validated);
        logger.info(
            {
                event: AssessmentRollEvents.CREATED,
                assessmentRollId: validated.assessmentRollId,
                correlationId: validated.correlationId,
            },
            "AssessmentRollCreated event published",
        );
    }

    /**
     * Publishes an event when an assessment roll is updated.
     * Downstream consumers may need to recalculate billing amounts.
     */
    async publishAssessmentRollUpdated(payload: AssessmentRollUpdatedPayload): Promise<void> {
        if (!this.client) {
            logger.warn("RMQ client not available — skipping AssessmentRollUpdated event publish");
            return;
        }

        const validated = AssessmentRollUpdatedSchema.parse(payload);
        this.client.emit(AssessmentRollEvents.UPDATED, validated);
        logger.info(
            {
                event: AssessmentRollEvents.UPDATED,
                assessmentRollId: validated.assessmentRollId,
                correlationId: validated.correlationId,
            },
            "AssessmentRollUpdated event published",
        );
    }

    /**
     * Publishes an event when an assessment roll is soft-deleted.
     * Downstream consumers should deactivate related records.
     */
    async publishAssessmentRollDeleted(payload: AssessmentRollDeletedPayload): Promise<void> {
        if (!this.client) {
            logger.warn("RMQ client not available — skipping AssessmentRollDeleted event publish");
            return;
        }

        const validated = AssessmentRollDeletedSchema.parse(payload);
        this.client.emit(AssessmentRollEvents.DELETED, validated);
        logger.info(
            {
                event: AssessmentRollEvents.DELETED,
                assessmentRollId: validated.assessmentRollId,
                correlationId: validated.correlationId,
            },
            "AssessmentRollDeleted event published",
        );
    }

    /**
     * Publishes an event when an assessment roll status changes
     * (e.g., DRAFT → CERTIFIED → FINAL).
     * This is a high-value event — tax billing uses it to trigger instalment generation.
     */
    async publishAssessmentRollStatusChanged(
        payload: AssessmentRollStatusChangedPayload,
    ): Promise<void> {
        if (!this.client) {
            logger.warn(
                "RMQ client not available — skipping AssessmentRollStatusChanged event publish",
            );
            return;
        }

        const validated = AssessmentRollStatusChangedSchema.parse(payload);
        this.client.emit(AssessmentRollEvents.STATUS_CHANGED, validated);
        logger.info(
            {
                event: AssessmentRollEvents.STATUS_CHANGED,
                assessmentRollId: validated.assessmentRollId,
                previousStatus: validated.previousStatus,
                newStatus: validated.newStatus,
                correlationId: validated.correlationId,
            },
            "AssessmentRollStatusChanged event published",
        );
    }
}
```

### Minimal Publisher — Single Event

For modules that only need to publish one event:

```typescript
import { Injectable, Optional, Inject } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { createLogger } from "@civic/common";
import {
    PaymentEvents,
    PaymentReceivedSchema,
    type PaymentReceivedPayload,
} from "@civic/contracts";

const QUEUE_TOKEN = "PAYMENT_QUEUE";
const logger = createLogger({ module: "payment-publisher" });

@Injectable()
export class PaymentPublisher {
    constructor(
        @Optional()
        @Inject(QUEUE_TOKEN)
        private readonly client: ClientProxy | null,
    ) {}

    async publishPaymentReceived(payload: PaymentReceivedPayload): Promise<void> {
        if (!this.client) {
            logger.warn("RMQ client not available — skipping PaymentReceived event publish");
            return;
        }

        const validated = PaymentReceivedSchema.parse(payload);
        this.client.emit(PaymentEvents.RECEIVED, validated);
        logger.info(
            {
                event: PaymentEvents.RECEIVED,
                paymentId: validated.paymentId,
                amount: validated.amount,
                correlationId: validated.correlationId,
            },
            "PaymentReceived event published",
        );
    }
}
```

### Unit Test Pattern

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { AssessmentRollPublisher } from "./assessment-roll.publisher";

const QUEUE_TOKEN = "ASSESSMENT_ROLL_QUEUE";

describe("AssessmentRollPublisher", () => {
    let publisher: AssessmentRollPublisher;
    let mockClient: { emit: jest.Mock };

    beforeEach(async () => {
        mockClient = { emit: jest.fn() };

        const module: TestingModule = await Test.createTestingModule({
            providers: [AssessmentRollPublisher, { provide: QUEUE_TOKEN, useValue: mockClient }],
        }).compile();

        publisher = module.get(AssessmentRollPublisher);
    });

    it("should emit AssessmentRollCreated event with validated payload", async () => {
        const payload = {
            assessmentRollId: "roll-123",
            propertyId: "prop-456",
            assessedValue: 350000,
            taxYear: 2026,
            correlationId: "corr-789",
            timestamp: new Date().toISOString(),
        };

        await publisher.publishAssessmentRollCreated(payload);

        expect(mockClient.emit).toHaveBeenCalledWith(
            "assessment-roll.created",
            expect.objectContaining({ assessmentRollId: "roll-123" }),
        );
    });

    it("should not throw when RMQ client is null", async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [AssessmentRollPublisher, { provide: QUEUE_TOKEN, useValue: null }],
        }).compile();

        const nullPublisher = module.get(AssessmentRollPublisher);

        await expect(
            nullPublisher.publishAssessmentRollCreated({
                assessmentRollId: "roll-123",
                propertyId: "prop-456",
                assessedValue: 350000,
                taxYear: 2026,
                correlationId: "corr-789",
                timestamp: new Date().toISOString(),
            }),
        ).resolves.not.toThrow();
    });

    it("should throw ZodError for invalid payload", async () => {
        await expect(
            publisher.publishAssessmentRollCreated({
                // Missing required fields
                assessmentRollId: "roll-123",
            } as any),
        ).rejects.toThrow();
    });
});
```
