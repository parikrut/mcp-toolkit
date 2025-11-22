# Environment Variable Validation

## 1. Component Pattern

**Type:** Configuration Validation  
**Layer:** Platform / Bootstrap  
**Reference Implementation:** `packages/common/src/env.ts`

## 2. Overview

Every microservice validates its environment variables at startup before any other initialization occurs. This is a **fail-fast** pattern: if any required environment variable is missing, malformed, or fails a validation constraint, the server refuses to start and prints a descriptive error listing every issue.

The validation engine is Zod. A `BaseEnvSchema` is defined in the `@civic/common` package and includes all environment variables shared across services: `PORT`, `NODE_ENV`, `DATABASE_URL`, `RABBITMQ_URL`, `JWT_SECRET` / `JWT_ACCESS_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGIN`, `LOG_LEVEL`, and `RATE_LIMIT_MAX`. Numeric fields use `z.coerce.number()` so they are automatically parsed from string environment variables. Fields with sensible defaults (like `PORT: 3000`, `NODE_ENV: "development"`) use `.default()` so they are optional in the environment but always present in the typed output.

Each module extends `BaseEnvSchema` with module-specific variables using Zod's `.extend()` method. For example, the tax billing module adds `ASSESSMENT_ROLL_URL`, the payment processing module adds `ENCRYPTION_KEY`, and so on. The extended schema is exported as a named type (`ModuleEnv`) for use throughout the module.

The `validateEnv(schema, env)` function parses the provided `env` object (defaulting to `process.env`) against the given Zod schema. On success, it returns a fully typed, coerced configuration object. On failure, it throws an `Error` with a formatted message listing every validation issue with its field path and error description.

This function is called in the module's `main.ts` file — before `bootstrapModule()`, before NestJS initializes, before any database connection is attempted. This ensures the application cannot start in an invalid state.

## 3. Rules

1. **`BaseEnvSchema` is the foundation.** Every module's env schema must extend `BaseEnvSchema` from `@civic/common`. Never define shared fields (PORT, NODE_ENV, JWT_SECRET, etc.) independently in a module.
2. **Zod is the schema engine.** All environment validation uses Zod. Do not use `class-validator`, `joi`, or manual `process.env` checks.
3. **`z.coerce.number()` for numeric env vars.** Environment variables are always strings. Use `z.coerce.number()` (not `z.number()`) for fields like `PORT` and `RATE_LIMIT_MAX` so Zod automatically parses the string to a number.
4. **`.default()` for optional-with-defaults.** Fields with sensible defaults use `.default()` (e.g., `PORT: z.coerce.number().default(3000)`). This means the field is optional in the environment but always present and typed in the output.
5. **`.optional()` for truly optional fields.** Fields that may be absent without a default use `.optional()` (e.g., `CORS_ORIGIN: z.string().optional()`). The output type will be `string | undefined`.
6. **`.extend()` for module-specific vars.** Modules add their own variables by calling `BaseEnvSchema.extend({ ... })`. This preserves all base validations and adds new ones.
7. **Export the inferred type.** Always export `type ModuleEnv = z.infer<typeof ModuleEnvSchema>` so the typed config object can be used throughout the module.
8. **Call `validateEnv()` before bootstrap.** In the module's `main.ts`, call `validateEnv(ModuleEnvSchema, process.env)` before `bootstrapModule()` or any NestJS initialization. The validated env should be stored in a module-scoped constant.
9. **Fail-fast with descriptive errors.** `validateEnv()` throws an `Error` with all validation issues formatted as a list. The error message includes the field path and the Zod error message for each issue.
10. **No `process.env` access in application code.** After validation, all code should reference the typed env object (e.g., `env.PORT`, `env.DATABASE_URL`), never raw `process.env.PORT`. The only exception is `PrismaService`, which reads `process.env.DATABASE_URL` directly in its constructor (before DI is available).
11. **URL validation for service URLs.** Module-specific service URLs (e.g., `ASSESSMENT_ROLL_URL`) should use `z.string().url()` to validate they are properly formatted URLs.
12. **Minimum length for secrets.** Secret fields like `JWT_SECRET` and `ENCRYPTION_KEY` should use `z.string().min(32)` to enforce minimum key length.
13. **Refinements for complex validation.** Use `.refine()` for cross-field validation (e.g., "at least one of `JWT_ACCESS_SECRET` or `JWT_SECRET` must be provided").

## 4. Structure

```
packages/common/src/
├── env.ts                      # BaseEnvSchema + validateEnv() — shared by all modules
└── index.ts                    # Re-exports BaseEnvSchema, validateEnv, BaseEnv type

modules/domain/<domain>/<module>/src/
├── env.ts                      # Module-specific schema extending BaseEnvSchema
└── main.ts                     # Calls validateEnv() before bootstrapModule()
```

**Dependency graph:**

```
@civic/common/env.ts
    ├── BaseEnvSchema (Zod object schema)
    ├── BaseEnv (inferred type)
    └── validateEnv<T>(schema, env) → T | throws Error

modules/<module>/src/env.ts
    ├── ModuleEnvSchema = BaseEnvSchema.extend({ ... })
    ├── ModuleEnv (inferred type)
    └── env = validateEnv(ModuleEnvSchema, process.env)

modules/<module>/src/main.ts
    └── import { env } from "./env"  ← used before bootstrapModule()
```

**Import sources:**

| Import                         | Package         |
| ------------------------------ | --------------- |
| `z`                            | `zod/v4`        |
| `BaseEnvSchema`, `validateEnv` | `@civic/common` |

## 5. Example Implementation

**Base schema (`packages/common/src/env.ts`):**

```typescript
import { z } from "zod/v4";

/**
 * Base environment schema shared by all services.
 * Services can extend this with their own additional vars.
 *
 * DATABASE_URL and RABBITMQ_URL are optional here — services that
 * need them should extend BaseEnvSchema via `.extend()`:
 *
 *   const MyServiceEnv = BaseEnvSchema.extend({
 *       DATABASE_URL: z.string().min(1),
 *       RABBITMQ_URL: z.string().min(1),
 *   });
 */
export const BaseEnvSchema = z
    .object({
        PORT: z.coerce.number().default(3000),
        NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
        DATABASE_URL: z.string().min(1).optional(),
        RABBITMQ_URL: z.string().min(1).optional(),
        JWT_ACCESS_SECRET: z.string().min(32).optional(),
        JWT_REFRESH_SECRET: z.string().min(32).optional(),
        JWT_SECRET: z.string().min(32).optional(),
        JWT_EXPIRES_IN: z.string().default("15m"),
        REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
        CORS_ORIGIN: z.string().optional(),
        LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
        RATE_LIMIT_MAX: z.coerce.number().default(100),
    })
    .refine(
        (env) =>
            (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length > 0) ||
            (env.JWT_SECRET && env.JWT_SECRET.length > 0),
        {
            message: "At least one of JWT_ACCESS_SECRET or JWT_SECRET must be provided",
            path: ["JWT_ACCESS_SECRET"],
        },
    );

/** Inferred type from the base env schema. */
export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/**
 * Validate environment variables against a Zod schema.
 * Throws a descriptive error with all issues on failure.
 *
 * @param schema  Zod schema to validate against
 * @param env     Object to validate (defaults to `process.env`)
 * @returns       Parsed & coerced environment object
 */
export function validateEnv<T>(
    schema: z.ZodType<T>,
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): T {
    const result = schema.safeParse(env);

    if (result.success) {
        return result.data;
    }

    const formatted = result.error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join(".") : "root";
            return `  - ${path}: ${issue.message}`;
        })
        .join("\n");

    throw new Error(`Environment validation failed:\n${formatted}`);
}
```

**Module-specific schema (`modules/domain/revenue/tax-billing-instalment/src/env.ts`):**

```typescript
import { z } from "zod/v4";
import { BaseEnvSchema, validateEnv } from "@civic/common";

/**
 * Tax Billing & Instalment — Environment Schema
 *
 * Extends the base schema with module-specific variables:
 *   - DATABASE_URL: Required (this module owns a database)
 *   - RABBITMQ_URL: Required (publishes billing events)
 *   - ASSESSMENT_ROLL_URL: HTTP client URL for cross-service data
 *   - NOTIFICATION_ENGINE_URL: HTTP client URL for sending notices
 */
const TaxBillingEnvSchema = BaseEnvSchema.extend({
    // ── Required infrastructure ─────────────────────────────
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required for this module"),
    RABBITMQ_URL: z.string().min(1, "RABBITMQ_URL is required for this module"),

    // ── Cross-service URLs ──────────────────────────────────
    ASSESSMENT_ROLL_URL: z.string().url("ASSESSMENT_ROLL_URL must be a valid URL"),
    NOTIFICATION_ENGINE_URL: z
        .string()
        .url("NOTIFICATION_ENGINE_URL must be a valid URL")
        .optional(),

    // ── Module-specific config ──────────────────────────────
    PENALTY_RATE_PERCENT: z.coerce.number().default(1.25),
    MAX_INSTALMENT_PLANS: z.coerce.number().default(4),
    BILLING_CYCLE_DAY: z.coerce.number().min(1).max(28).default(1),
});

export type TaxBillingEnv = z.infer<typeof TaxBillingEnvSchema>;

// Validate immediately on import — fail-fast before bootstrap
export const env = validateEnv(TaxBillingEnvSchema, process.env);
```

**Module entrypoint using validated env (`modules/domain/revenue/tax-billing-instalment/src/main.ts`):**

```typescript
import { env } from "./env"; // ← Validation runs on import (fail-fast)
import { bootstrapModule } from "@civic/common";
import { TaxBillingInstalmentModule } from "./tax-billing-instalment.module";

async function main() {
    // env is already validated — safe to use typed properties
    const app = await bootstrapModule(TaxBillingInstalmentModule, {
        port: env.PORT,
        cors: env.CORS_ORIGIN,
        logLevel: env.LOG_LEVEL,
    });

    console.log(`Tax Billing & Instalment service running on port ${env.PORT} [${env.NODE_ENV}]`);
}

main();
```

**Payment Processing module with encryption key requirement:**

```typescript
import { z } from "zod/v4";
import { BaseEnvSchema, validateEnv } from "@civic/common";

const PaymentProcessingEnvSchema = BaseEnvSchema.extend({
    DATABASE_URL: z.string().min(1),
    RABBITMQ_URL: z.string().min(1),

    // ── Payment-specific ────────────────────────────────────
    ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters"),
    PAYMENT_GATEWAY_URL: z.string().url(),
    PAYMENT_GATEWAY_API_KEY: z.string().min(1),
    PAYMENT_GATEWAY_TIMEOUT_MS: z.coerce.number().default(30000),

    // ── Cross-service URLs ──────────────────────────────────
    TAX_BILLING_URL: z.string().url(),
    NOTIFICATION_ENGINE_URL: z.string().url().optional(),

    // ── Redis (for idempotency keys) ────────────────────────
    REDIS_URL: z.string().url().optional(),
});

export type PaymentProcessingEnv = z.infer<typeof PaymentProcessingEnvSchema>;

export const env = validateEnv(PaymentProcessingEnvSchema, process.env);
```

**Example error output when validation fails:**

```
Error: Environment validation failed:
  - DATABASE_URL: Required
  - RABBITMQ_URL: Required
  - ASSESSMENT_ROLL_URL: ASSESSMENT_ROLL_URL must be a valid URL
  - JWT_ACCESS_SECRET: At least one of JWT_ACCESS_SECRET or JWT_SECRET must be provided
```

**Key observations from the example:**

- `BaseEnvSchema` makes `DATABASE_URL` and `RABBITMQ_URL` optional at the base level because not every service needs them (e.g., API Gateway is stateless). Modules that require them override with `z.string().min(1)` in their `.extend()` call, making them required.
- `z.coerce.number()` automatically converts string env vars to numbers: `"3000"` → `3000`, `"100"` → `100`. This avoids manual `parseInt()` calls throughout the codebase.
- The `.refine()` on `BaseEnvSchema` enforces a cross-field constraint: at least one of `JWT_ACCESS_SECRET` or `JWT_SECRET` must be present. This supports both the new dual-token auth (access + refresh) and legacy single-token setups.
- `validateEnv()` is generic (`<T>`) so it works with any Zod schema and returns the correctly inferred type. The caller gets full TypeScript type safety.
- The `env` constant is exported from the module's `env.ts` file. Validation runs eagerly on import — if it fails, the Node.js process crashes before NestJS even starts.
- All error messages are aggregated into a single throw. The developer sees every issue at once rather than fixing them one at a time.
- Module-specific numeric configs (like `PENALTY_RATE_PERCENT`, `MAX_INSTALMENT_PLANS`) use `z.coerce.number().default()` to provide sensible defaults while still allowing override via environment.
