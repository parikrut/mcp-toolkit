# Database Patterns

> Canonical reference for PostgreSQL database design and Prisma ORM usage
> in your microservices platform.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

Each microservice module owns its own PostgreSQL database (DB-per-service).
Prisma 7+ is the ORM with the native `@prisma/adapter-pg` driver. Schema
design follows strict conventions: UUID primary keys, BigInt cents for money,
audit fields on every model, and soft deletes. The repository layer is the
only code that touches Prisma — services never call `prisma.*` directly.

```
┌───────────────────────────────────────────────────┐
│  Module A (order-management)                       │
│  ┌─────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ Service  │→ │ Repository │→ │ PrismaService │  │
│  └─────────┘  └────────────┘  └───────┬───────┘  │
│                                       │           │
│                    ┌──────────────────┐│           │
│                    │ schema.prisma    ││           │
│                    │ seed.ts          ││           │
│                    │ generated/prisma ││           │
│                    └──────────────────┘│           │
└───────────────────────────────────────┼───────────┘
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  PostgreSQL 16   │
                              │  order_management │
                              └─────────────────┘

┌───────────────────────────────────────────────────┐
│  Module B (billing)                           │
│             ...same structure...                  │
└───────────────────────────────┬───────────────────┘
                                │
                                ▼
                      ┌─────────────────────┐
                      │  PostgreSQL 16       │
                      │  billing_instal  │
                      └─────────────────────┘
```

## Pattern Documents

| #   | Pattern                                        | Description                                      |
| --- | ---------------------------------------------- | ------------------------------------------------ |
| 1   | [prisma-schema.md](prisma-schema.md)           | Prisma schema conventions (UUID, audit, BigInt)  |
| 2   | [prisma-service.md](prisma-service.md)         | PrismaService with @prisma/adapter-pg connection |
| 3   | [repository-pattern.md](repository-pattern.md) | Repository layer — dynamic where, soft delete    |
| 4   | [seed-data.md](seed-data.md)                   | Idempotent seed scripts with deterministic UUIDs |
| 5   | [db-per-service.md](db-per-service.md)         | Database-per-service architecture                |
| 6   | [env-validation.md](env-validation.md)         | Zod-based environment variable validation        |
