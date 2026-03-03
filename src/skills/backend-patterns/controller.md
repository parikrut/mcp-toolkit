# NestJS Controller Pattern

## 1. Component Pattern

**Type:** REST API Controller  
**Layer:** Presentation / HTTP boundary  
**Reference Implementation:** `modules/domain/<domain>/<module>/src/controllers/<module>.controller.ts`

## 2. Overview

Controllers are the HTTP entry point for every NestJS module. They receive incoming requests, validate inputs with Zod schemas from `@myorg/contracts`, and delegate all business logic to an injected service. Controllers contain **zero** business logic — they are thin adapters that translate HTTP semantics (status codes, parameter extraction, auth decorators) into service calls.

Every route is decorated with `@ResponseSchema()` so the `ResponseValidationInterceptor` can validate outgoing payloads against the contract before they leave the process. All parameters and bodies are typed as `unknown` at the decorator level and immediately parsed with the corresponding Zod schema inline. This guarantees that any malformed input is rejected with a 422 before it reaches the service layer.

Write operations (POST, PATCH, DELETE) are protected by `@Roles()` and annotated with `@AuditAction()` for the audit trail interceptor. The `@CurrentUser("userId")` decorator extracts the authenticated user's ID as a string so the service can record `createdBy` / `updatedBy` fields.

The response envelope (`{ data, meta?, pagination? }`) is handled automatically by the `ResponseEnvelopeInterceptor` — the controller simply returns the service's raw result.

> **DX Enhancement:** When no contract body schema exists for an endpoint (e.g., analytics or reporting POST endpoints), define minimal inline Zod schemas at the top of the controller file and use `rawBody as any` for the service call. For date query parameters, always use `z.string()` — never `z.coerce.date()` — since services handle `new Date()` conversion internally.

## 3. Rules

1. **No business logic.** The controller must not contain conditionals, calculations, or data transformations beyond Zod `.parse()`.
2. **Single service injection.** A controller injects exactly one service via the constructor. If you need multiple services, the primary service should orchestrate internally.
3. **All params typed as `unknown`.** NestJS decorator params (`@Param()`, `@Query()`, `@Body()`) must be typed `unknown` and immediately parsed with the relevant Zod schema.
4. **`@ResponseSchema()` on every route.** This enables outgoing payload validation by the `ResponseValidationInterceptor`.
5. **`@Roles()` only on mutations.** GET routes rely on the `AuthGuard` (JWT) alone. POST, PATCH, DELETE require explicit role checks.
6. **`@AuditAction(action, resource)` on every mutation.** The first argument is the lowercase verb (`create`, `update`, `delete`), the second is the kebab-case singular resource name (e.g., `"benefit-plan"`).
7. **HTTP status codes via decorators.** `@HttpCode(HttpStatus.CREATED)` for POST (created). GET and PATCH use the default 200.
8. **Full CRUD surface.** Every resource controller exposes routes: `GET /`, `GET /:id`, `POST /`, `PATCH /:id` (and optionally `DELETE /:id`).
9. **Class-level Swagger decorators.** `@ApiTags("PluralResourceName")` and `@ApiBearerAuth()` are always present at the class level. Every handler has `@ApiOperation({ summary: "..." })`.
10. **Route path is kebab-case plural.** `@Controller("resources")` — matches the REST resource naming convention.
11. **Always `@Patch`, never `@Put`** for update operations — partial updates are the standard.
12. **Inline schemas for analytics endpoints.** When contract schemas don't exist (e.g., reporting or analytics modules), define `z.object()` schemas at controller file scope and pass `rawBody as any` to services.
13. **Date query params use `z.string()`.** Never `z.coerce.date()` — services handle `new Date()` conversion.

## 4. Structure

```
modules/domain/<domain>/<module>/src/controllers/
├── resource.controller.ts      # One controller per aggregate root
├── sub-resource.controller.ts  # Child resources if needed
└── health.controller.ts        # Always present (Terminus)
```

**Import sources:**

| Import                                                                                             | Package                             |
| -------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `Controller`, `Get`, `Post`, `Patch`, `Delete`, `Query`, `Param`, `Body`, `HttpCode`, `HttpStatus` | `@nestjs/common`                    |
| `ApiTags`, `ApiBearerAuth`, `ApiOperation`                                                         | `@nestjs/swagger`                   |
| `Roles`, `AuditAction`, `CurrentUser`, `ResponseSchema`                                            | `@myorg/common`                     |
| All Zod schemas and inferred types                                                                 | `@myorg/contracts`                  |
| `z` (for inline schemas when no contract exists)                                                   | `zod`                               |
| Service class                                                                                      | Relative import from `../services/` |

**Decorator stacking order (top → bottom on each route):**

```
@ResponseSchema(...)    // always — first decorator
@Get / @Post / @Patch   // HTTP method
@HttpCode(...)          // only if non-200 (POST = CREATED)
@Roles(...)             // only on mutations
@AuditAction(...)       // only on mutations
@ApiOperation(...)      // always — Swagger docs
```

## 5. Example Implementation

```typescript
import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Query,
    Param,
    Body,
    HttpCode,
    HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { Roles, AuditAction, CurrentUser, ResponseSchema } from "@myorg/common";
import {
    ResourcePathParamsSchema,
    ResourceQuerySchema,
    CreateResourceBodySchema,
    ResourceResponseSchema,
    PaginatedResourceResponseSchema,
} from "@myorg/contracts";
import { ResourceService } from "../services/resource.service";

@ApiTags("Resources")
@ApiBearerAuth()
@Controller("resources")
export class ResourceController {
    constructor(private readonly service: ResourceService) {}

    /**
     * List resources with pagination and optional filters.
     * GET /api/v1/resources?page=1&limit=20&status=ACTIVE
     */
    @ResponseSchema(PaginatedResourceResponseSchema)
    @Get()
    @ApiOperation({ summary: "List resources" })
    async list(@Query() rawQuery: unknown) {
        const query = ResourceQuerySchema.parse(rawQuery);
        return this.service.list(query);
    }

    /**
     * Get a single resource by ID.
     * GET /api/v1/resources/:id
     */
    @ResponseSchema(ResourceResponseSchema)
    @Get(":id")
    @ApiOperation({ summary: "Get resource by ID" })
    async getById(@Param() rawParams: unknown) {
        const { id } = ResourcePathParamsSchema.parse(rawParams);
        return this.service.getById(id);
    }

    /**
     * Create a new resource.
     * POST /api/v1/resources
     */
    @ResponseSchema(ResourceResponseSchema)
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @Roles("ADMIN", "MANAGER", "SYSTEM_ADMIN")
    @AuditAction("create", "resource")
    @ApiOperation({ summary: "Create resource" })
    async create(@Body() rawBody: unknown, @CurrentUser("userId") userId: string) {
        const body = CreateResourceBodySchema.parse(rawBody);
        return this.service.create(body, userId);
    }

    /**
     * Partially update an existing resource.
     * PATCH /api/v1/resources/:id
     */
    @ResponseSchema(ResourceResponseSchema)
    @Patch(":id")
    @Roles("ADMIN", "MANAGER", "SYSTEM_ADMIN")
    @AuditAction("update", "resource")
    @ApiOperation({ summary: "Update resource" })
    async update(
        @Param() rawParams: unknown,
        @Body() rawBody: unknown,
        @CurrentUser("userId") userId: string,
    ) {
        const { id } = ResourcePathParamsSchema.parse(rawParams);
        const body = CreateResourceBodySchema.partial().parse(rawBody);
        return this.service.update(id, body, userId);
    }

    /**
     * Soft-delete a resource.
     * DELETE /api/v1/resources/:id
     */
    @Delete(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    @Roles("SYSTEM_ADMIN")
    @AuditAction("delete", "resource")
    @ApiOperation({ summary: "Delete resource" })
    async delete(@Param() rawParams: unknown, @CurrentUser("userId") userId: string) {
        const { id } = ResourcePathParamsSchema.parse(rawParams);
        await this.service.delete(id, userId);
    }
}
```

### Inline Schema Pattern (Analytics / Intelligence Endpoints)

When no contract body schema exists, define inline Zod schemas at controller file scope:

```typescript
import { Controller, Get, Post, Param, Body, Query, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { z } from "zod";
import { AnalyticsResponseSchema } from "@myorg/contracts";
import { ResponseSchema, CurrentUser, Roles, AuditAction } from "@myorg/common";
import { AnalyticsService } from "../services/analytics.service";

// Inline schemas — no contract body schema exists for this domain yet
const EmployeeIdParamsSchema = z.object({ employeeId: z.string().uuid() });
const PeriodQuerySchema = z.object({
    periodStart: z.string(), // ← z.string(), NOT z.coerce.date()
    periodEnd: z.string(),
});

@ApiTags("Analytics")
@ApiBearerAuth()
@Controller("hr-analytics/metrics")
export class AnalyticsController {
    constructor(private readonly service: AnalyticsService) {}

    @ResponseSchema(AnalyticsResponseSchema)
    @Get("employee/:employeeId")
    @ApiOperation({ summary: "Get metrics for employee" })
    async getByEmployee(@Param() rawParams: unknown, @Query() rawQuery: unknown) {
        const { employeeId } = EmployeeIdParamsSchema.parse(rawParams);
        const query = PeriodQuerySchema.parse(rawQuery);
        return this.service.getByEmployee(employeeId, query.periodStart, query.periodEnd);
    }

    @ResponseSchema(AnalyticsResponseSchema)
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @Roles("HR_MANAGER", "HR_ANALYST", "SYSTEM_ADMIN")
    @AuditAction("create", "analytics-record")
    @ApiOperation({ summary: "Create analytics record" })
    async create(@Body() rawBody: unknown, @CurrentUser("userId") userId: string) {
        return this.service.create(rawBody as any, userId); // cast when no body schema
    }
}
```

**Key observations from the example:**

- `@Query()`, `@Param()`, and `@Body()` are all typed `unknown` — Zod is the single source of truth for validation.
- The controller never touches database entities; it only sees contract-shaped objects returned by the service.
- `@HttpCode(204)` on DELETE means the framework sends no response body; the method returns `void`.
- `@CurrentUser()` is a custom param decorator that reads `request.user` populated by the `AuthGuard`.
- The `ResponseEnvelopeInterceptor` wraps the return value in `{ data: ... }` automatically — the controller does **not** construct the envelope.
