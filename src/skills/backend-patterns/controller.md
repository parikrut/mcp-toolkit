# NestJS Controller Pattern

## 1. Component Pattern

**Type:** REST API Controller  
**Layer:** Presentation / HTTP boundary  
**Reference Implementation:** `modules/domain/revenue/order-management/src/controllers/property.controller.ts`

## 2. Overview

Controllers are the HTTP entry point for every NestJS module. They receive incoming requests, validate inputs with Zod schemas from `@myorg/contracts`, and delegate all business logic to an injected service. Controllers contain **zero** business logic — they are thin adapters that translate HTTP semantics (status codes, parameter extraction, auth decorators) into service calls.

Every route is decorated with `@ResponseSchema()` so the `ResponseValidationInterceptor` can validate outgoing payloads against the contract before they leave the process. All parameters and bodies are typed as `unknown` at the decorator level and immediately parsed with the corresponding Zod schema inline. This guarantees that any malformed input is rejected with a 422 before it reaches the service layer.

Write operations (POST, PATCH, DELETE) are protected by `@Roles()` and annotated with `@AuditAction()` for the audit trail interceptor. The `@CurrentUser()` decorator extracts the authenticated user from the request context so the service can record `createdBy` / `updatedBy` fields.

The response envelope (`{ data, meta?, pagination? }`) is handled automatically by the `ResponseEnvelopeInterceptor` — the controller simply returns the service's raw result.

## 3. Rules

1. **No business logic.** The controller must not contain conditionals, calculations, or data transformations beyond Zod `.parse()`.
2. **Single service injection.** A controller injects exactly one service via the constructor. If you need multiple services, the primary service should orchestrate internally.
3. **All params typed as `unknown`.** NestJS decorator params (`@Param()`, `@Query()`, `@Body()`) must be typed `unknown` and immediately parsed with the relevant Zod schema.
4. **`@ResponseSchema()` on every route.** This enables outgoing payload validation by the `ResponseValidationInterceptor`.
5. **`@Roles()` only on mutations.** GET routes rely on the `AuthGuard` (JWT) alone. POST, PATCH, DELETE require explicit role checks.
6. **`@AuditAction(action, resource)` on every mutation.** The first argument is the verb (`CREATE`, `UPDATE`, `DELETE`), the second is the singular resource name.
7. **HTTP status codes via decorators.** `@HttpCode(201)` for POST (created), `@HttpCode(204)` for DELETE (no content). GET and PATCH use the default 200.
8. **Full CRUD surface.** Every resource controller exposes five routes: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`.
9. **Class-level Swagger decorators.** `@ApiTags("PluralResourceName")` and `@ApiBearerAuth()` are always present at the class level.
10. **Route path is kebab-case plural.** `@Controller("resources")` — matches the REST resource naming convention.

## 4. Structure

```
modules/domain/<domain>/<module>/src/controllers/
├── resource.controller.ts      # One controller per aggregate root
├── sub-resource.controller.ts  # Child resources if needed
└── health.controller.ts        # Always present (Terminus)
```

**Import sources:**

| Import                                                                               | Package                             |
| ------------------------------------------------------------------------------------ | ----------------------------------- |
| `Controller`, `Get`, `Post`, `Patch`, `Delete`, `Query`, `Param`, `Body`, `HttpCode` | `@nestjs/common`                    |
| `ApiTags`, `ApiBearerAuth`                                                           | `@nestjs/swagger`                   |
| `Roles`, `AuditAction`, `CurrentUser`, `ResponseSchema`, `RequestUser`               | `@myorg/common`                     |
| All Zod schemas and inferred types                                                   | `@myorg/contracts`                  |
| Service class                                                                        | Relative import from `../services/` |

**Decorator stacking order (top → bottom on each route):**

```
@HttpCode(...)          // only if non-200
@Roles(...)             // only on mutations
@AuditAction(...)       // only on mutations
@ResponseSchema(...)    // always
```

## 5. Example Implementation

```typescript
import { Controller, Get, Post, Patch, Delete, Query, Param, Body, HttpCode } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Roles, AuditAction, CurrentUser, ResponseSchema, type RequestUser } from "@myorg/common";
import {
    ResourcePathParamsSchema,
    ResourceQuerySchema,
    CreateResourceBodySchema,
    UpdateResourceBodySchema,
    ResourceResponseSchema,
    PaginatedResourceResponseSchema,
} from "@myorg/contracts";
import { ResourceService } from "../services/resource.service";

@ApiTags("Resources")
@ApiBearerAuth()
@Controller("resources")
export class ResourceController {
    constructor(private readonly resourceService: ResourceService) {}

    /**
     * List resources with pagination and optional filters.
     * GET /api/v1/resources?page=1&limit=20&status=ACTIVE
     */
    @Get()
    @ResponseSchema(PaginatedResourceResponseSchema)
    async list(@Query() query: unknown) {
        const filters = ResourceQuerySchema.parse(query);
        return this.resourceService.list(filters);
    }

    /**
     * Get a single resource by ID.
     * GET /api/v1/resources/:id
     */
    @Get(":id")
    @ResponseSchema(ResourceResponseSchema)
    async getById(@Param() params: unknown) {
        const { id } = ResourcePathParamsSchema.parse(params);
        return this.resourceService.getById(id);
    }

    /**
     * Create a new resource.
     * POST /api/v1/resources
     */
    @Post()
    @HttpCode(201)
    @Roles("TAX_CLERK", "FINANCE_OFFICER")
    @AuditAction("CREATE", "resource")
    @ResponseSchema(ResourceResponseSchema)
    async create(@Body() body: unknown, @CurrentUser() user: RequestUser) {
        const data = CreateResourceBodySchema.parse(body);
        return this.resourceService.create(data, user.userId);
    }

    /**
     * Partially update an existing resource.
     * PATCH /api/v1/resources/:id
     */
    @Patch(":id")
    @Roles("TAX_CLERK", "FINANCE_OFFICER")
    @AuditAction("UPDATE", "resource")
    @ResponseSchema(ResourceResponseSchema)
    async update(
        @Param() params: unknown,
        @Body() body: unknown,
        @CurrentUser() user: RequestUser,
    ) {
        const { id } = ResourcePathParamsSchema.parse(params);
        const data = UpdateResourceBodySchema.parse(body);
        return this.resourceService.update(id, data, user.userId);
    }

    /**
     * Soft-delete a resource.
     * DELETE /api/v1/resources/:id
     */
    @Delete(":id")
    @HttpCode(204)
    @Roles("TAX_MANAGER", "SYSTEM_ADMIN")
    @AuditAction("DELETE", "resource")
    async delete(@Param() params: unknown, @CurrentUser() user: RequestUser) {
        const { id } = ResourcePathParamsSchema.parse(params);
        await this.resourceService.delete(id, user.userId);
    }
}
```

**Key observations from the example:**

- `@Query()`, `@Param()`, and `@Body()` are all typed `unknown` — Zod is the single source of truth for validation.
- The controller never touches database entities; it only sees contract-shaped objects returned by the service.
- `@HttpCode(204)` on DELETE means the framework sends no response body; the method returns `void`.
- `@CurrentUser()` is a custom param decorator that reads `request.user` populated by the `AuthGuard`.
- The `ResponseEnvelopeInterceptor` wraps the return value in `{ data: ... }` automatically — the controller does **not** construct the envelope.
