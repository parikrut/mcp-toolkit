# PrismaService (Database Connection)

## 1. Component Pattern

**Type:** Injectable Database Client  
**Layer:** Data / Persistence  
**Reference Implementation:** `modules/domain/revenue/order-management/src/prisma.service.ts`

## 2. Overview

The `PrismaService` is a thin NestJS wrapper around the module's generated Prisma Client. It extends `PrismaClient` (imported from the module-local `generated/prisma` directory) and implements the NestJS lifecycle hooks `OnModuleInit` and `OnModuleDestroy` to manage the database connection lifecycle.

The constructor configures a native PostgreSQL connection using the `@prisma/adapter-pg` adapter (`PrismaPg`). This bypasses Prisma's default Rust-based query engine in favour of a direct `pg` driver connection, which provides better performance, smaller Docker images (no binary engine), and direct control over connection pooling. The connection string is read from the `DATABASE_URL` environment variable at runtime — the Prisma schema intentionally omits the URL so it can be injected per environment.

Each module has its own `PrismaService` that is scoped to that module's database. The service is registered as a **provider** in the NestJS module but is **not exported** — only repositories within the same module may inject it. Cross-module data access is handled via HTTP service clients, never by sharing a database connection.

The `PrismaService` contains zero business logic. It exists solely to ensure the database connection is established when the module starts (`onModuleInit`) and cleanly closed when the module shuts down (`onModuleDestroy`).

## 3. Rules

1. **One PrismaService per module.** Every module that has a database defines its own `PrismaService`. Modules never import another module's `PrismaService`.
2. **Extends the module-local PrismaClient.** Import from the module's own generated client (`../../generated/prisma` or `../generated/prisma/client`), never from `@prisma/client` or a shared package.
3. **Uses `@prisma/adapter-pg`.** The constructor creates a `PrismaPg` adapter with the `connectionString` from `process.env.DATABASE_URL` and passes it to `super({ adapter })`. This uses the native PostgreSQL driver instead of Prisma's binary query engine.
4. **Implements `OnModuleInit`.** The `onModuleInit()` method calls `await this.$connect()` to establish the connection when NestJS bootstraps the module.
5. **Implements `OnModuleDestroy`.** The `onModuleDestroy()` method calls `await this.$disconnect()` to cleanly close all connections on shutdown.
6. **Registered as provider, NOT exported.** In the module's `@Module()` decorator, `PrismaService` appears in `providers` but **not** in `exports`. Only repositories within the same module inject it.
7. **No business logic.** The service does not add any methods beyond the lifecycle hooks. All query logic lives in repository classes.
8. **No constructor parameters from DI.** The `PrismaService` reads `DATABASE_URL` directly from `process.env` in its constructor — it does not inject a config service. Environment validation happens earlier in the bootstrap sequence (see `env-validation` pattern).
9. **`@Injectable()` decorator.** The class is decorated with `@Injectable()` so NestJS can register it in the dependency injection container.
10. **Connection pooling handled by adapter.** The `PrismaPg` adapter manages the underlying `pg` connection pool. Do not create a separate `Pool` instance or manage pool settings unless explicitly required for performance tuning.

## 4. Structure

```
modules/domain/<domain>/<module>/
├── generated/
│   └── prisma/                 # Auto-generated Prisma Client (git-ignored)
│       ├── index.ts
│       └── client.ts
├── prisma/
│   └── schema.prisma           # Schema that generates the client above
└── src/
    ├── prisma.service.ts       # ← This pattern (one per module)
    ├── repositories/
    │   └── resource.repository.ts  # Injects PrismaService
    └── <module>.module.ts      # Registers PrismaService as provider
```

**Import sources:**

| Import                                          | Package                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `Injectable`, `OnModuleInit`, `OnModuleDestroy` | `@nestjs/common`                                                        |
| `PrismaClient`                                  | `../../generated/prisma` or `../generated/prisma/client` (module-local) |
| `PrismaPg`                                      | `@prisma/adapter-pg`                                                    |

**Module registration pattern:**

```typescript
@Module({
    providers: [
        PrismaService, // ← registered as provider
        ResourceRepository, // ← injects PrismaService
        ResourceService, // ← injects ResourceRepository
    ],
    controllers: [ResourceController],
    exports: [ResourceService], // ← PrismaService is NOT exported
})
export class ResourceModule {}
```

## 5. Example Implementation

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Resource Management — Prisma Service
 *
 * Database topology: 1 database per module (DB-per-service)
 *   DB:  resource_service
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL,
        });
        super({ adapter });
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
```

**With optional logging (for development / debugging):**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "../../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        const adapter = new PrismaPg({
            connectionString: process.env.DATABASE_URL,
        });

        super({
            adapter,
            log:
                process.env.NODE_ENV === "development"
                    ? [
                          { emit: "event", level: "query" },
                          { emit: "stdout", level: "info" },
                          { emit: "stdout", level: "warn" },
                          { emit: "stdout", level: "error" },
                      ]
                    : [
                          { emit: "stdout", level: "warn" },
                          { emit: "stdout", level: "error" },
                      ],
        });
    }

    async onModuleInit(): Promise<void> {
        await this.$connect();
        this.logger.log("Database connection established");
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
        this.logger.log("Database connection closed");
    }
}
```

**Key observations from the example:**

- The import path `../../generated/prisma` is relative to the `src/` directory — it points to the module's own generated client, not a shared one.
- `PrismaPg` receives a single object with `connectionString` — the adapter handles pool creation internally. There is no need to manually instantiate a `pg.Pool`.
- The `super({ adapter })` call passes the adapter to `PrismaClient`, which uses it for all queries instead of the default binary query engine.
- `onModuleInit()` and `onModuleDestroy()` are NestJS lifecycle hooks that are called automatically — they do not need to be invoked manually.
- The service has no custom methods — all database operations are inherited from `PrismaClient` and accessed by repositories (e.g., `this.prisma.resource.findMany()`).
- In the module registration, `PrismaService` is in `providers` only, never in `exports`. Repositories are the only consumers.
