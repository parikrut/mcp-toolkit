# Authentication Guard

> Pattern documentation for the global JWT-based authentication guard that protects all routes by default, with opt-out via `@Public()`.

## 1. Component Pattern

The **AuthGuard** is a global NestJS guard (`@Injectable()` implementing
`CanActivate`) that intercepts every incoming HTTP request and validates a JWT
token before the request reaches a controller. Routes decorated with
`@Public()` bypass authentication entirely. The guard extracts the JWT from
either the `Authorization: Bearer <token>` header or the `app_access_token`
httpOnly cookie, verifies it against the `JWT_SECRET` environment variable, and
attaches the decoded payload to `request.user` as a `RequestUser` object.

## 2. Overview

| Concern              | Detail                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| **File location**    | `packages/common/src/auth.guard.ts`                                                   |
| **Class**            | `AuthGuard` — `@Injectable()` implementing `CanActivate`                              |
| **Global binding**   | Applied globally in `bootstrapModule()` via `APP_GUARD` provider                      |
| **Public bypass**    | Checks `@Public()` metadata (`IS_PUBLIC_KEY`) via `Reflector` — returns `true` if set |
| **Token extraction** | 1) `Authorization: Bearer <token>` header, 2) `app_access_token` httpOnly cookie    |
| **Verification**     | `jwt.verify(token, process.env.JWT_SECRET!)` — decodes to `RequestUser`               |
| **Request mutation** | Sets `request.user` to the decoded `RequestUser` payload                              |
| **Error handling**   | Throws `UnauthorizedException` on missing token or invalid/expired token              |
| **RequestUser**      | Exported interface: `{ userId, email, role, municipalityId, name }`                   |
| **Execution order**  | Runs AFTER middleware, BEFORE interceptors. Runs before `RolesGuard` (order matters). |

The `RequestUser` interface is the canonical user shape used by controllers
(via `@CurrentUser()`), services, and interceptors throughout the platform.

## 3. Rules

1. **AuthGuard is registered globally.** It is added as an `APP_GUARD`
   provider in the module bootstrap — individual modules do NOT register it.
2. **`@Public()` is the only opt-out mechanism.** Any route or controller
   class decorated with `@Public()` bypasses authentication. There is no
   allowlist or URL-pattern-based bypass.
3. **Token extraction priority:** Header (`Authorization: Bearer`) is checked
   first. If absent, the `app_access_token` cookie is checked. If neither
   exists, `UnauthorizedException` is thrown.
4. **JWT_SECRET must be set in the environment.** The guard reads
   `process.env.JWT_SECRET` directly. Missing secret will cause verification
   to fail.
5. **Decoded payload must conform to `RequestUser`.** The JWT payload is cast
   to `RequestUser` — the token issuer (auth service) must include `userId`,
   `email`, `role`, `municipalityId`, and `name` claims.
6. **`request.user` is always set on authenticated routes.** After
   verification, the guard assigns the decoded payload to `request.user`.
   Downstream code (controllers, interceptors, services) can rely on this.
7. **Error messages are generic.** `"Missing authentication token"` for absent
   tokens, `"Invalid or expired token"` for verification failures. Never
   expose internal details.
8. **Guard order matters.** AuthGuard runs BEFORE `RolesGuard`. The roles
   guard depends on `request.user` being set by the auth guard.

## 4. Structure

```
packages/common/src/
├── auth.guard.ts              ← AuthGuard class + RequestUser interface
├── decorators/
│   └── public.decorator.ts    ← @Public() decorator + IS_PUBLIC_KEY constant
└── index.ts                   ← Re-exports AuthGuard, RequestUser
```

### Token Extraction Flow

```
Request arrives
  │
  ├── Check @Public() metadata via Reflector
  │     └── If true → return true (skip auth)
  │
  ├── Extract token
  │     ├── 1. Authorization header → "Bearer <token>" → slice(7)
  │     └── 2. Cookie → request.cookies.app_access_token
  │
  ├── No token found → throw UnauthorizedException("Missing authentication token")
  │
  ├── jwt.verify(token, JWT_SECRET)
  │     ├── Success → cast payload as RequestUser
  │     └── Failure → throw UnauthorizedException("Invalid or expired token")
  │
  └── Set request.user = payload → return true
```

## 5. Example Implementation

### `packages/common/src/auth.guard.ts`

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { IS_PUBLIC_KEY } from "./decorators/public.decorator";

/**
 * Canonical authenticated-user shape attached to every request.
 * Decoded from the JWT payload by AuthGuard.
 */
export interface RequestUser {
    userId: string;
    email: string;
    role: string;
    municipalityId: string;
    name: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        // 1. Check for @Public() decorator — skip auth if present
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        // 2. Extract token from header or cookie
        const request = context.switchToHttp().getRequest();
        const token = this.extractToken(request);

        if (!token) {
            throw new UnauthorizedException("Missing authentication token");
        }

        // 3. Verify JWT and attach decoded payload to request
        try {
            const payload = jwt.verify(token, process.env.JWT_SECRET!) as RequestUser;
            request.user = payload;
            return true;
        } catch {
            throw new UnauthorizedException("Invalid or expired token");
        }
    }

    /**
     * Extracts the JWT from the Authorization header (Bearer scheme)
     * or the app_access_token httpOnly cookie.
     */
    private extractToken(request: any): string | null {
        // Priority 1: Authorization header
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
            return authHeader.slice(7);
        }

        // Priority 2: httpOnly cookie
        return request.cookies?.app_access_token ?? null;
    }
}
```

### Global Registration in `bootstrapModule()`

```typescript
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "@myorg/common";

@Module({
    providers: [
        {
            provide: APP_GUARD,
            useClass: AuthGuard,
        },
        // RolesGuard registered AFTER AuthGuard
        {
            provide: APP_GUARD,
            useClass: RolesGuard,
        },
    ],
})
export class AppModule {}
```

### Using `RequestUser` in a Service

```typescript
import { RequestUser } from "@myorg/common";

@Injectable()
export class PropertyService {
    async getProperty(id: string, user: RequestUser) {
        // user.municipalityId scopes the query
        return this.prisma.property.findFirst({
            where: { id, municipalityId: user.municipalityId },
        });
    }
}
```
