# RabbitMQ Module Registration

## 1. Component Pattern

**Type:** RabbitMQ Module (DynamicModule Factory)  
**Layer:** Infrastructure / Messaging  
**File Location:** `packages/common/src/events/rmq.module.ts`  
**Naming Convention:** `RmqModule` (singleton — one per platform)  
**Reference Implementation:** `packages/common/src/events/rmq.module.ts`

## 2. Overview

The `RmqModule` is a NestJS **DynamicModule factory** that encapsulates all RabbitMQ connection and configuration boilerplate. Domain modules never configure RMQ connections directly — they call `RmqModule.register()` with a token name and queue name, and receive a fully-configured `CivicRmqClient` instance ready for dependency injection.

This module is the single point of configuration for:

- **Connection URL** — read from `RABBITMQ_URL` environment variable
- **Exchange configuration** — `civic.revenue` (topic type, durable) for revenue domain events
- **Dead-letter queue (DLQ)** — `civic.dlx` exchange for failed messages
- **Prefetch count** — 10 messages per consumer (with manual ack via `noAck: false`)
- **Queue durability** — all queues are durable (survive broker restarts)

The `register()` static method returns a `DynamicModule` that:

1. Creates a `CivicRmqClient` instance (custom `ClientRMQ` with topic exchange support)
2. Registers it as a provider under the given `name` token
3. Exports the provider so importing modules can inject it via `@Inject(name)`

This pattern ensures that every module in the system uses **identical** RMQ configuration — exchange names, DLQ settings, prefetch counts — without duplication. Changing a setting in `RmqModule` propagates to all modules automatically.

## 3. Rules

1. **MUST** be a `@Module({})` decorated class with a static `register()` method that returns `DynamicModule`.
2. **MUST** accept an `RmqModuleOptions` object with `name` (injection token) and `queue` (RabbitMQ queue name).
3. **MUST** read the RabbitMQ connection URL from `process.env.RABBITMQ_URL` — never hardcode connection strings.
4. **MUST** create a `CivicRmqClient` instance (not a standard `ClientRMQ`) to enable topic exchange routing.
5. **MUST** configure the exchange as topic type and durable: `{ exchange: "civic.<domain>", exchangeType: "topic" }`.
6. **MUST** configure dead-letter exchange on every queue: `arguments: { "x-dead-letter-exchange": "civic.dlx" }`.
7. **MUST** set `durable: true` on all queue options — queues survive broker restarts.
8. **MUST** set `noAck: false` to enable manual acknowledgment — messages are only removed from the queue when the consumer successfully processes them.
9. **MUST** set a reasonable `prefetchCount` (default: 10) to prevent a single consumer from being overwhelmed.
10. **MUST** export the provider via the `exports` array so downstream modules can inject the client.
11. **MUST** register the client provider using the `name` from options as the injection token — this is the same token used in `@Inject(QUEUE_TOKEN)` in publishers.
12. **MUST NOT** hardcode queue names — these come from the calling module's `register()` call.
13. **MUST NOT** create multiple exchange types — use topic exchange for all event routing (it supports both exact and pattern matching).
14. **SHOULD** use `useFactory` for provider creation to allow async initialization if needed in the future.
15. **SHOULD** be located in the shared `packages/common` package so all modules can import it.

## 4. Structure

```
packages/common/
└── src/
    └── events/
        ├── rmq.module.ts          # DynamicModule factory
        ├── civic-rmq-client.ts    # Custom ClientRMQ (see rmq-client.md)
        └── index.ts               # Barrel export
```

### File Anatomy

```typescript
// ─── Imports ─────────────────────────────────────────────────────────
import { DynamicModule, Module } from "@nestjs/common";            // NestJS module system
import { CivicRmqClient } from "./civic-rmq-client";              // Custom RMQ client

// ─── Options Interface ──────────────────────────────────────────────
interface RmqModuleOptions {
    name: string;     // Injection token (e.g., "ASSESSMENT_ROLL_QUEUE")
    queue: string;    // RabbitMQ queue name (e.g., "assessment-roll-events")
}

// ─── Module Class ────────────────────────────────────────────────────
@Module({})
export class RmqModule {
    static register(options: RmqModuleOptions): DynamicModule {
        return {
            module: RmqModule,
            providers: [{ provide: options.name, useFactory: () => new CivicRmqClient({...}) }],
            exports: [options.name],
        };
    }
}
```

### How Modules Use RmqModule

```typescript
// In a domain module (e.g., assessment-roll.module.ts)
import { Module } from "@nestjs/common";
import { RmqModule } from "@civic/common";
import { AssessmentRollPublisher } from "./events/publishers/assessment-roll.publisher";

const ASSESSMENT_ROLL_QUEUE = "ASSESSMENT_ROLL_QUEUE";

@Module({
    imports: [
        RmqModule.register({
            name: ASSESSMENT_ROLL_QUEUE, // Token name
            queue: "assessment-roll-events", // Physical queue name
        }),
    ],
    providers: [AssessmentRollPublisher], // Publisher injects the client
    exports: [AssessmentRollPublisher],
})
export class AssessmentRollModule {}
```

### RMQ Topology Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        RabbitMQ Broker                          │
│                                                                 │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │  Exchange:            │    │  Exchange:                    │   │
│  │  civic.revenue        │    │  civic.dlx                    │   │
│  │  Type: topic          │    │  Type: fanout                 │   │
│  │  Durable: true        │    │  (Dead Letter Exchange)       │   │
│  └──────────┬───────────┘    └──────────────┬───────────────┘   │
│             │                                │                   │
│     routing key matching              failed messages            │
│             │                                │                   │
│  ┌──────────▼───────────┐    ┌──────────────▼───────────────┐   │
│  │  Queue:               │    │  Queue:                       │   │
│  │  assessment-roll-     │    │  dead-letter-queue             │   │
│  │    events             │    │  (for manual investigation)    │   │
│  │  Durable: true        │    │                               │   │
│  │  x-dead-letter-       │    └───────────────────────────────┘   │
│  │    exchange: civic.dlx│                                       │
│  └──────────┬───────────┘                                       │
│             │                                                   │
└─────────────┼───────────────────────────────────────────────────┘
              │
              ▼
    Consumer (Subscriber)
```

## 5. Example Implementation

### Full RmqModule Implementation

````typescript
import { DynamicModule, Module } from "@nestjs/common";
import { CivicRmqClient } from "./civic-rmq-client";

/**
 * Options for registering a RabbitMQ module.
 * Each domain module provides its own token name and queue name.
 */
interface RmqModuleOptions {
    /** Injection token — used with @Inject(name) in publishers */
    name: string;
    /** Physical RabbitMQ queue name */
    queue: string;
    /** Exchange name override (default: "civic.revenue") */
    exchange?: string;
    /** Prefetch count override (default: 10) */
    prefetchCount?: number;
}

@Module({})
export class RmqModule {
    /**
     * Creates a DynamicModule that provides a configured CivicRmqClient.
     *
     * Usage:
     * ```typescript
     * RmqModule.register({
     *     name: "ASSESSMENT_ROLL_QUEUE",
     *     queue: "assessment-roll-events",
     * })
     * ```
     */
    static register(options: RmqModuleOptions): DynamicModule {
        const { name, queue, exchange = "civic.revenue", prefetchCount = 10 } = options;

        return {
            module: RmqModule,
            providers: [
                {
                    provide: name,
                    useFactory: () => {
                        const rabbitmqUrl = process.env.RABBITMQ_URL;

                        if (!rabbitmqUrl) {
                            // Return null — publishers handle this via @Optional()
                            console.warn(
                                `[RmqModule] RABBITMQ_URL not set — ${name} client will be null`,
                            );
                            return null;
                        }

                        return new CivicRmqClient({
                            urls: [rabbitmqUrl],
                            queue,
                            queueOptions: {
                                durable: true,
                                arguments: {
                                    "x-dead-letter-exchange": "civic.dlx",
                                },
                            },
                            exchange,
                            exchangeType: "topic",
                            noAck: false,
                            prefetchCount,
                        });
                    },
                },
            ],
            exports: [name],
        };
    }
}
````

### Multiple Modules Using RmqModule

When multiple domain modules in the same application need RMQ:

```typescript
// app.module.ts
import { Module } from "@nestjs/common";
import { RmqModule } from "@civic/common";
import { AssessmentRollModule } from "./modules/assessment-roll/assessment-roll.module";
import { TaxBillingModule } from "./modules/tax-billing/tax-billing.module";
import { PaymentModule } from "./modules/payment/payment.module";

@Module({
    imports: [
        // Each module registers its own queue
        AssessmentRollModule,
        TaxBillingModule,
        PaymentModule,
    ],
})
export class AppModule {}

// ─── assessment-roll.module.ts ───────────────────────────────────────
@Module({
    imports: [
        RmqModule.register({
            name: "ASSESSMENT_ROLL_QUEUE",
            queue: "assessment-roll-events",
        }),
    ],
    providers: [AssessmentRollPublisher, AssessmentRollService],
    exports: [AssessmentRollPublisher],
})
export class AssessmentRollModule {}

// ─── tax-billing.module.ts ───────────────────────────────────────────
@Module({
    imports: [
        RmqModule.register({
            name: "TAX_BILLING_QUEUE",
            queue: "tax-billing-events",
        }),
    ],
    controllers: [AssessmentSubscriber], // Subscriber listens to assessment events
    providers: [TaxBillingPublisher, TaxBillingService, InstalmentService],
    exports: [TaxBillingPublisher],
})
export class TaxBillingModule {}

// ─── payment.module.ts ───────────────────────────────────────────────
@Module({
    imports: [
        RmqModule.register({
            name: "PAYMENT_QUEUE",
            queue: "payment-events",
        }),
    ],
    controllers: [TaxBillingSubscriber], // Subscriber listens to tax billing events
    providers: [PaymentPublisher, PaymentService],
    exports: [PaymentPublisher],
})
export class PaymentModule {}
```

### Custom Exchange Name (Non-Revenue Domain)

For modules outside the revenue domain:

```typescript
// Infrastructure domain module
RmqModule.register({
    name: "NOTIFICATION_QUEUE",
    queue: "notification-events",
    exchange: "civic.platform", // Different exchange for platform events
    prefetchCount: 20, // Higher throughput for notifications
});
```

### Environment Configuration

Required environment variables:

```bash
# .env
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Production
RABBITMQ_URL=amqp://civic_user:secure_password@rabbitmq.internal:5672/civic
```

### Unit Test — Verifying Module Registration

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { RmqModule } from "./rmq.module";

describe("RmqModule", () => {
    it("should register a provider with the given name token", async () => {
        process.env.RABBITMQ_URL = "amqp://localhost:5672";

        const module: TestingModule = await Test.createTestingModule({
            imports: [
                RmqModule.register({
                    name: "TEST_QUEUE",
                    queue: "test-events",
                }),
            ],
        }).compile();

        const client = module.get("TEST_QUEUE");
        expect(client).toBeDefined();
    });

    it("should return null when RABBITMQ_URL is not set", async () => {
        delete process.env.RABBITMQ_URL;

        const module: TestingModule = await Test.createTestingModule({
            imports: [
                RmqModule.register({
                    name: "TEST_QUEUE",
                    queue: "test-events",
                }),
            ],
        }).compile();

        const client = module.get("TEST_QUEUE");
        expect(client).toBeNull();
    });
});
```
