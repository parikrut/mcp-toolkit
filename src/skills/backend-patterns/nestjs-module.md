# NestJS Module Definition Pattern

## 1. Component Pattern

**Type:** NestJS Module  
**Layer:** Composition Root / Dependency Wiring  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/src/assessment-roll.module.ts`

## 2. Overview

The module file is the composition root for each microservice. It wires together all controllers, services, repositories, publishers, and external clients using the NestJS `@Module()` decorator. Every module follows the same structure and inclusion rules.

Key conventions:

- **`TerminusModule`** is always imported for health checks.
- **`RmqModule.register()`** is imported when the service publishes domain events — it provides the RabbitMQ client injection token.
- **`HealthController`** is always present in the controllers array to expose liveness and readiness probes at `/health`.
- The `providers` array contains every injectable class: `PrismaService`, domain services, repositories, publishers, and external service clients.
- The `exports` array **only** contains services — never repositories, `PrismaService`, or publishers. This ensures that other modules depending on this one can only access the business logic layer, not the data access internals.

## 3. Rules

1. **One `@Module()` per microservice.** Each deployable module has exactly one root module file.
2. **Always import `TerminusModule`.** Health checks are mandatory for Kubernetes liveness/readiness probes.
3. **Import `RmqModule.register()` for event publishing.** Use the queue constant from `@civic/common` and provide the queue name string.
4. **`HealthController` always first in controllers.** Convention: health controller precedes domain controllers.
5. **`PrismaService` in providers.** Every module that queries the database must provide its own `PrismaService` instance.
6. **Export only services.** Never export repositories, `PrismaService`, publishers, or clients. External consumers interact through the service API.
7. **One provider per class.** Do not use factory providers or `useValue` unless integrating with a third-party library. Prefer class-based providers.
8. **RMQ queue name is kebab-case.** Matches the service name: e.g., `assessment-roll`, `tax-billing`, `citizen-account`.
9. **Queue token constant.** Define `QUEUE_TOKEN` as a string constant (e.g., `"ASSESSMENT_ROLL_SERVICE"`) and use it as the `name` in `RmqModule.register()`.
10. **Import ordering.** Imports: infrastructure modules first (`TerminusModule`, `RmqModule`), then shared modules.

## 4. Structure

```
modules/domain/<domain>/<module>/src/
├── <module-name>.module.ts     # Root module file
├── main.ts                     # Bootstrap entry point
├── prisma.service.ts           # PrismaService (extends PrismaClient)
├── controllers/
│   ├── health.controller.ts
│   └── resource.controller.ts
├── services/
│   └── resource.service.ts
├── repositories/
│   └── resource.repository.ts
├── publishers/
│   └── resource.publisher.ts
└── clients/
    └── config.client.ts
```

## 5. Example Implementation

```typescript
import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { RmqModule } from "@civic/common";

// Controllers
import { HealthController } from "./controllers/health.controller";
import { ResourceController } from "./controllers/resource.controller";
import { SubResourceController } from "./controllers/sub-resource.controller";

// Services
import { ResourceService } from "./services/resource.service";
import { SubResourceService } from "./services/sub-resource.service";

// Repositories
import { ResourceRepository } from "./repositories/resource.repository";
import { SubResourceRepository } from "./repositories/sub-resource.repository";

// Infrastructure
import { PrismaService } from "./prisma.service";
import { ResourcePublisher } from "./publishers/resource.publisher";
import { ConfigClient } from "./clients/config.client";

// Queue token — used by RmqModule and Publisher for injection
export const QUEUE_TOKEN = "MODULE_NAME_SERVICE";

@Module({
    imports: [
        // Health check endpoints (liveness / readiness)
        TerminusModule,

        // RabbitMQ client for publishing domain events
        RmqModule.register({
            name: QUEUE_TOKEN,
            queue: "module-name",
        }),
    ],

    controllers: [
        // Health probe — always first
        HealthController,

        // Domain controllers
        ResourceController,
        SubResourceController,
    ],

    providers: [
        // Database
        PrismaService,

        // Services (business logic)
        ResourceService,
        SubResourceService,

        // Repositories (data access)
        ResourceRepository,
        SubResourceRepository,

        // Event publishing
        ResourcePublisher,

        // External service clients
        ConfigClient,
    ],

    exports: [
        // Only expose services — never repos, prisma, or publishers
        ResourceService,
        SubResourceService,
    ],
})
export class ModuleNameModule {}
```

**Health Controller (always included):**

```typescript
import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from "@nestjs/terminus";
import { PrismaService } from "../prisma.service";

@Controller("health")
export class HealthController {
    constructor(
        private readonly health: HealthCheckService,
        private readonly prismaHealth: PrismaHealthIndicator,
        private readonly prisma: PrismaService,
    ) {}

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([() => this.prismaHealth.pingCheck("database", this.prisma)]);
    }
}
```

**PrismaService (always included):**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }
}
```

**Key observations from the example:**

- `RmqModule.register()` accepts `{ name, queue }` — `name` is the DI injection token the publisher uses (`@Inject(QUEUE_TOKEN)`), and `queue` is the RabbitMQ queue name.
- The `exports` array contains **only** `ResourceService` and `SubResourceService`. No repository, no `PrismaService`, no publisher is ever exported.
- `HealthController` is always the first controller in the array — this is a team convention for readability.
- The module class name follows the pattern `<ModuleName>Module` in PascalCase (e.g., `AssessmentRollModule`, `TaxBillingModule`).
- Every provider is listed explicitly — no `useFactory`, `useValue`, or dynamic providers unless integrating with external libraries.
