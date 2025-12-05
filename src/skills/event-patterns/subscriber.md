# Event Subscriber

## 1. Component Pattern

**Type:** Event Subscriber (Consumer)  
**Layer:** Events / Infrastructure  
**File Location:** `modules/domain/<domain>/<module>/src/events/subscribers/<source-module>.subscriber.ts`  
**Naming Convention:** `<SourceModule>Subscriber` (e.g., `AssessmentSubscriber`, `PaymentSubscriber`)  
**Reference Implementation:** `modules/domain/revenue/billing/src/events/subscribers/assessment.subscriber.ts`

## 2. Overview

The Event Subscriber is the inbound event handler for a module. It listens for events published by **other** modules via RabbitMQ and triggers local business logic in response. Subscribers are the consumer half of the publish/subscribe pattern and enable **loose coupling** between modules — the publisher doesn't know (or care) who is listening.

Critically, subscribers are **NestJS Controllers** (not `@Injectable()` services). This is a NestJS framework requirement: the `@EventPattern()` decorator that binds a method to a RabbitMQ routing key only works on controller methods. The `@EventPattern()` decorator tells NestJS's microservice transport layer to route messages with the matching routing key to the decorated method.

Key design principles:

- **Payload typed as `unknown`** — The handler parameter is always `@Payload() data: unknown`. The subscriber does NOT trust the incoming data. The very first line of every handler must Zod-parse the payload, which simultaneously validates the data and narrows the TypeScript type.
- **Zod validation at the boundary** — `EventPayloadSchema.parse(data)` is the first operation. If the payload doesn't match the contract, the parse throws, the message is nacked, and it routes to the DLQ.
- **Single-source subscribers** — Each subscriber class handles events from ONE source module. If your module listens to events from order-management AND payment, you create two separate subscriber classes: `AssessmentSubscriber` and `PaymentSubscriber`.
- **Error handling via throw** — If business logic fails, the handler throws. NestJS's RMQ transport catches the error and nacks the message, routing it to the dead-letter queue (DLQ). You never manually ack/nack.
- **Delegation to services** — The subscriber itself contains zero business logic. It validates the payload, calls a service method, and logs the result. All business logic lives in the service layer.

## 3. Rules

1. **MUST** be decorated with `@Controller()` — NOT `@Injectable()`. NestJS requires `@Controller()` for `@EventPattern()` to function.
2. **MUST** use `@EventPattern(RoutingKeyEnum.EVENT_NAME)` on each handler method — import the routing key constant from `@myorg/contracts`.
3. **MUST** type the handler parameter as `@Payload() data: unknown` — never trust incoming event data with a concrete type.
4. **MUST** Zod-parse the payload as the **first operation** in every handler: `const event = EventPayloadSchema.parse(data)`.
5. **MUST** wrap business logic in try/catch — log the error with full context, then re-throw so the message routes to DLQ.
6. **MUST** inject services via constructor injection to delegate business logic.
7. **MUST** have handler methods return `Promise<void>` — event handlers never return data.
8. **MUST** create a structured logger via `createLogger({ module: "<source>-subscriber" })`.
9. **MUST** log at the start of processing (with correlation ID and entity ID) and after successful completion.
10. **MUST** log errors with the full error object, entity ID, and correlation ID before re-throwing.
11. **MUST** handle events from only ONE source module per subscriber class.
12. **MUST** import event routing keys and payload schemas from `@myorg/contracts`.
13. **MUST NOT** contain any business logic — delegate everything to the service layer.
14. **MUST NOT** manually ack or nack messages — NestJS handles this automatically (success = ack, throw = nack → DLQ).
15. **MUST NOT** catch errors and silently swallow them — always re-throw after logging so failed messages reach the DLQ for investigation.
16. **MUST NOT** use `@MessagePattern()` — that's for request/response. Events are fire-and-forget, so use `@EventPattern()`.
17. **SHOULD** name handler methods as `handle<Entity><Action>` (e.g., `handleOrderManagementCreated`, `handlePaymentReceived`).
18. **SHOULD** group all subscribers for a module in the `events/subscribers/` directory.

## 4. Structure

```
modules/domain/<domain>/<module>/
└── src/
    └── events/
        └── subscribers/
            ├── <source-module>.subscriber.ts   # Subscriber class
            └── index.ts                        # Barrel export
```

### File Anatomy

```typescript
// ─── Imports ─────────────────────────────────────────────────────────
import { Controller } from "@nestjs/common";                       // Controller decorator
import { EventPattern, Payload } from "@nestjs/microservices";     // Event binding
import { createLogger } from "@myorg/common";                      // Structured logger
import {                                                           // Event contracts
    SourceModuleEvents,                                            // Routing key enum
    EntityCreatedSchema,                                           // Zod schemas
    EntityUpdatedSchema,
    EntityDeletedSchema,
} from "@myorg/contracts";
import { LocalService } from "../../services/local.service";       // Business logic

// ─── Constants ───────────────────────────────────────────────────────
const logger = createLogger({ module: "source-subscriber" });

// ─── Subscriber Class ────────────────────────────────────────────────
@Controller()
export class SourceSubscriber {
    constructor(
        private readonly localService: LocalService,               // Injected service
    ) {}

    @EventPattern(SourceModuleEvents.ENTITY_CREATED)               // Routing key binding
    async handleEntityCreated(@Payload() data: unknown): Promise<void> {
        const event = EntityCreatedSchema.parse(data);             // Validate FIRST
        logger.info({ ... }, "Processing event");

        try {
            await this.localService.reactToEntityCreated(event);   // Delegate to service
            logger.info({ ... }, "Event processed");
        } catch (error) {
            logger.error({ error, ... }, "Failed to process event");
            throw error;                                           // → DLQ
        }
    }
}
```

### Integration with Module Registration

The subscriber must be registered as a **controller** in the NestJS module:

```typescript
import { Module } from "@nestjs/common";
import { AssessmentSubscriber } from "./events/subscribers/assessment.subscriber";
import { BillingService } from "./services/billing.service";

@Module({
    controllers: [AssessmentSubscriber], // Subscribers are controllers!
    providers: [BillingService],
})
export class BillingModule {}
```

### Microservice Bootstrap

The main application must be configured as a RMQ microservice to receive events:

```typescript
import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { AppModule } from "./app.module";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Connect RMQ microservice transport
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.RABBITMQ_URL!],
            queue: "billing-events",
            queueOptions: {
                durable: true,
                arguments: {
                    "x-dead-letter-exchange": "myorg.dlx",
                },
            },
            noAck: false,
            prefetchCount: 10,
        },
    });

    await app.startAllMicroservices();
    await app.listen(3000);
}
bootstrap();
```

## 5. Example Implementation

### Full Subscriber — Order Record Events in Billing Module

```typescript
import { Controller } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { createLogger } from "@myorg/common";
import {
    OrderManagementEvents,
    OrderManagementCreatedSchema,
    OrderManagementUpdatedSchema,
    OrderManagementDeletedSchema,
    OrderManagementStatusChangedSchema,
} from "@myorg/contracts";
import { BillingService } from "../../services/billing.service";
import { InstalmentService } from "../../services/installment.service";

const logger = createLogger({ module: "assessment-subscriber" });

@Controller()
export class AssessmentSubscriber {
    constructor(
        private readonly taxBillingService: BillingService,
        private readonly installmentService: InstalmentService,
    ) {}

    /**
     * Handles new order record creation.
     * Creates a corresponding billing record for the target record.
     */
    @EventPattern(OrderManagementEvents.CREATED)
    async handleOrderManagementCreated(@Payload() data: unknown): Promise<void> {
        const event = OrderManagementCreatedSchema.parse(data);
        logger.info(
            {
                correlationId: event.correlationId,
                assessmentRollId: event.assessmentRollId,
                propertyId: event.propertyId,
            },
            "Processing OrderManagementCreated event",
        );

        try {
            await this.taxBillingService.createBillingFromAssessment({
                assessmentRollId: event.assessmentRollId,
                propertyId: event.propertyId,
                assessedValue: event.assessedValue,
                taxYear: event.taxYear,
                correlationId: event.correlationId,
            });

            logger.info(
                {
                    assessmentRollId: event.assessmentRollId,
                    propertyId: event.propertyId,
                },
                "Tax billing record created from assessment",
            );
        } catch (error) {
            logger.error(
                {
                    error,
                    assessmentRollId: event.assessmentRollId,
                    propertyId: event.propertyId,
                    correlationId: event.correlationId,
                },
                "Failed to create billing from assessment",
            );
            throw error; // Message routes to DLQ
        }
    }

    /**
     * Handles order record updates.
     * Recalculates the billing amount based on the updated assessment value.
     */
    @EventPattern(OrderManagementEvents.UPDATED)
    async handleOrderManagementUpdated(@Payload() data: unknown): Promise<void> {
        const event = OrderManagementUpdatedSchema.parse(data);
        logger.info(
            {
                correlationId: event.correlationId,
                assessmentRollId: event.assessmentRollId,
            },
            "Processing OrderManagementUpdated event",
        );

        try {
            await this.taxBillingService.recalculateBilling({
                assessmentRollId: event.assessmentRollId,
                newAssessedValue: event.assessedValue,
                correlationId: event.correlationId,
            });

            logger.info(
                { assessmentRollId: event.assessmentRollId },
                "Tax billing recalculated from updated assessment",
            );
        } catch (error) {
            logger.error(
                {
                    error,
                    assessmentRollId: event.assessmentRollId,
                    correlationId: event.correlationId,
                },
                "Failed to recalculate billing from updated assessment",
            );
            throw error;
        }
    }

    /**
     * Handles order record deletion.
     * Deactivates the corresponding billing record.
     */
    @EventPattern(OrderManagementEvents.DELETED)
    async handleOrderManagementDeleted(@Payload() data: unknown): Promise<void> {
        const event = OrderManagementDeletedSchema.parse(data);
        logger.info(
            {
                correlationId: event.correlationId,
                assessmentRollId: event.assessmentRollId,
            },
            "Processing OrderManagementDeleted event",
        );

        try {
            await this.taxBillingService.deactivateBillingForAssessment(
                event.assessmentRollId,
                event.correlationId,
            );

            logger.info(
                { assessmentRollId: event.assessmentRollId },
                "Tax billing deactivated for deleted assessment",
            );
        } catch (error) {
            logger.error(
                {
                    error,
                    assessmentRollId: event.assessmentRollId,
                    correlationId: event.correlationId,
                },
                "Failed to deactivate billing for deleted assessment",
            );
            throw error;
        }
    }

    /**
     * Handles order record status changes (DRAFT → CERTIFIED → FINAL).
     * When status becomes FINAL, generates installment schedule.
     */
    @EventPattern(OrderManagementEvents.STATUS_CHANGED)
    async handleOrderManagementStatusChanged(@Payload() data: unknown): Promise<void> {
        const event = OrderManagementStatusChangedSchema.parse(data);
        logger.info(
            {
                correlationId: event.correlationId,
                assessmentRollId: event.assessmentRollId,
                previousStatus: event.previousStatus,
                newStatus: event.newStatus,
            },
            "Processing OrderManagementStatusChanged event",
        );

        try {
            // Only generate installments when assessment is finalized
            if (event.newStatus === "FINAL") {
                await this.installmentService.generateInstalmentSchedule({
                    assessmentRollId: event.assessmentRollId,
                    correlationId: event.correlationId,
                });

                logger.info(
                    { assessmentRollId: event.assessmentRollId },
                    "Instalment schedule generated for finalized assessment",
                );
            } else {
                logger.info(
                    {
                        assessmentRollId: event.assessmentRollId,
                        newStatus: event.newStatus,
                    },
                    "Status change noted — no installment action required",
                );
            }
        } catch (error) {
            logger.error(
                {
                    error,
                    assessmentRollId: event.assessmentRollId,
                    newStatus: event.newStatus,
                    correlationId: event.correlationId,
                },
                "Failed to process order record status change",
            );
            throw error;
        }
    }
}
```

### Minimal Subscriber — Single Event

For modules that only need to react to one event from a source:

```typescript
import { Controller } from "@nestjs/common";
import { EventPattern, Payload } from "@nestjs/microservices";
import { createLogger } from "@myorg/common";
import { PaymentEvents, PaymentReceivedSchema } from "@myorg/contracts";
import { AccountService } from "../../services/account.service";

const logger = createLogger({ module: "payment-subscriber" });

@Controller()
export class PaymentSubscriber {
    constructor(private readonly accountService: AccountService) {}

    @EventPattern(PaymentEvents.RECEIVED)
    async handlePaymentReceived(@Payload() data: unknown): Promise<void> {
        const event = PaymentReceivedSchema.parse(data);
        logger.info(
            {
                correlationId: event.correlationId,
                paymentId: event.paymentId,
                accountId: event.accountId,
            },
            "Processing PaymentReceived event",
        );

        try {
            await this.accountService.applyPayment({
                paymentId: event.paymentId,
                accountId: event.accountId,
                amount: event.amount,
                correlationId: event.correlationId,
            });

            logger.info(
                { paymentId: event.paymentId, accountId: event.accountId },
                "Payment applied to account",
            );
        } catch (error) {
            logger.error(
                {
                    error,
                    paymentId: event.paymentId,
                    accountId: event.accountId,
                    correlationId: event.correlationId,
                },
                "Failed to apply payment to account",
            );
            throw error;
        }
    }
}
```

### Unit Test Pattern

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { AssessmentSubscriber } from "./assessment.subscriber";
import { BillingService } from "../../services/billing.service";
import { InstalmentService } from "../../services/installment.service";

describe("AssessmentSubscriber", () => {
    let subscriber: AssessmentSubscriber;
    let taxBillingService: jest.Mocked<BillingService>;
    let installmentService: jest.Mocked<InstalmentService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AssessmentSubscriber],
            providers: [
                {
                    provide: BillingService,
                    useValue: {
                        createBillingFromAssessment: jest.fn(),
                        recalculateBilling: jest.fn(),
                        deactivateBillingForAssessment: jest.fn(),
                    },
                },
                {
                    provide: InstalmentService,
                    useValue: {
                        generateInstalmentSchedule: jest.fn(),
                    },
                },
            ],
        }).compile();

        subscriber = module.get(AssessmentSubscriber);
        taxBillingService = module.get(BillingService);
        installmentService = module.get(InstalmentService);
    });

    it("should create billing from order record created event", async () => {
        const payload = {
            assessmentRollId: "roll-123",
            propertyId: "prop-456",
            assessedValue: 350000,
            taxYear: 2026,
            correlationId: "corr-789",
            timestamp: new Date().toISOString(),
        };

        await subscriber.handleOrderManagementCreated(payload);

        expect(taxBillingService.createBillingFromAssessment).toHaveBeenCalledWith(
            expect.objectContaining({
                assessmentRollId: "roll-123",
                propertyId: "prop-456",
                assessedValue: 350000,
            }),
        );
    });

    it("should throw and route to DLQ on invalid payload", async () => {
        await expect(subscriber.handleOrderManagementCreated({ invalid: "data" })).rejects.toThrow();
    });

    it("should throw and route to DLQ on service failure", async () => {
        taxBillingService.createBillingFromAssessment.mockRejectedValue(
            new Error("Database connection lost"),
        );

        const payload = {
            assessmentRollId: "roll-123",
            propertyId: "prop-456",
            assessedValue: 350000,
            taxYear: 2026,
            correlationId: "corr-789",
            timestamp: new Date().toISOString(),
        };

        await expect(subscriber.handleOrderManagementCreated(payload)).rejects.toThrow(
            "Database connection lost",
        );
    });

    it("should generate installments when status changes to FINAL", async () => {
        const payload = {
            assessmentRollId: "roll-123",
            previousStatus: "CERTIFIED",
            newStatus: "FINAL",
            correlationId: "corr-789",
            timestamp: new Date().toISOString(),
        };

        await subscriber.handleOrderManagementStatusChanged(payload);

        expect(installmentService.generateInstalmentSchedule).toHaveBeenCalledWith(
            expect.objectContaining({ assessmentRollId: "roll-123" }),
        );
    });

    it("should NOT generate installments for non-FINAL status changes", async () => {
        const payload = {
            assessmentRollId: "roll-123",
            previousStatus: "DRAFT",
            newStatus: "CERTIFIED",
            correlationId: "corr-789",
            timestamp: new Date().toISOString(),
        };

        await subscriber.handleOrderManagementStatusChanged(payload);

        expect(installmentService.generateInstalmentSchedule).not.toHaveBeenCalled();
    });
});
```
