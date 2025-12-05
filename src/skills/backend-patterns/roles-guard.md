# Role-Based Access Control Guard

> Pattern documentation for the global hierarchy-based RBAC guard that enforces minimum role requirements on controller handlers via the `@Roles()` decorator.

## 1. Component Pattern

The **RolesGuard** is a global NestJS guard (`@Injectable()` implementing
`CanActivate`) that enforces role-based authorization using a numeric
hierarchy. Each role maps to a level number. When a handler is decorated with
`@Roles("FINANCE_OFFICER")`, any authenticated user whose role level is ≥ the
`FINANCE_OFFICER` level (3) is allowed access. If no `@Roles()` decorator is
present, the guard allows any authenticated user through. The guard reads
`request.user` (set by `AuthGuard`) to determine the caller's role.

## 2. Overview

| Concern             | Detail                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ |
| **File location**   | `packages/common/src/roles.guard.ts`                                                 |
| **Class**           | `RolesGuard` — `@Injectable()` implementing `CanActivate`                            |
| **Global binding**  | Applied globally in `bootstrapModule()` via `APP_GUARD` — registered AFTER AuthGuard |
| **Decorator**       | `@Roles(...roles: string[])` sets `ROLES_KEY` metadata on a handler or class         |
| **No decorator**    | If `@Roles()` is absent, any authenticated user is allowed (guard returns `true`)    |
| **Hierarchy model** | Numeric level comparison — user's role level must be ≥ the minimum required level    |
| **Depends on**      | `request.user` (set by `AuthGuard`) — must run AFTER AuthGuard                       |
| **Error handling**  | Throws `ForbiddenException` when the user's role level is insufficient               |

### Role Hierarchy (lowest → highest)

| Role                  | Level |
| --------------------- | ----- |
| `READ_ONLY`           | 0     |
| `AUDITOR`             | 0     |
| `COUNTER_STAFF`       | 1     |
| `TAX_CLERK`           | 1     |
| `ASSESSOR`            | 2     |
| `COLLECTIONS_OFFICER` | 2     |
| `FINANCE_OFFICER`     | 3     |
| `TAX_MANAGER`         | 4     |
| `TREASURER`           | 5     |
| `SYSTEM_ADMIN`        | 6     |
| `SERVICE_ACCOUNT`     | 7     |

Multiple roles at the same level are interchangeable peers (e.g.,
`READ_ONLY` and `AUDITOR` both have level 0). Using `@Roles("FINANCE_OFFICER")`
means "FINANCE_OFFICER **or any higher role**" — it does NOT mean "only
FINANCE_OFFICER."

## 3. Rules

1. **RolesGuard is registered globally AFTER AuthGuard.** Order of
   `APP_GUARD` providers matters — AuthGuard sets `request.user` which
   RolesGuard reads.
2. **No `@Roles()` = open to any authenticated user.** The guard returns
   `true` when no roles metadata is found. Only the AuthGuard's
   authentication check applies.
3. **`@Roles()` accepts one or more role strings.** The guard takes the
   minimum level across all specified roles. Example: `@Roles("ASSESSOR",
"TAX_CLERK")` → minimum level = 1 (TAX_CLERK).
4. **Comparison is ≥ (greater than or equal).** The user's role level must
   be ≥ the minimum required level.
5. **Unknown roles default to level -1.** If a user's role is not in the
   hierarchy map, their level is -1 and they will be denied access to any
   role-protected route.
6. **`ForbiddenException` on denial.** The guard throws
   `ForbiddenException("Insufficient role permissions")`.
7. **Uses `Reflector.getAllAndOverride()`** to check handler-level metadata
   first, then class-level. Handler-level `@Roles()` overrides class-level.
8. **Role strings are uppercase with underscores.** Follow the
   `SCREAMING_SNAKE_CASE` convention.

## 4. Structure

```
packages/common/src/
├── roles.guard.ts                ← RolesGuard class + ROLE_HIERARCHY map
├── decorators/
│   └── roles.decorator.ts        ← @Roles() decorator + ROLES_KEY constant
└── index.ts                      ← Re-exports RolesGuard, Roles, ROLES_KEY
```

### Authorization Flow

```
Request arrives (request.user already set by AuthGuard)
  │
  ├── Read @Roles() metadata via Reflector
  │     └── No metadata found → return true (any authenticated user)
  │
  ├── Get user's role from request.user.role
  │     └── Look up numeric level in ROLE_HIERARCHY (default: -1)
  │
  ├── Get minimum required level from @Roles() values
  │     └── Math.min(...requiredRoles.map(r => ROLE_HIERARCHY[r] ?? Infinity))
  │
  ├── userLevel >= requiredLevel → return true
  │
  └── userLevel < requiredLevel → throw ForbiddenException
```

## 5. Example Implementation

### `packages/common/src/roles.guard.ts`

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "./decorators/roles.decorator";
import { RequestUser } from "./auth.guard";

/**
 * Numeric role hierarchy — higher number = more privileges.
 * Roles at the same level are peers (e.g., READ_ONLY and AUDITOR).
 */
export const ROLE_HIERARCHY: Record<string, number> = {
    READ_ONLY: 0,
    AUDITOR: 0,
    COUNTER_STAFF: 1,
    TAX_CLERK: 1,
    ASSESSOR: 2,
    COLLECTIONS_OFFICER: 2,
    FINANCE_OFFICER: 3,
    TAX_MANAGER: 4,
    TREASURER: 5,
    SYSTEM_ADMIN: 6,
    SERVICE_ACCOUNT: 7,
};

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        // 1. Read @Roles() metadata from handler or class
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        // 2. No @Roles() decorator → allow any authenticated user
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        // 3. Get the authenticated user from the request (set by AuthGuard)
        const request = context.switchToHttp().getRequest();
        const user = request.user as RequestUser;

        // 4. Resolve role levels
        const userLevel = ROLE_HIERARCHY[user.role] ?? -1;
        const requiredLevel = Math.min(...requiredRoles.map((r) => ROLE_HIERARCHY[r] ?? Infinity));

        // 5. Compare levels — user must be at or above the required level
        if (userLevel >= requiredLevel) {
            return true;
        }

        throw new ForbiddenException("Insufficient role permissions");
    }
}
```

### `packages/common/src/decorators/roles.decorator.ts`

```typescript
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/**
 * Specifies the minimum role(s) required to access a route.
 * The RolesGuard takes the minimum level across all specified roles
 * and requires the user's role level to be >= that minimum.
 *
 * @example @Roles("FINANCE_OFFICER")        // FINANCE_OFFICER or higher
 * @example @Roles("ASSESSOR", "TAX_CLERK")  // TAX_CLERK (level 1) or higher
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

### Usage in a Controller

```typescript
import { Controller, Get, Post, Body } from "@nestjs/common";
import { Roles, CurrentUser } from "@myorg/common";
import { RequestUser } from "@myorg/common";

@Controller("assessments")
export class AssessmentController {
    constructor(private readonly assessmentService: AssessmentService) {}

    // Any authenticated user can read assessments
    @Get()
    findAll(@CurrentUser() user: RequestUser) {
        return this.assessmentService.findAll(user.municipalityId);
    }

    // Only ASSESSOR (level 2) or higher can create assessments
    @Post()
    @Roles("ASSESSOR")
    create(@Body() dto: CreateAssessmentDto, @CurrentUser() user: RequestUser) {
        return this.assessmentService.create(dto, user);
    }

    // Only TAX_MANAGER (level 4) or higher can approve assessments
    @Post(":id/approve")
    @Roles("TAX_MANAGER")
    approve(@Param("id") id: string, @CurrentUser() user: RequestUser) {
        return this.assessmentService.approve(id, user);
    }
}
```

### Global Registration Order

```typescript
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard, RolesGuard } from "@myorg/common";

@Module({
    providers: [
        // Order matters: AuthGuard first, then RolesGuard
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
    ],
})
export class AppModule {}
```
