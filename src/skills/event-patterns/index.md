# Event Patterns

> Canonical reference for RabbitMQ event-driven communication in the
> Civic Modules platform.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

Modules communicate asynchronously via RabbitMQ 3.13 topic exchanges.
Publishers Zod-validate and emit events to the `civic.revenue` exchange.
Subscribers bind to routing key patterns and Zod-parse incoming messages.
Failed messages route to a Dead Letter Queue (`civic.dlx`). Correlation IDs
propagate through the entire event chain for distributed tracing.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Service A   │     │  Publisher    │     │  RabbitMQ           │
│  (business   │────▶│  Zod validate│────▶│  civic.revenue      │
│   logic)     │     │  emit()      │     │  (topic exchange)   │
└─────────────┘     └──────────────┘     │                     │
                                          │  routing key:       │
                                          │  resource.created   │
                                          └──────────┬──────────┘
                                                     │
                              ┌───────────────────────┼───────────────┐
                              ▼                       ▼               ▼
                    ┌─────────────────┐   ┌──────────────────┐  ┌─────────┐
                    │  Queue A        │   │  Queue B         │  │ civic   │
                    │  (service-b)    │   │  (service-c)     │  │  .dlx   │
                    └────────┬────────┘   └────────┬─────────┘  │ (DLQ)   │
                             │                     │            └─────────┘
                    ┌────────▼────────┐   ┌────────▼─────────┐      ▲
                    │  Subscriber B   │   │  Subscriber C    │      │
                    │  @EventPattern  │   │  @EventPattern   │  on throw
                    │  Zod parse      │   │  Zod parse       │──────┘
                    │  business logic │   │  business logic  │
                    └─────────────────┘   └──────────────────┘
```

## Pattern Documents

| #   | Pattern                        | Description                                                |
| --- | ------------------------------ | ---------------------------------------------------------- |
| 1   | [publisher.md](publisher.md)   | Event publisher with Zod validation + graceful degradation |
| 2   | [subscriber.md](subscriber.md) | Event subscriber with @EventPattern + DLQ on throw         |
| 3   | [rmq-module.md](rmq-module.md) | RmqModule.register() dynamic module factory                |
| 4   | [rmq-client.md](rmq-client.md) | CivicRmqClient — topic exchange via channel.publish        |
| 5   | [event-flow.md](event-flow.md) | End-to-end event flow with error handling                  |
