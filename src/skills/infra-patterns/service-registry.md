# Typed Service Registry Pattern

## 1. Component Pattern

**Type:** Typed Configuration Registry  
**Layer:** Infrastructure / Configuration Source of Truth  
**Reference Implementation:** `products/property-tax/infra/service-registry.ts`

## 2. Overview

The service registry is a single TypeScript file that defines **every microservice** in a product: its hostname, port, database name, Dockerfile path, API routes, architectural layer, and inter-service dependencies. It is the **single source of truth** for all infrastructure configuration.

The registry is declared as a `const` object with `as const satisfies Record<string, ServiceDefinition>`. This gives you:

- **Full type inference** — TypeScript knows the exact literal types of every port, hostname, route, and key.
- **Structural validation** — `satisfies` ensures every entry matches `ServiceDefinition` without widening the type.
- **Derived types** — `ServiceKey`, `ServicePort`, `ServiceHostname`, and `DatabaseName` are extracted from the registry's type, so consumers get union types of valid values.
- **Compile-time safety** — Conditional types detect duplicate ports at build time.

The registry is consumed by:

- `infra/generate.ts` — reads the registry to generate `nginx.conf`, `init-databases.sql`, and `start-dev.sh`
- `docker-compose.yml` — service definitions mirror the registry (ports, hostnames, databases)
- `manifest.yaml` — module composition references registry service names
- Runtime code — can import `ServiceKey` for type-safe service references

Runtime validation in `generate.ts` catches errors that TypeScript's type system can't easily express: route uniqueness across services, `extraEnv` URL hostname/port consistency, and `dependsOn` referencing valid service keys.

## 3. Rules

1. **One entry per microservice.** The key is the Docker Compose service name (kebab-case). It must match the `hostname` field.
2. **Ports are globally unique.** No two services may share a port. The compile-time `AssertUniquePorts` type catches this, and `generate.ts` validates at runtime.
3. **Routes are globally unique.** No two services may own the same API route prefix. Validated at runtime by `generate.ts`.
4. **Database names are snake_case.** Derived from the service name (e.g., `tax-billing-instalment` → `tax_billing_instalment`). Services without a database (e.g., API gateway) set `database: ""`.
5. **Layer must be `"platform"`, `"shared"`, or `"domain"`.** This determines startup order and documentation grouping.
6. **Routes include the full path prefix.** Always `/api/v1/<resource>`. No trailing slash.
7. **`extraEnv` URL values must reference valid services.** The URL format is `http://<hostname>:<port>`. Both hostname and port must match an existing registry entry. Validated by `generate.ts`.
8. **`dependsOn` references registry keys.** Not hostnames, not package names — the keys of the registry object. Validated by `generate.ts`.
9. **`needsRedis` is opt-in.** Only set `needsRedis: true` on services that use Redis (rate limiting, caching, sessions). This controls whether `REDIS_URL` is added and `redis` appears in `depends_on`.
10. **The registry is `as const satisfies`.** Never use a plain object type — the const assertion preserves literal types for derived union types.
11. **Export derived types.** Always export `ServiceKey`, `ServicePort`, `ServiceHostname`, `DatabaseName` for consumers.
12. **Export the registry object.** Named export `serviceRegistry` — consumed by `generate.ts` and potentially by runtime code.

## 4. Structure

```
products/<product-name>/infra/
├── service-registry.ts         # This file (single source of truth)
├── generate.ts                 # Reads registry → generates infra files
└── init-databases.sql          # Generated output
```

**Type hierarchy:**

```
ServiceDefinition (interface)
  ├── hostname:   string
  ├── port:       number
  ├── database:   string
  ├── dockerfile: string
  ├── routes:     readonly string[]
  ├── layer:      "platform" | "shared" | "domain"
  ├── label:      string
  ├── extraEnv?:  Record<string, string>
  ├── dependsOn?: readonly string[]
  └── needsRedis?: boolean

serviceRegistry (const object)
  └── as const satisfies Record<string, ServiceDefinition>

Derived types:
  ├── ServiceKey      = keyof typeof serviceRegistry
  ├── ServicePort     = registry[ServiceKey]["port"]
  ├── ServiceHostname = registry[ServiceKey]["hostname"]
  └── DatabaseName    = registry[ServiceKey]["database"]
```

**Compile-time validation type:**

```typescript
// Detects port collisions at compile time via conditional types
type AssertUniquePorts = {
    [K in ServiceKey]: {
        [K2 in ServiceKey]: K extends K2
            ? never
            : registry[K]["port"] extends registry[K2]["port"]
              ? `ERROR: Port collision between '${K}' and '${K2}'`
              : never;
    };
};
```

## 5. Example Implementation

```typescript
/**
 * ─── Service Registry — Single Source of Truth ──────────────
 *
 * Every microservice, its port, database name, Dockerfile path,
 * and API route prefixes are defined here ONCE.
 *
 * Generated artifacts:
 *   • apps/<product>-web/nginx.conf
 *   • products/<product>/infra/init-databases.sql
 *   • products/<product>/start-dev.sh
 *
 * Run:  pnpm tsx infra/generate.ts
 */

// ─── Types ──────────────────────────────────────────────────

export interface ServiceDefinition {
    /** Docker Compose service name (used as hostname in the Docker network) */
    readonly hostname: string;
    /** Internal port the NestJS app listens on */
    readonly port: number;
    /** PostgreSQL database name (snake_case). Empty string if no DB needed. */
    readonly database: string;
    /** Path to Dockerfile relative to monorepo root */
    readonly dockerfile: string;
    /** API route prefixes this service handles (without trailing slash) */
    readonly routes: readonly string[];
    /** Layer for documentation / ordering */
    readonly layer: "platform" | "shared" | "domain";
    /** Human-readable label */
    readonly label: string;
    /** Extra env vars beyond the shared ones (PORT, DATABASE_URL, RABBITMQ_URL, JWT_SECRET) */
    readonly extraEnv?: Readonly<Record<string, string>>;
    /** Services this service depends on (by registry key, not hostname) */
    readonly dependsOn?: readonly string[];
    /** Whether the service needs Redis (adds REDIS_URL env and redis dependency) */
    readonly needsRedis?: boolean;
}

// ─── Registry ───────────────────────────────────────────────

const serviceRegistry = {
    // ── Platform Layer (L1) ─────────────────────────
    "auth-gateway": {
        hostname: "auth-gateway",
        port: 4100,
        database: "auth_gateway",
        dockerfile: "modules/platform/auth-gateway/Dockerfile",
        layer: "platform",
        label: "Auth Gateway",
        needsRedis: true,
        routes: ["/api/v1/auth", "/api/v1/users"],
        extraEnv: {
            REFRESH_TOKEN_EXPIRES_IN: "7d",
        },
    },
    "notification-engine": {
        hostname: "notification-engine",
        port: 4101,
        database: "notification_engine",
        dockerfile: "modules/platform/notification-engine/Dockerfile",
        layer: "platform",
        label: "Notification Engine",
        routes: ["/api/v1/notifications", "/api/v1/templates", "/api/v1/consent"],
    },
    "audit-logging": {
        hostname: "audit-logging",
        port: 4300,
        database: "audit_logging",
        dockerfile: "modules/platform/audit-logging/Dockerfile",
        layer: "platform",
        label: "Audit Logging",
        routes: ["/api/v1/audit-logs"],
    },

    // ── Shared Layer (L2) ───────────────────────────
    "billing-invoicing": {
        hostname: "billing-invoicing",
        port: 4102,
        database: "billing_invoicing",
        dockerfile: "modules/shared/billing-invoicing/Dockerfile",
        layer: "shared",
        label: "Billing & Invoicing",
        routes: ["/api/v1/invoices", "/api/v1/billing"],
        extraEnv: {
            NOTIFICATION_ENGINE_URL: "http://notification-engine:4101",
        },
    },
    "api-gateway": {
        hostname: "api-gateway",
        port: 4110,
        database: "", // no database — pure proxy
        dockerfile: "modules/shared/api-gateway/Dockerfile",
        layer: "shared",
        label: "API Gateway",
        routes: ["/api/v1/citizen-portal"],
        dependsOn: ["auth-gateway", "resource-module", "billing-invoicing"],
        extraEnv: {
            AUTH_GATEWAY_URL: "http://auth-gateway:4100",
            RESOURCE_MODULE_URL: "http://resource-module:4104",
            BILLING_INVOICING_URL: "http://billing-invoicing:4102",
        },
    },

    // ── Domain Layer (L3) ───────────────────────────
    "resource-module": {
        hostname: "resource-module",
        port: 4104,
        database: "resource_module",
        dockerfile: "modules/domain/revenue/resource-module/Dockerfile",
        layer: "domain",
        label: "Resource Module",
        routes: ["/api/v1/resources", "/api/v1/sub-resources"],
    },
    "another-module": {
        hostname: "another-module",
        port: 4105,
        database: "another_module",
        dockerfile: "modules/domain/revenue/another-module/Dockerfile",
        layer: "domain",
        label: "Another Module",
        needsRedis: true,
        routes: ["/api/v1/other-resources"],
        extraEnv: {
            RESOURCE_MODULE_URL: "http://resource-module:4104",
        },
    },
} as const satisfies Record<string, ServiceDefinition>;

// ─── Derived Types ──────────────────────────────────────────

/** Union of all valid service keys (e.g., "auth-gateway" | "resource-module" | ...) */
export type ServiceKey = keyof typeof serviceRegistry;

/** Union of all service ports (e.g., 4100 | 4101 | 4102 | ...) */
export type ServicePort = (typeof serviceRegistry)[ServiceKey]["port"];

/** Union of all Docker hostnames */
export type ServiceHostname = (typeof serviceRegistry)[ServiceKey]["hostname"];

/** Union of all database names */
export type DatabaseName = (typeof serviceRegistry)[ServiceKey]["database"];

// ─── Exports ────────────────────────────────────────────────

export { serviceRegistry };

// ─── Compile-Time Validations ───────────────────────────────

// Ensure no duplicate ports at compile time.
// If two services share a port, this type resolves to an error string
// (which would cause a type error if ever assigned/used).
type AssertUniquePorts = {
    [K in ServiceKey]: {
        [K2 in ServiceKey]: K extends K2
            ? never
            : (typeof serviceRegistry)[K]["port"] extends (typeof serviceRegistry)[K2]["port"]
              ? `ERROR: Port collision between '${K}' and '${K2}'`
              : never;
    };
};

// Route uniqueness is validated at runtime by generate.ts since
// TypeScript can't easily check cross-key array element uniqueness.
```

**Adapting for a new product:**

1. Create `products/<new-product>/infra/service-registry.ts`.
2. Copy the `ServiceDefinition` interface (it's the same for every product).
3. Define services starting with platform (auth-gateway is always present), then shared, then domain.
4. Assign unique ports (convention: 4100–4199 for platform, 4200–4299 for shared, 4300+ for domain).
5. Set `extraEnv` for any service that calls another service's HTTP API.
6. Set `dependsOn` for services that need another service to be running before they can start.
7. Run `pnpm tsx infra/generate.ts` to validate and generate infrastructure files.

**Adding a new service to an existing registry:**

```typescript
// Add to the registry object:
"new-service": {
    hostname: "new-service",
    port: 4109,                    // must be unique
    database: "new_service",       // snake_case of hostname
    dockerfile: "modules/domain/revenue/new-service/Dockerfile",
    layer: "domain",
    label: "New Service",
    routes: ["/api/v1/new-resources"],
    extraEnv: {
        // Only if this service calls another service's API
        ASSESSMENT_ROLL_URL: "http://assessment-roll:4104",
    },
},
```

Then run `pnpm tsx infra/generate.ts` — it will:

- Validate the new port is unique
- Validate the new routes don't conflict
- Validate `extraEnv` URLs reference valid hostnames and ports
- Regenerate `nginx.conf`, `init-databases.sql`, and `start-dev.sh`
