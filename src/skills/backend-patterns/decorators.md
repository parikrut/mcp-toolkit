# Custom NestJS Decorators

> Pattern documentation for the reusable custom decorators in `@myorg/common` that control authentication bypass, role authorization, user extraction, audit logging, and response validation.

## 1. Component Pattern

The **Custom Decorators** are a set of five purpose-built NestJS decorators
stored in `packages/common/src/decorators/`. Each decorator lives in its own
file and is re-exported from `decorators/index.ts` so consumers import from
`@myorg/common`. The decorators integrate with guards, interceptors, and
parameter injection to provide declarative metadata-driven behavior:

1. **`@Public()`** — bypasses `AuthGuard`
2. **`@Roles(...roles)`** — sets minimum role requirements for `RolesGuard`
3. **`@CurrentUser(field?)`** — extracts `request.user` or a specific field
4. **`@AuditAction(action, resource?)`** — tags a handler for `AuditInterceptor`
5. **`@ResponseSchema(zodSchema)`** — tags a handler for `ResponseValidationInterceptor`

## 2. Overview

| Decorator                         | Type         | Metadata Key          | Consumer                        | Import                                           |
| --------------------------------- | ------------ | --------------------- | ------------------------------- | ------------------------------------------------ |
| `@Public()`                       | Method/Class | `IS_PUBLIC_KEY`       | `AuthGuard`                     | `import { Public } from "@myorg/common"`         |
| `@Roles(...roles)`                | Method/Class | `ROLES_KEY`           | `RolesGuard`                    | `import { Roles } from "@myorg/common"`          |
| `@CurrentUser(field?)`            | Parameter    | —                     | NestJS param injection          | `import { CurrentUser } from "@myorg/common"`    |
| `@AuditAction(action, resource?)` | Method       | `AUDIT_ACTION_KEY`    | `AuditInterceptor`              | `import { AuditAction } from "@myorg/common"`    |
| `@ResponseSchema(zodSchema)`      | Method       | `RESPONSE_SCHEMA_KEY` | `ResponseValidationInterceptor` | `import { ResponseSchema } from "@myorg/common"` |

All decorators are thin wrappers around NestJS's `SetMetadata` or
`createParamDecorator`. They carry zero runtime logic — the logic lives in
the corresponding guard or interceptor that reads the metadata.

## 3. Rules

1. **One file per decorator.** Each decorator is in its own file inside
   `packages/common/src/decorators/`. The file exports the decorator function
   and the metadata key constant.
2. **Re-exported from `decorators/index.ts`.** The barrel file re-exports
   all decorators and keys so consumers only import from `@myorg/common`.
3. **`@Public()` returns `true` metadata.** `SetMetadata(IS_PUBLIC_KEY, true)`.
   Can be applied at handler or class level. Class-level makes all handlers
   in that controller public.
4. **`@Roles()` accepts one or more role strings.** The `RolesGuard` takes
   the minimum level across the provided roles — `@Roles("ASSESSOR")` means
   ASSESSOR or higher.
5. **`@CurrentUser()` with no argument returns the full `RequestUser`.**
   With a string argument (e.g., `@CurrentUser("userId")`), it returns only
   that field from `request.user`. **The standard pattern in all controllers
   is `@CurrentUser("userId") userId: string`** — extracting just the userId
   string for passing to services.
6. **`@AuditAction()` requires at least the `action` string.** The action
   should be **lowercase** (e.g., `"create"`, `"update"`, `"delete"`,
   `"approve"`). The optional `resource` string is kebab-case singular
   (e.g., `"benefit-plan"`, `"pay-run"`). Used by `AuditInterceptor` to
   log structured audit entries.
7. **`@ResponseSchema()` takes a Zod schema object.** The
   `ResponseValidationInterceptor` uses it to validate outgoing data.
   In development, validation failure throws. In production, it logs a
   warning.
8. **Metadata keys are string constants.** Exported so guards/interceptors
   can reference them without magic strings.

## 4. Structure

```
packages/common/src/decorators/
├── index.ts                        ← Barrel re-export of all decorators + keys
├── public.decorator.ts             ← @Public() + IS_PUBLIC_KEY
├── roles.decorator.ts              ← @Roles() + ROLES_KEY
├── current-user.decorator.ts       ← @CurrentUser() param decorator
├── audit-action.decorator.ts       ← @AuditAction() + AUDIT_ACTION_KEY
└── response-schema.decorator.ts    ← @ResponseSchema() + RESPONSE_SCHEMA_KEY
```

## 5. Example Implementation

### `packages/common/src/decorators/public.decorator.ts`

```typescript
import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key read by AuthGuard to skip authentication.
 */
export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marks a route or controller as public — bypasses AuthGuard.
 *
 * @example
 * @Public()
 * @Get("health")
 * check() { return { status: "ok" }; }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### `packages/common/src/decorators/roles.decorator.ts`

```typescript
import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key read by RolesGuard to enforce minimum role level.
 */
export const ROLES_KEY = "roles";

/**
 * Specifies the minimum role(s) required to access a route.
 * The RolesGuard computes the minimum level across the provided
 * roles and requires the user's role level to be >= that minimum.
 *
 * @example @Roles("FINANCE_OFFICER")         // level 3+
 * @example @Roles("ASSESSOR", "TAX_CLERK")   // level 1+ (min of 2, 1)
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

### `packages/common/src/decorators/current-user.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestUser } from "../auth.guard";

/**
 * Extracts the authenticated user from the request.
 *
 * - No argument: returns the full RequestUser object.
 * - With a field name: returns only that field.
 *
 * @example
 * @Get("profile")
 * getProfile(@CurrentUser() user: RequestUser) { ... }
 *
 * @example
 * @Get("my-id")
 * getMyId(@CurrentUser("userId") userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
    (field: keyof RequestUser | undefined, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user: RequestUser = request.user;

        if (!user) return null;

        return field ? user[field] : user;
    },
);
```

### `packages/common/src/decorators/audit-action.decorator.ts`

```typescript
import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key read by AuditInterceptor.
 */
export const AUDIT_ACTION_KEY = "auditAction";

export interface AuditActionMetadata {
    action: string;
    resource?: string;
}

/**
 * Tags a route handler for audit logging. The AuditInterceptor reads
 * this metadata and creates a structured audit log entry on success/failure.
 *
 * @param action - The action being performed (e.g., "CREATE", "UPDATE", "DELETE", "APPROVE")
 * @param resource - Optional resource name; defaults to the controller's base path
 *
 * @example
 * @Post()
 * @AuditAction("create", "assessment")
 * create(@Body() dto: CreateAssessmentDto) { ... }
 *
 * @example
 * @Delete(":id")
 * @AuditAction("delete")
 * remove(@Param("id") id: string) { ... }
 */
export const AuditAction = (action: string, resource?: string) =>
    SetMetadata(AUDIT_ACTION_KEY, { action, resource } as AuditActionMetadata);
```

### `packages/common/src/decorators/response-schema.decorator.ts`

```typescript
import { SetMetadata } from "@nestjs/common";
import { ZodSchema } from "zod";

/**
 * Metadata key read by ResponseValidationInterceptor.
 */
export const RESPONSE_SCHEMA_KEY = "responseSchema";

/**
 * Tags a route handler with a Zod schema for response validation.
 * The ResponseValidationInterceptor validates outgoing data against
 * this schema:
 * - Development: throws on validation failure
 * - Production: logs a warning but returns the data
 *
 * @param schema - A Zod schema that the response payload must satisfy
 *
 * @example
 * @Get(":id")
 * @ResponseSchema(PropertyResponseSchema)
 * findOne(@Param("id") id: string) { ... }
 */
export const ResponseSchema = (schema: ZodSchema) => SetMetadata(RESPONSE_SCHEMA_KEY, schema);
```

### `packages/common/src/decorators/index.ts`

```typescript
export { Public, IS_PUBLIC_KEY } from "./public.decorator";
export { Roles, ROLES_KEY } from "./roles.decorator";
export { CurrentUser } from "./current-user.decorator";
export { AuditAction, AuditActionMetadata, AUDIT_ACTION_KEY } from "./audit-action.decorator";
export { ResponseSchema, RESPONSE_SCHEMA_KEY } from "./response-schema.decorator";
```

### Combined Usage in a Controller

```typescript
import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Query,
    HttpCode,
    HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { Public, Roles, CurrentUser, AuditAction, ResponseSchema } from "@myorg/common";
import {
    PropertyResponseSchema,
    PropertyQuerySchema,
    CreatePropertyBodySchema,
    PropertyIdParamsSchema,
} from "@myorg/contracts";

@ApiTags("Properties")
@ApiBearerAuth()
@Controller("properties")
export class PropertyController {
    constructor(private readonly propertyService: PropertyService) {}

    // Public — no auth required
    @Public()
    @Get("search")
    @ApiOperation({ summary: "Public property search" })
    publicSearch(@Query("q") query: string) {
        return this.propertyService.publicSearch(query);
    }

    // Any authenticated user — no @Roles()
    @ResponseSchema(PropertyResponseSchema)
    @Get(":id")
    @ApiOperation({ summary: "Get property by ID" })
    findOne(@Param() rawParams: unknown) {
        const { id } = PropertyIdParamsSchema.parse(rawParams);
        return this.propertyService.findOne(id);
    }

    // FINANCE_OFFICER or higher — with audit logging
    @ResponseSchema(PropertyResponseSchema)
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @Roles("FINANCE_OFFICER", "SYSTEM_ADMIN")
    @AuditAction("create", "property")
    @ApiOperation({ summary: "Create property" })
    create(@Body() rawBody: unknown, @CurrentUser("userId") userId: string) {
        const body = CreatePropertyBodySchema.parse(rawBody);
        return this.propertyService.create(body, userId);
    }

    // SYSTEM_ADMIN only — with audit logging
    @Delete(":id")
    @HttpCode(HttpStatus.NO_CONTENT)
    @Roles("SYSTEM_ADMIN")
    @AuditAction("delete", "property")
    @ApiOperation({ summary: "Delete property" })
    remove(@Param() rawParams: unknown, @CurrentUser("userId") userId: string) {
        const { id } = PropertyIdParamsSchema.parse(rawParams);
        return this.propertyService.remove(id, userId);
    }
}
```
