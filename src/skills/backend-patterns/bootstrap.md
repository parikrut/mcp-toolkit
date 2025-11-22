# Module Bootstrap / main.ts Pattern

## 1. Component Pattern

**Type:** Application Entry Point  
**Layer:** Infrastructure / Bootstrap  
**Reference Implementations:**

- `modules/domain/revenue/assessment-roll/src/main.ts`
- `packages/common/src/bootstrap.ts`

## 2. Overview

Every microservice has a `main.ts` entry point that is intentionally minimal — a single call to `bootstrapModule()` from `@civic/common`. This shared bootstrap function handles all NestJS application setup: HTTP adapter, security middleware, global guards, interceptors, exception filters, Swagger documentation, and RabbitMQ microservice transport.

The `main.ts` file provides only the module-specific configuration: the root module class, the port number, the RMQ queue name, and Swagger metadata. Everything else is standardised across all services.

**Port allocation:** Each service is assigned a unique port in the 4100–4199 range. Port numbers come from the service registry and must not collide.

**Queue naming:** The RMQ queue name matches the service name in kebab-case (e.g., `assessment-roll`, `tax-billing`).

## 3. Rules

1. **`main.ts` is a single function call.** It must contain only `bootstrapModule({ ... })` and nothing else.
2. **Port must be unique.** Each service occupies a distinct port (4100–4199). Check the service registry before assigning.
3. **Queue name matches service name.** Kebab-case, same string used in `RmqModule.register()` in the module file.
4. **Swagger metadata is required.** Title, description, and version are mandatory for API documentation generation.
5. **Never customise bootstrap locally.** All middleware, guards, interceptors, and filters are applied by `bootstrapModule()`. Module-specific customisation goes into the module's own providers.
6. **`bootstrapModule()` order of operations matters.** Guards: `AuthGuard` → `RolesGuard`. Interceptors: `CorrelationId` → `ResponseEnvelope` → `ResponseValidation` → `Audit`. These are applied in this exact order — do not rearrange.
7. **No Swagger in production.** The bootstrap function conditionally skips Swagger setup when `NODE_ENV=production`.
8. **FastifyAdapter is the default.** The project uses Fastify, not Express. All middleware registration uses the Fastify plugin API.
9. **Global prefix `api/v1`.** All routes are automatically prefixed. Controllers define paths relative to this prefix.
10. **Rate limiting is global.** Redis-backed, 100 requests per minute per IP. Applied at the Fastify plugin level.

## 4. Structure

```
modules/domain/<domain>/<module>/src/
├── main.ts                     # Entry point — single bootstrapModule() call
└── <module-name>.module.ts     # Root module passed to bootstrapModule()

packages/common/src/
├── bootstrap.ts                # Shared bootstrapModule() function
├── guards/
│   ├── auth.guard.ts           # JWT verification
│   └── roles.guard.ts          # RBAC check against @Roles() metadata
├── interceptors/
│   ├── correlation-id.interceptor.ts   # Propagates X-Correlation-ID
│   ├── response-envelope.interceptor.ts # Wraps responses in { data, meta? }
│   ├── response-validation.interceptor.ts # Validates against @ResponseSchema()
│   └── audit.interceptor.ts    # Records @AuditAction() to audit log
├── filters/
│   └── exception.filter.ts     # Global error → HTTP status mapping
└── middleware/
    └── rate-limiter.ts         # Redis-backed rate limiting plugin
```

## 5. Example Implementation

### main.ts (per-service entry point)

```typescript
import { bootstrapModule } from "@civic/common";
import { AppModule } from "./app.module";

bootstrapModule({
    module: AppModule,
    port: 4104,
    microservice: {
        queue: "module-name",
    },
    swagger: {
        title: "Module Name API",
        description: "Manages resources for the module domain.",
        version: "1.0.0",
    },
});
```

That's it. The entire `main.ts` file is 12 lines.

---

### bootstrapModule() (shared in @civic/common)

```typescript
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";

import { AuthGuard } from "./guards/auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { CorrelationIdInterceptor } from "./interceptors/correlation-id.interceptor";
import { ResponseEnvelopeInterceptor } from "./interceptors/response-envelope.interceptor";
import { ResponseValidationInterceptor } from "./interceptors/response-validation.interceptor";
import { AuditInterceptor } from "./interceptors/audit.interceptor";
import { GlobalExceptionFilter } from "./filters/exception.filter";

interface BootstrapOptions {
    module: any;
    port: number;
    microservice: {
        queue: string;
    };
    swagger: {
        title: string;
        description: string;
        version: string;
    };
}

export async function bootstrapModule(options: BootstrapOptions) {
    const { module, port, microservice, swagger } = options;

    // -------------------------------------------------------------------------
    // 1. Create NestJS app with FastifyAdapter
    // -------------------------------------------------------------------------
    const app = await NestFactory.create<NestFastifyApplication>(
        module,
        new FastifyAdapter({ logger: true }),
    );

    // -------------------------------------------------------------------------
    // 2. Register Fastify plugins (security middleware)
    // -------------------------------------------------------------------------
    await app.register(helmet);
    await app.register(cookie);
    await app.register(rateLimit, {
        max: 100,
        timeWindow: "1 minute",
        redis: new Redis(process.env.REDIS_URL),
    });

    // -------------------------------------------------------------------------
    // 3. CORS — configured from environment
    // -------------------------------------------------------------------------
    app.enableCors({
        origin: process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:3000"],
        credentials: true,
    });

    // -------------------------------------------------------------------------
    // 4. Global prefix — all routes start with /api/v1
    // -------------------------------------------------------------------------
    app.setGlobalPrefix("api/v1");

    // -------------------------------------------------------------------------
    // 5. Global guards (order matters: AuthGuard first, then RolesGuard)
    // -------------------------------------------------------------------------
    const reflector = app.get("Reflector");
    app.useGlobalGuards(new AuthGuard(reflector), new RolesGuard(reflector));

    // -------------------------------------------------------------------------
    // 6. Global interceptors (order matters: first registered = outermost)
    //    Request flow: CorrelationId → ResponseEnvelope → ResponseValidation → Audit
    // -------------------------------------------------------------------------
    app.useGlobalInterceptors(
        new CorrelationIdInterceptor(),
        new ResponseEnvelopeInterceptor(),
        new ResponseValidationInterceptor(),
        new AuditInterceptor(),
    );

    // -------------------------------------------------------------------------
    // 7. Global exception filter
    // -------------------------------------------------------------------------
    app.useGlobalFilters(new GlobalExceptionFilter());

    // -------------------------------------------------------------------------
    // 8. Swagger (non-production only)
    // -------------------------------------------------------------------------
    if (process.env.NODE_ENV !== "production") {
        const config = new DocumentBuilder()
            .setTitle(swagger.title)
            .setDescription(swagger.description)
            .setVersion(swagger.version)
            .addBearerAuth()
            .build();
        const document = SwaggerModule.createDocument(app, config);
        SwaggerModule.setup("docs", app, document);
    }

    // -------------------------------------------------------------------------
    // 9. Connect RabbitMQ microservice transport
    // -------------------------------------------------------------------------
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [process.env.RMQ_URL ?? "amqp://localhost:5672"],
            queue: microservice.queue,
            queueOptions: { durable: true },
        },
    });

    await app.startAllMicroservices();

    // -------------------------------------------------------------------------
    // 10. Start HTTP server
    // -------------------------------------------------------------------------
    await app.listen(port, "0.0.0.0");
    console.log(`🚀 Service running on http://0.0.0.0:${port}`);
    console.log(`📖 Swagger docs at http://0.0.0.0:${port}/docs`);
}
```

**Key observations:**

- **Guard order:** `AuthGuard` runs first to verify the JWT and populate `request.user`. `RolesGuard` runs second to check `@Roles()` metadata against the authenticated user's roles.
- **Interceptor order:** `CorrelationIdInterceptor` is outermost — it sets/propagates the correlation ID before anything else. `ResponseEnvelopeInterceptor` wraps the response in `{ data }`. `ResponseValidationInterceptor` validates the wrapped response against `@ResponseSchema()`. `AuditInterceptor` is innermost — it records the action after the response is finalized.
- **Rate limiting:** 100 requests per minute per IP, backed by Redis for distributed counting across instances.
- **Swagger** is only available in non-production environments; the `/docs` endpoint is not exposed in production.
- **`0.0.0.0`** binding is required for Docker/Kubernetes — binding to `localhost` would make the service unreachable from outside the container.
