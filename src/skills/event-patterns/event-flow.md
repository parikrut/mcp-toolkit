# End-to-End Event Flow

## 1. Component Pattern

**Type:** Architectural Flow (Cross-cutting)  
**Layer:** All Layers — Service → Publisher → RMQ → Subscriber → Service  
**Scope:** Describes the complete lifecycle of a domain event from origin to consumption  
**Related Patterns:** [publisher.md](./publisher.md), [subscriber.md](./subscriber.md), [rmq-module.md](./rmq-module.md), [rmq-client.md](./rmq-client.md)

## 2. Overview

This document describes the complete end-to-end flow of a domain event in the  myorg platform — from the moment a business operation triggers an event to the moment a downstream module processes it. Understanding this flow is essential for building new modules that participate in the event-driven architecture.

### The Flow at a Glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        MODULE A (Publisher Side)                         │
│                                                                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────────┐   │
│  │  Controller  │───▶│    Service        │───▶│    Publisher           │   │
│  │              │    │                  │    │                       │   │
│  │  HTTP POST   │    │  Business logic  │    │  1. Check RMQ client  │   │
│  │  ───────▶    │    │  Persist to DB   │    │  2. Zod validate      │   │
│  │  correlationId    │  Call publisher   │    │  3. client.emit()     │   │
│  └─────────────┘    └──────────────────┘    └───────────┬───────────┘   │
│                                                          │               │
└──────────────────────────────────────────────────────────┼───────────────┘
                                                           │
                                              CustomRmqClient.dispatchEvent()
                                              channel.publish(exchange, key, data)
                                                           │
┌──────────────────────────────────────────────────────────┼───────────────┐
│                        RABBITMQ BROKER                    │               │
│                                                           ▼               │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Exchange: myorg.domain (topic, durable)                          │  │
│  │                                                                    │  │
│  │  Routing Key: "order-management.created"                            │  │
│  │         │                                                          │  │
│  │         ├──── matches "order-management.*" ──▶ billing-queue    │  │
│  │         ├──── matches "*.created"         ──▶ analytics-queue      │  │
│  │         └──── matches "#"                 ──▶ audit-log-queue      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────┐     ┌─────────────────────────────────────┐  │
│  │  myorg.dlx (fanout)    │◀────│  Failed messages (nacked, thrown)   │  │
│  │  Dead Letter Exchange  │     │  after consumer error               │  │
│  └───────────┬────────────┘     └─────────────────────────────────────┘  │
│              │                                                           │
│              ▼                                                           │
│  ┌────────────────────────┐                                              │
│  │  dead-letter-queue     │   (For manual investigation & retry)         │
│  └────────────────────────┘                                              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                                                           │
                                              Consumer pulls message
                                              from bound queue
                                                           │
┌──────────────────────────────────────────────────────────┼───────────────┐
│                        MODULE B (Subscriber Side)         │               │
│                                                           ▼               │
│  ┌───────────────────────┐    ┌──────────────────┐    ┌─────────────┐   │
│  │    Subscriber          │───▶│    Service        │───▶│  Repository  │   │
│  │    (@Controller)       │    │                  │    │             │   │
│  │                       │    │  Business logic  │    │  Persist    │   │
│  │  1. @EventPattern()   │    │  React to event  │    │  to DB      │   │
│  │  2. Zod parse payload │    │  Domain rules    │    │             │   │
│  │  3. Call service      │    │                  │    │             │   │
│  │  4. Success → ack     │    └──────────────────┘    └─────────────┘   │
│  │  5. Throw  → DLQ     │                                               │
│  └───────────────────────┘                                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Fire-and-forget publishing** — The publisher emits the event and continues. It does NOT wait for consumers to process the message.
2. **Zod validation at every boundary** — The publisher validates before sending; the subscriber validates after receiving. Double validation ensures contract compliance even if contracts evolve independently.
3. **Graceful degradation** — If RabbitMQ is unavailable, the publisher skips the event (logs a warning). The core business operation (DB write) still succeeds.
4. **CorrelationId propagation** — Every event carries a `correlationId` that originated at the HTTP request level. This enables distributed tracing across modules.
5. **Error → DLQ** — If a subscriber's handler throws, the message is nacked and routed to the dead-letter exchange (`myorg.dlx`). Messages are never silently lost.
6. **Loose coupling** — Publishers don't know who subscribes. Subscribers don't know who publishes. They only share the event contract schema.

## 3. Rules

### Publishing Rules

1. **MUST** persist data to the database BEFORE publishing the event — the DB write is the source of truth. If the event fails to publish, data is still consistent.
2. **MUST** pass a `correlationId` from the controller/request context through the service to the publisher.
3. **MUST** Zod-validate the payload in the publisher before calling `emit()`.
4. **MUST** handle RMQ unavailability gracefully — check `if (!this.client)` and return early.
5. **MUST NOT** make the business operation depend on event delivery — the DB write must succeed even if RMQ is down.
6. **MUST NOT** publish events from controllers — always go through the service layer first.

### Subscriber Rules

7. **MUST** Zod-parse the incoming payload as the first operation — before any business logic.
8. **MUST** delegate all business logic to the service layer — subscribers are thin routing layers.
9. **MUST** throw errors to send failed messages to the DLQ — never catch and swallow.
10. **MUST** log the correlationId, entity ID, and event name at both the start and end of processing.
11. **MUST NOT** manually ack or nack messages — NestJS handles this via the `noAck: false` configuration.

### Routing Rules

12. **MUST** use topic exchange (`myorg.<domain>`) — supports pattern matching on routing keys.
13. **MUST** use dot-separated routing keys: `<source-module>.<action>` (e.g., `order-management.created`).
14. **MUST** configure dead-letter exchange (`myorg.dlx`) on every consumer queue.
15. **MUST** set `prefetchCount` to control consumer throughput (default: 10).

### Contract Rules

16. **MUST** define all event routing keys and payload schemas in `@myorg/contracts`.
17. **MUST** version schemas carefully — adding fields is safe; removing or changing field types is a breaking change.
18. **MUST** include `correlationId` and `timestamp` in every event payload schema.
19. **MUST** include the primary entity ID in every event payload (e.g., `assessmentRollId`, `paymentId`).

## 4. Structure

### Directory Layout Across Modules

```
modules/domain/<domain>/
├── <publisher-module>/
│   └── src/
│       ├── controllers/
│       │   └── resource.controller.ts           # HTTP entry point
│       ├── services/
│       │   └── resource.service.ts              # Business logic + calls publisher
│       ├── events/
│       │   └── publishers/
│       │       └── resource.publisher.ts         # Emits events to RMQ
│       └── <module>.module.ts                   # Imports RmqModule.register()
│
├── <subscriber-module>/
│   └── src/
│       ├── controllers/
│       │   └── local-resource.controller.ts     # HTTP endpoints (if any)
│       ├── services/
│       │   └── local-resource.service.ts        # Business logic (called by subscriber)
│       ├── events/
│       │   └── subscribers/
│       │       └── <source>.subscriber.ts        # Receives events from RMQ
│       └── <module>.module.ts                   # Registers subscriber as controller
│
packages/
├── common/
│   └── src/events/
│       ├── rmq.module.ts                        # RmqModule DynamicModule factory
│       └── custom-rmq-client.ts                  # Custom ClientRMQ (topic exchange)
│
└── contracts/
    └── src/events/
        ├── <module>/
        │   ├── events.ts                        # Routing key enum
        │   └── schemas.ts                       # Zod payload schemas + TS types
        └── index.ts                             # Barrel exports
```

### Event Contract Structure

```typescript
// packages/contracts/src/events/order-management/events.ts
export const OrderManagementEvents = {
    CREATED: "order-management.created",
    UPDATED: "order-management.updated",
    DELETED: "order-management.deleted",
    STATUS_CHANGED: "order-management.status-changed",
} as const;

// packages/contracts/src/events/order-management/schemas.ts
import { z } from "zod";

/** Base fields present in ALL events */
const BaseEventSchema = z.object({
    correlationId: z.string().uuid(),
    timestamp: z.string().datetime(),
});

export const OrderManagementCreatedSchema = BaseEventSchema.extend({
    assessmentRollId: z.string().uuid(),
    propertyId: z.string().uuid(),
    assessedValue: z.number().positive(),
    taxYear: z.number().int().min(2000).max(2100),
});

export type OrderManagementCreatedPayload = z.infer<typeof OrderManagementCreatedSchema>;

export const OrderManagementUpdatedSchema = BaseEventSchema.extend({
    assessmentRollId: z.string().uuid(),
    assessedValue: z.number().positive(),
    previousAssessedValue: z.number().positive(),
});

export type OrderManagementUpdatedPayload = z.infer<typeof OrderManagementUpdatedSchema>;

export const OrderManagementDeletedSchema = BaseEventSchema.extend({
    assessmentRollId: z.string().uuid(),
    reason: z.string().optional(),
});

export type OrderManagementDeletedPayload = z.infer<typeof OrderManagementDeletedSchema>;

export const OrderManagementStatusChangedSchema = BaseEventSchema.extend({
    assessmentRollId: z.string().uuid(),
    previousStatus: z.string(),
    newStatus: z.string(),
});

export type OrderManagementStatusChangedPayload = z.infer<typeof OrderManagementStatusChangedSchema>;
```

## 5. Example Implementation

### Complete End-to-End Example: Order Record → Billing

This example traces a single event from HTTP request to downstream processing.

---

#### Step 1: Controller — HTTP Entry Point (Module A)

```typescript
// modules/domain/revenue/order-management/src/controllers/order-management.controller.ts
import { Controller, Post, Body, Headers } from "@nestjs/common";
import { OrderManagementService } from "../services/order-management.service";
import { CreateOrderManagementDto } from "../dto/create-order-management.dto";
import { v4 as uuidv4 } from "uuid";

@Controller("order-managements")
export class OrderManagementController {
    constructor(private readonly assessmentRollService: OrderManagementService) {}

    @Post()
    async create(
        @Body() dto: CreateOrderManagementDto,
        @Headers("x-correlation-id") correlationId?: string,
    ) {
        // Generate correlationId if not provided by the caller
        const corrId = correlationId ?? uuidv4();

        // Service handles business logic AND event publishing
        const result = await this.assessmentRollService.create(dto, corrId);

        return {
            data: result,
            meta: { correlationId: corrId },
        };
    }
}
```

---

#### Step 2: Service — Business Logic + Event Publishing (Module A)

```typescript
// modules/domain/revenue/order-management/src/services/order-management.service.ts
import { Injectable } from "@nestjs/common";
import { createLogger } from "@myorg/common";
import { OrderManagementRepository } from "../repositories/order-management.repository";
import { OrderManagementPublisher } from "../events/publishers/order-management.publisher";
import { CreateOrderManagementDto } from "../dto/create-order-management.dto";

const logger = createLogger({ module: "order-management-service" });

@Injectable()
export class OrderManagementService {
    constructor(
        private readonly repository: OrderManagementRepository,
        private readonly publisher: OrderManagementPublisher,
    ) {}

    async create(dto: CreateOrderManagementDto, correlationId: string) {
        logger.info({ correlationId, propertyId: dto.propertyId }, "Creating order record");

        // ── Step 2a: Persist to database FIRST ──────────────────
        // The DB write is the source of truth.
        // If the event publish fails later, the data is still consistent.
        const assessmentRoll = await this.repository.create({
            propertyId: dto.propertyId,
            assessedValue: dto.assessedValue,
            taxYear: dto.taxYear,
            status: "DRAFT",
        });

        logger.info(
            { assessmentRollId: assessmentRoll.id, correlationId },
            "Assessment roll persisted to database",
        );

        // ── Step 2b: Publish event AFTER persistence ────────────
        // This is fire-and-forget. If RMQ is down, it logs a warning
        // and returns — the business operation is not affected.
        await this.publisher.publishOrderManagementCreated({
            assessmentRollId: assessmentRoll.id,
            propertyId: assessmentRoll.propertyId,
            assessedValue: assessmentRoll.assessedValue,
            taxYear: assessmentRoll.taxYear,
            correlationId,
            timestamp: new Date().toISOString(),
        });

        return assessmentRoll;
    }
}
```

---

#### Step 3: Publisher — Validate and Emit (Module A)

```typescript
// modules/domain/revenue/order-management/src/events/publishers/order-management.publisher.ts
import { Injectable, Optional, Inject } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { createLogger } from "@myorg/common";
import {
    OrderManagementEvents,
    OrderManagementCreatedSchema,
    type OrderManagementCreatedPayload,
} from "@myorg/contracts";

const QUEUE_TOKEN = "ORDER_MANAGEMENT_QUEUE";
const logger = createLogger({ module: "order-management-publisher" });

@Injectable()
export class OrderManagementPublisher {
    constructor(
        @Optional()
        @Inject(QUEUE_TOKEN)
        private readonly client: ClientProxy | null,
    ) {}

    async publishOrderManagementCreated(payload: OrderManagementCreatedPayload): Promise<void> {
        // ── Step 3a: Graceful degradation ────────────────────────
        if (!this.client) {
            logger.warn("RMQ client not available — skipping OrderManagementCreated publish");
            return;
        }

        // ── Step 3b: Zod validate payload ────────────────────────
        // If this throws, it's a bug in the calling code.
        const validated = OrderManagementCreatedSchema.parse(payload);

        // ── Step 3c: Emit to RMQ ─────────────────────────────────
        // client.emit() → CustomRmqClient.dispatchEvent()
        //   → channel.publish("myorg.domain", "order-management.created", ...)
        this.client.emit(OrderManagementEvents.CREATED, validated);

        logger.info(
            {
                event: OrderManagementEvents.CREATED,
                assessmentRollId: validated.assessmentRollId,
                correlationId: validated.correlationId,
            },
            "OrderManagementCreated event published",
        );
    }
}
```

---

#### Step 4: CustomRmqClient — Publish to Exchange (Infrastructure)

```typescript
// packages/common/src/events/custom-rmq-client.ts
// (This is called internally — no module code touches this directly)

// client.emit("order-management.created", validatedPayload)
//   ↓
// CustomRmqClient.dispatchEvent({
//     pattern: "order-management.created",
//     data: { assessmentRollId: "roll-123", propertyId: "prop-456", ... }
// })
//   ↓
// channel.publish(
//     "myorg.domain",              // exchange
//     "order-management.created",    // routing key
//     Buffer<JSON payload>,         // content
//     { persistent: true, contentType: "application/json" }
// )
```

---

#### Step 5: RabbitMQ — Route Message (Broker)

```
Exchange: myorg.domain (topic)
Routing Key: "order-management.created"

Bindings:
  ┌──────────────────────────────────┬────────────────────────┬──────────┐
  │  Queue                           │  Binding Key           │  Match?  │
  ├──────────────────────────────────┼────────────────────────┼──────────┤
  │  billing-events   │  order-management.*     │  YES ✓   │
  │  analytics-events                │  *.created             │  YES ✓   │
  │  audit-log-events                │  #                     │  YES ✓   │
  │  payment-events                  │  payment.*             │  NO  ✗   │
  └──────────────────────────────────┴────────────────────────┴──────────┘

Message delivered to: billing-events, analytics-events, audit-log-events
```

---

#### Step 6: Subscriber — Receive and Validate (Module B)

```typescript
// modules/domain/revenue/billing/src/events/subscribers/assessment.subscriber.ts
import { Controller } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { createLogger } from "@myorg/common";
import { OrderManagementEvents, OrderManagementCreatedSchema } from "@myorg/contracts";
import { BillingService } from "../../services/billing.service";

const logger = createLogger({ module: "assessment-subscriber" });

@Controller()
export class AssessmentSubscriber {
    constructor(private readonly taxBillingService: BillingService) {}

    @EventPattern(OrderManagementEvents.CREATED)
    async handleOrderManagementCreated(@Payload() data: unknown): Promise<void> {
        // ── Step 6a: Zod parse incoming payload ──────────────────
        // `data` is typed as `unknown` — we don't trust incoming messages.
        // Parsing validates AND narrows the TypeScript type.
        const event = OrderManagementCreatedSchema.parse(data);

        logger.info(
            {
                correlationId: event.correlationId,
                assessmentRollId: event.assessmentRollId,
                propertyId: event.propertyId,
            },
            "Received OrderManagementCreated event",
        );

        try {
            // ── Step 6b: Delegate to service ─────────────────────
            await this.taxBillingService.createBillingFromAssessment({
                assessmentRollId: event.assessmentRollId,
                propertyId: event.propertyId,
                assessedValue: event.assessedValue,
                taxYear: event.taxYear,
                correlationId: event.correlationId,
            });

            // ── Step 6c: Success → message is auto-acked ────────
            logger.info(
                {
                    assessmentRollId: event.assessmentRollId,
                    correlationId: event.correlationId,
                },
                "OrderManagementCreated event processed successfully",
            );
        } catch (error) {
            // ── Step 6d: Failure → throw → nack → DLQ ───────────
            logger.error(
                {
                    error,
                    assessmentRollId: event.assessmentRollId,
                    correlationId: event.correlationId,
                },
                "Failed to process OrderManagementCreated event",
            );
            throw error; // NestJS catches this → nacks message → DLQ
        }
    }
}
```

---

#### Step 7: Service — React to Event (Module B)

```typescript
// modules/domain/revenue/billing/src/services/billing.service.ts
import { Injectable } from "@nestjs/common";
import { createLogger } from "@myorg/common";
import { BillingRepository } from "../repositories/billing.repository";
import { BillingPublisher } from "../events/publishers/billing.publisher";

const logger = createLogger({ module: "billing-service" });

@Injectable()
export class BillingService {
    constructor(
        private readonly repository: BillingRepository,
        private readonly publisher: BillingPublisher,
    ) {}

    async createBillingFromAssessment(params: {
        assessmentRollId: string;
        propertyId: string;
        assessedValue: number;
        taxYear: number;
        correlationId: string;
    }): Promise<void> {
        logger.info(
            {
                correlationId: params.correlationId,
                assessmentRollId: params.assessmentRollId,
            },
            "Creating billing from assessment",
        );

        // Calculate tax amount based on municipal tax rate
        const taxRate = 0.012; // 1.2% — would come from a rate service in production
        const taxAmount = params.assessedValue * taxRate;

        // Persist the billing record
        const billing = await this.repository.create({
            assessmentRollId: params.assessmentRollId,
            propertyId: params.propertyId,
            taxYear: params.taxYear,
            assessedValue: params.assessedValue,
            taxAmount,
            status: "PENDING",
        });

        logger.info(
            {
                billingId: billing.id,
                taxAmount,
                correlationId: params.correlationId,
            },
            "Tax billing created",
        );

        // Optionally chain another event: "billing.created"
        // This enables further downstream reactions (e.g., notification module)
        await this.publisher.publishBillingCreated({
            billingId: billing.id,
            propertyId: billing.propertyId,
            taxAmount: billing.taxAmount,
            taxYear: billing.taxYear,
            correlationId: params.correlationId,
            timestamp: new Date().toISOString(),
        });
    }
}
```

---

### Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ERROR SCENARIOS                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Scenario 1: RMQ Unavailable (Publisher Side)                   │    │
│  │                                                                 │    │
│  │  Service → Publisher.publishX() → client is null                │    │
│  │                          │                                      │    │
│  │                          ├─ Log warning                         │    │
│  │                          └─ Return void (no crash)              │    │
│  │                                                                 │    │
│  │  Result: DB write succeeds. Event is lost. No downstream        │    │
│  │          reaction until data is re-synced or event replayed.    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Scenario 2: Invalid Payload (Publisher Side)                   │    │
│  │                                                                 │    │
│  │  Service → Publisher.publishX() → Schema.parse() throws        │    │
│  │                          │                                      │    │
│  │                          └─ ZodError propagates to service      │    │
│  │                             → Service can catch or let it       │    │
│  │                               propagate to controller           │    │
│  │                                                                 │    │
│  │  Result: Bug in code. Fix the payload construction.             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Scenario 3: Invalid Payload (Subscriber Side)                  │    │
│  │                                                                 │    │
│  │  Subscriber → Schema.parse(data) throws ZodError               │    │
│  │                          │                                      │    │
│  │                          └─ Error bubbles up                    │    │
│  │                             → NestJS nacks message              │    │
│  │                             → Message routed to DLQ             │    │
│  │                                                                 │    │
│  │  Result: Contract mismatch. Check schema versions.              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Scenario 4: Business Logic Failure (Subscriber Side)           │    │
│  │                                                                 │    │
│  │  Subscriber → Service.handleEvent() throws Error                │    │
│  │                          │                                      │    │
│  │                          ├─ Log error with context              │    │
│  │                          └─ Re-throw error                      │    │
│  │                             → NestJS nacks message              │    │
│  │                             → Message routed to DLQ             │    │
│  │                                                                 │    │
│  │  Result: Message preserved in DLQ. Can be replayed after fix.   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### CorrelationId Flow

```
HTTP Request
│  Header: x-correlation-id: "corr-abc-123"
│
▼
Controller
│  const correlationId = headers["x-correlation-id"] ?? uuidv4();
│
▼
Service (Module A)
│  await publisher.publishEvent({ ..., correlationId });
│
▼
Publisher (Module A)
│  // correlationId is part of the Zod-validated payload
│  client.emit(routingKey, { ..., correlationId: "corr-abc-123" });
│
▼
RabbitMQ
│  // correlationId travels in the message payload
│
▼
Subscriber (Module B)
│  const event = Schema.parse(data);
│  // event.correlationId === "corr-abc-123"
│  logger.info({ correlationId: event.correlationId }, "Processing event");
│
▼
Service (Module B)
│  // Can chain further events with the same correlationId
│  await publisher.publishDownstreamEvent({ ..., correlationId: event.correlationId });
│
▼
Subscriber (Module C)
│  // Same correlationId: "corr-abc-123"
│  // Entire distributed flow is traceable
```

---

### Module Registration Summary

```typescript
// ─── Module A: Order Record (Publisher) ───────────────────────────
@Module({
    imports: [
        RmqModule.register({
            name: "ORDER_MANAGEMENT_QUEUE",
            queue: "order-management-events",
        }),
    ],
    controllers: [OrderManagementController],
    providers: [OrderManagementService, OrderManagementRepository, OrderManagementPublisher],
})
export class OrderManagementModule {}

// ─── Module B: Billing Instalment (Subscriber + Publisher) ──────
@Module({
    imports: [
        RmqModule.register({
            name: "BILLING_QUEUE",
            queue: "billing-events",
        }),
    ],
    controllers: [
        BillingController, // HTTP endpoints
        AssessmentSubscriber, // Event consumer (also a @Controller!)
    ],
    providers: [BillingService, BillingRepository, InstalmentService, BillingPublisher],
})
export class BillingModule {}
```

---

### Quick Reference: What Goes Where

| Concern                  | Location                                    | Decorator/Pattern                           |
| ------------------------ | ------------------------------------------- | ------------------------------------------- |
| HTTP entry point         | `controllers/<resource>.controller.ts`      | `@Controller()`, `@Post()`, `@Get()`        |
| Business logic           | `services/<resource>.service.ts`            | `@Injectable()`                             |
| Event publishing         | `events/publishers/<resource>.publisher.ts` | `@Injectable()`, `@Optional()`, `@Inject()` |
| Event subscribing        | `events/subscribers/<source>.subscriber.ts` | `@Controller()`, `@EventPattern()`          |
| RMQ connection config    | `RmqModule.register()` in module imports    | `DynamicModule`                             |
| Custom RMQ client        | `packages/common/src/events/`               | `extends ClientRMQ`                         |
| Event routing keys       | `packages/contracts/src/events/`            | `const enum`                                |
| Event payload schemas    | `packages/contracts/src/events/`            | `z.object()`, `z.infer<>`                   |
| CorrelationId generation | Controller (from header or `uuidv4()`)      | `@Headers("x-correlation-id")`              |
