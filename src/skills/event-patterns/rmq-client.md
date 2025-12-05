# Custom RabbitMQ Client

## 1. Component Pattern

**Type:** Custom RabbitMQ Client (Transport Override)  
**Layer:** Infrastructure / Messaging  
**File Location:** `packages/common/src/events/custom-rmq-client.ts`  
**Naming Convention:** `CustomRmqClient` (singleton — one per platform)  
**Reference Implementation:** `packages/common/src/events/custom-rmq-client.ts`

## 2. Overview

The `CustomRmqClient` is a custom extension of NestJS's built-in `ClientRMQ` class. It overrides the `dispatchEvent()` method to enable **topic-based exchange routing** instead of the default direct-to-queue behavior.

### Why This Is Needed

NestJS's default `ClientRMQ` uses `channel.sendToQueue()` when you call `client.emit()`. This sends the message directly to a specific queue — a point-to-point pattern. However, the  myorg platform requires **topic exchange routing**, where:

1. Messages are published to an **exchange** (not a queue directly)
2. The exchange uses the **routing key** (the event name) to route messages
3. Multiple queues can **bind** to the exchange with routing key patterns
4. This enables **fan-out** — a single event can be consumed by multiple independent subscribers

For example, when `order-management.created` is published:

- The `billing` queue might bind to `order-management.*` to receive all assessment events
- The `analytics` queue might bind to `*.created` to receive all creation events across modules
- The `audit-log` queue might bind to `#` to receive all events

### How It Works

The `CustomRmqClient` overrides `dispatchEvent()` to call `channel.publish(exchange, routingKey, content, options)` instead of `channel.sendToQueue(queue, content)`. The routing key comes from the `pattern` field of the NestJS packet (which is the first argument to `client.emit(routingKey, data)`).

Messages are published with:

- `persistent: true` (`deliveryMode: 2`) — messages survive broker restarts
- `contentType: "application/json"` — payload is always JSON

## 3. Rules

1. **MUST** extend NestJS's `ClientRMQ` class — inherit all connection management and channel setup.
2. **MUST** override only the `dispatchEvent()` method — all other behavior (connection, channel, serialization) is inherited.
3. **MUST** use `channel.publish(exchange, routingKey, content, options)` — NOT `channel.sendToQueue()`.
4. **MUST** read the exchange name from `this.options` (passed during construction via `RmqModule.register()`).
5. **MUST** use `packet.pattern` as the routing key — this is the event name string passed to `client.emit()`.
6. **MUST** serialize `packet.data` to a JSON Buffer: `Buffer.from(JSON.stringify(packet.data))`.
7. **MUST** set `persistent: true` on published messages — ensures messages survive broker restarts when queues are durable.
8. **MUST** set `contentType: "application/json"` on published messages.
9. **MUST** return a `Promise` from `dispatchEvent()` that resolves on success and rejects on failure.
10. **MUST NOT** modify the inherited connection/channel lifecycle — `ClientRMQ` manages this correctly.
11. **MUST NOT** add retry logic in the client itself — retries are handled at the consumer (subscriber) level via DLQ and redelivery.
12. **MUST NOT** access `this.channel` before it's initialized — `dispatchEvent()` is only called after the connection is established.
13. **SHOULD** be located in `packages/common/src/events/` alongside `RmqModule`.
14. **SHOULD** be the only `ClientRMQ` subclass in the platform — all modules use this same client.

## 4. Structure

```
packages/common/
└── src/
    └── events/
        ├── custom-rmq-client.ts    # This file — custom ClientRMQ
        ├── rmq.module.ts          # DynamicModule factory (uses CustomRmqClient)
        └── index.ts               # Barrel export
```

### Class Hierarchy

```
ClientRMQ (NestJS)
    │
    │  Inherited:
    │  ├── connect()           — Establishes AMQP connection
    │  ├── close()             — Closes connection
    │  ├── createClient()      — Creates AMQP channel
    │  ├── handleError()       — Connection error handling
    │  ├── setupChannel()      — Asserts queue, binds exchange
    │  └── emit()              — Public API (calls dispatchEvent)
    │
    └── CustomRmqClient
         │
         └── dispatchEvent()   — OVERRIDDEN: publish to exchange
                                  instead of sendToQueue
```

### How `emit()` Flows to `dispatchEvent()`

```
Publisher code:
  this.client.emit("order-management.created", payload)
       │
       ▼
ClientProxy.emit(pattern, data)
  → Creates ReadPacket { pattern, data }
  → Calls this.dispatchEvent(packet)
       │
       ▼
CustomRmqClient.dispatchEvent(packet)
  → channel.publish("myorg.domain", "order-management.created", Buffer, options)
       │
       ▼
RabbitMQ Exchange (myorg.domain)
  → Routes by topic matching to bound queues
```

## 5. Example Implementation

### Full CustomRmqClient Implementation

```typescript
import { ClientRMQ, RmqOptions } from "@nestjs/microservices";

/**
 * Custom RabbitMQ client that publishes messages to a topic exchange
 * instead of sending directly to a queue.
 *
 * NestJS's default ClientRMQ uses `channel.sendToQueue()`, which is
 * point-to-point. We need topic exchange routing so multiple subscribers
 * can bind to routing key patterns and receive events independently.
 *
 * Usage: Created via RmqModule.register() — never instantiated directly.
 */
export class CustomRmqClient extends ClientRMQ {
    /**
     * Override dispatchEvent to publish to the configured exchange
     * using the packet's pattern as the routing key.
     *
     * Called internally by `emit()` — not called directly.
     *
     * @param packet - Contains `pattern` (routing key) and `data` (payload)
     * @returns Promise that resolves when the message is published
     */
    protected dispatchEvent(packet: { pattern: string; data: unknown }): Promise<any> {
        // Access the underlying AMQP channel (initialized by parent class)
        const channel = this.channel;

        if (!channel) {
            return Promise.reject(new Error("RMQ channel not initialized — cannot publish event"));
        }

        // Read exchange from the options passed during construction
        // Options are set by RmqModule.register() → new CustomRmqClient({ exchange: "myorg.domain", ... })
        const exchange = (this as any).options?.exchange ?? "";

        // The routing key is the event name (e.g., "order-management.created")
        // This comes from: this.client.emit("order-management.created", payload)
        const routingKey = packet.pattern;

        // Serialize the payload to a JSON buffer
        const content = Buffer.from(JSON.stringify(packet.data));

        return new Promise<void>((resolve, reject) => {
            try {
                const published = channel.publish(
                    exchange, // Target exchange (e.g., "myorg.domain")
                    routingKey, // Topic routing key (e.g., "order-management.created")
                    content, // Message body as Buffer
                    {
                        persistent: true, // deliveryMode: 2 — survives broker restart
                        contentType: "application/json",
                    },
                );

                if (published) {
                    resolve();
                } else {
                    // channel.publish returns false when the internal buffer is full
                    // This is a backpressure signal — wait for 'drain' event
                    channel.once("drain", () => resolve());
                }
            } catch (err) {
                reject(err);
            }
        });
    }
}
```

### Detailed Walkthrough: Message Flow

```typescript
// 1. Publisher calls emit (in order-management.publisher.ts)
this.client.emit(OrderManagementEvents.CREATED, validatedPayload);
// Internally: emit("order-management.created", { assessmentRollId: "...", ... })

// 2. ClientProxy.emit() creates a packet and calls dispatchEvent()
//    packet = {
//        pattern: "order-management.created",
//        data: { assessmentRollId: "roll-123", propertyId: "prop-456", ... }
//    }

// 3. CustomRmqClient.dispatchEvent() publishes to exchange
//    channel.publish(
//        "myorg.domain",                          // exchange
//        "order-management.created",                // routing key
//        Buffer.from('{"assessmentRollId":"roll-123",...}'),  // content
//        { persistent: true, contentType: "application/json" }
//    )

// 4. RabbitMQ routes the message based on topic bindings:
//    - Queue "billing-events" bound with "order-management.*"    → MATCH ✓
//    - Queue "analytics-events" bound with "*.created"              → MATCH ✓
//    - Queue "payment-events" bound with "payment.*"                → NO MATCH ✗
```

### Extended Implementation with Logging and Metrics

For production environments, you may extend with observability:

```typescript
import { ClientRMQ } from "@nestjs/microservices";
import { createLogger } from "@myorg/common";

const logger = createLogger({ module: "custom-rmq-client" });

export class CustomRmqClient extends ClientRMQ {
    protected dispatchEvent(packet: { pattern: string; data: unknown }): Promise<any> {
        const channel = this.channel;

        if (!channel) {
            logger.error("RMQ channel not initialized — cannot publish event");
            return Promise.reject(new Error("RMQ channel not initialized — cannot publish event"));
        }

        const exchange = (this as any).options?.exchange ?? "";
        const routingKey = packet.pattern;
        const content = Buffer.from(JSON.stringify(packet.data));

        return new Promise<void>((resolve, reject) => {
            try {
                const startTime = Date.now();

                const published = channel.publish(exchange, routingKey, content, {
                    persistent: true,
                    contentType: "application/json",
                });

                const duration = Date.now() - startTime;

                if (published) {
                    logger.debug(
                        {
                            exchange,
                            routingKey,
                            contentLength: content.length,
                            durationMs: duration,
                        },
                        "Message published to exchange",
                    );
                    resolve();
                } else {
                    logger.warn(
                        { exchange, routingKey },
                        "Channel buffer full — waiting for drain",
                    );
                    channel.once("drain", () => {
                        logger.info(
                            { exchange, routingKey },
                            "Channel drained — message published",
                        );
                        resolve();
                    });
                }
            } catch (err) {
                logger.error(
                    { error: err, exchange, routingKey },
                    "Failed to publish message to exchange",
                );
                reject(err);
            }
        });
    }
}
```

### How CustomRmqClient Options Are Passed

The `CustomRmqClient` receives its configuration when instantiated in `RmqModule`:

```typescript
// In RmqModule.register()
new CustomRmqClient({
    urls: [process.env.RABBITMQ_URL!], // AMQP connection URL
    queue: "order-management-events", // Queue name (used by parent for assertion)
    queueOptions: {
        durable: true, // Queue survives broker restart
        arguments: {
            "x-dead-letter-exchange": "myorg.dlx", // Failed messages go here
        },
    },
    exchange: "myorg.domain", // ← Used by CustomRmqClient.dispatchEvent()
    exchangeType: "topic", // Topic-based routing
    noAck: false, // Manual ack (consumer confirms processing)
    prefetchCount: 10, // Max unacked messages per consumer
});
```

### Unit Test Pattern

```typescript
import { CustomRmqClient } from "./custom-rmq-client";

describe("CustomRmqClient", () => {
    let client: CustomRmqClient;
    let mockChannel: {
        publish: jest.Mock;
        once: jest.Mock;
    };

    beforeEach(() => {
        // Create client with test options
        client = new CustomRmqClient({
            urls: ["amqp://localhost:5672"],
            queue: "test-queue",
            exchange: "test-exchange",
            exchangeType: "topic",
        } as any);

        // Mock the channel (normally created by parent class connect())
        mockChannel = {
            publish: jest.fn().mockReturnValue(true),
            once: jest.fn(),
        };
        (client as any).channel = mockChannel;
    });

    it("should publish to exchange with routing key", async () => {
        const packet = {
            pattern: "resource.created",
            data: { resourceId: "123", correlationId: "corr-1" },
        };

        await (client as any).dispatchEvent(packet);

        expect(mockChannel.publish).toHaveBeenCalledWith(
            "test-exchange", // exchange
            "resource.created", // routing key
            expect.any(Buffer), // content
            { persistent: true, contentType: "application/json" },
        );

        // Verify serialized content
        const publishedContent = mockChannel.publish.mock.calls[0][2];
        const parsed = JSON.parse(publishedContent.toString());
        expect(parsed).toEqual({
            resourceId: "123",
            correlationId: "corr-1",
        });
    });

    it("should reject when channel is not initialized", async () => {
        (client as any).channel = null;

        await expect(
            (client as any).dispatchEvent({
                pattern: "resource.created",
                data: {},
            }),
        ).rejects.toThrow("RMQ channel not initialized");
    });

    it("should wait for drain when channel buffer is full", async () => {
        mockChannel.publish.mockReturnValue(false); // Buffer full
        mockChannel.once.mockImplementation((event, callback) => {
            if (event === "drain") {
                // Simulate drain event after a tick
                setImmediate(callback);
            }
        });

        const packet = {
            pattern: "resource.created",
            data: { resourceId: "123" },
        };

        await (client as any).dispatchEvent(packet);

        expect(mockChannel.once).toHaveBeenCalledWith("drain", expect.any(Function));
    });

    it("should set persistent flag for message durability", async () => {
        await (client as any).dispatchEvent({
            pattern: "resource.created",
            data: {},
        });

        const options = mockChannel.publish.mock.calls[0][3];
        expect(options.persistent).toBe(true);
    });

    it("should set content type to application/json", async () => {
        await (client as any).dispatchEvent({
            pattern: "resource.created",
            data: {},
        });

        const options = mockChannel.publish.mock.calls[0][3];
        expect(options.contentType).toBe("application/json");
    });
});
```
