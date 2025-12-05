# Contract Patterns

> Canonical reference for the `@myorg/contracts` shared package — the single
> source of truth for API shapes, event payloads, and validation schemas.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

The contracts package (`packages/contracts/`) defines Zod schemas that are
shared between frontend and backend. A single schema powers request validation,
response validation, Swagger generation, TypeScript type inference, and
frontend typed API clients. No duplication — one schema, many consumers.

```
                    @myorg/contracts
                   ┌─────────────────┐
                   │  common/         │   Shared building blocks
                   │   base, money,   │   (BaseEntity, Money,
                   │   pagination,    │    Pagination, Address,
                   │   address, audit │    Audit)
                   ├─────────────────┤
                   │  contracts/      │   Per-entity API contracts
                   │   routes.ts      │   (7-section structure:
                   │   base.types.ts  │    Enums → Params → Query
                   │   revenue/       │    → Body → Response →
                   │   platform/      │    defineEndpoint → Entity)
                   ├─────────────────┤
                   │  events/         │   Event name constants
                   │   revenue/       │   + Zod payload schemas
                   │   platform/      │
                   │   shared/        │
                   └─────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Backend          Frontend       CI Checks
  Controllers      API Services    Backward
  & Services      & Data Hooks    Compatibility
```

## Pattern Documents

| #   | Pattern                                  | Description                                             |
| --- | ---------------------------------------- | ------------------------------------------------------- |
| 1   | [entity-contract.md](entity-contract.md) | 7-section Zod entity contract (enums → response)        |
| 2   | [common-schemas.md](common-schemas.md)   | Shared schemas: base, money, pagination, address, audit |
| 3   | [define-endpoint.md](define-endpoint.md) | `defineEndpoint()` typed API contract factory           |
| 4   | [route-constants.md](route-constants.md) | Centralized `/api/v1/` route constant object            |
| 5   | [event-contract.md](event-contract.md)   | Event name constants + Zod payload schemas              |
| 6   | [barrel-exports.md](barrel-exports.md)   | Package barrel export structure                         |
