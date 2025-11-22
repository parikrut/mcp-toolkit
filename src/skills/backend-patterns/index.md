# Backend Patterns

> Canonical reference for building NestJS microservice modules in the Civic Modules platform.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

Every backend module follows a strict three-layer architecture:
**Controller → Service → Repository**. The controller validates input with
Zod, delegates to a service for business logic, and the service calls a
repository for data access. Cross-cutting concerns (auth, audit, RBAC,
response enveloping) are handled globally via `bootstrapModule()` — no
per-module setup required.

```
┌──────────────────────────────────────────────────────────────┐
│  NestJS Module                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Controller (Zod parse → delegate to service)          │  │
│  │  @ResponseSchema │ @Roles │ @AuditAction │ @CurrentUser│  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Service (business logic, toResponse mapping)          │  │
│  │  NotFoundError │ calculateOffset │ publisher calls     │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  Repository (Prisma data access)                       │  │
│  │  findMany [items, count] │ dynamic where │ soft delete │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐               │
│  │ PrismaDB │  │ Publisher │  │ HealthCheck  │               │
│  └──────────┘  └──────────┘  └──────────────┘               │
└──────────────────────────────────────────────────────────────┘
       │                │                │
   Guards          Interceptors      Middleware
 (Auth→Roles)  (Correlation→Envelope  (Version,
                 →Validation→Audit)    Logging)
       │                │                │
       └────────────────┴────────────────┘
              Applied by bootstrapModule()
```

## Core Layer Patterns

| #   | Pattern                                    | Description                                         |
| --- | ------------------------------------------ | --------------------------------------------------- |
| 1   | [controller.md](controller.md)             | NestJS Controller — CRUD routes, Zod parsing        |
| 2   | [service.md](service.md)                   | Service — business logic, toResponse, pagination    |
| 3   | [repository.md](repository.md)             | Repository — Prisma data access, soft delete        |
| 4   | [nestjs-module.md](nestjs-module.md)       | Module definition — imports, providers, exports     |
| 5   | [bootstrap.md](bootstrap.md)               | Bootstrap / main.ts — bootstrapModule() single call |
| 6   | [exception-filter.md](exception-filter.md) | Global exception filter — error type → HTTP status  |

## Security & Access Control

| #   | Pattern                          | Description                                                                     |
| --- | -------------------------------- | ------------------------------------------------------------------------------- |
| 7   | [auth-guard.md](auth-guard.md)   | JWT authentication guard with cookie fallback                                   |
| 8   | [roles-guard.md](roles-guard.md) | Hierarchy-based RBAC (8 role levels)                                            |
| 9   | [decorators.md](decorators.md)   | Custom decorators: @Public, @Roles, @CurrentUser, @AuditAction, @ResponseSchema |

## Cross-Cutting Concerns

| #   | Pattern                            | Description                                                   |
| --- | ---------------------------------- | ------------------------------------------------------------- |
| 10  | [interceptors.md](interceptors.md) | 4 interceptors: CorrelationId → Envelope → Validation → Audit |
| 11  | [middleware.md](middleware.md)     | 3 middleware: API version, correlation ID, request logging    |
| 12  | [health-check.md](health-check.md) | Terminus liveness / readiness probes                          |
