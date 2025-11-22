# Product Manifest (YAML) Pattern

## 1. Component Pattern

**Type:** Product Composition Manifest  
**Layer:** Infrastructure / Deployment Configuration  
**Reference Implementation:** `products/property-tax/manifest.yaml`

## 2. Overview

Every product in the platform has a `manifest.yaml` that declaratively describes its complete composition: which modules it includes, how the API gateway routes traffic, where health checks live, and what infrastructure it requires. The deployment pipeline reads this manifest to provision **only the required services** for each tenant — enabling per-tenant product customization without code changes.

The manifest has four top-level sections:

1. **`product`** — Metadata: name, version, description.
2. **`gateway`** — Kong API gateway configuration: subdomain, route-to-upstream mappings, Swagger docs routes, and health check routes per service.
3. **`modules`** — Module composition organized by layer (platform, shared, domain). Each module declares its name, version constraint, required flag, and runtime config (port, replicas).
4. **`infrastructure`** — Database topology (one DB per module), messaging (RabbitMQ vhost), and cache (Redis) configuration.

The manifest bridges the gap between the typed service registry (developer-focused, TypeScript) and the deployment system (ops-focused, YAML). While the service registry defines _how_ services are built and networked locally, the manifest defines _what_ a product is composed of and _how_ it's deployed to production.

## 3. Rules

1. **One manifest per product.** Located at `products/<product-name>/manifest.yaml`.
2. **`product` section is mandatory.** Must include `name` (kebab-case), `version` (CalVer: `YYYY.N`), and `description`.
3. **Gateway type is `kong`.** All products use the Kong API gateway for routing.
4. **Subdomain is product-scoped.** Format: `<subdomain>.<tenant>.civic-platform.ca`. The subdomain should be short and descriptive (e.g., `tax`, `hr`, `fleet`).
5. **Every API route maps to exactly one upstream.** Routes never fan out to multiple services. The `upstream` value matches the service registry key / Docker Compose hostname.
6. **Swagger docs route per module.** Format: `path: /docs/<short-name>` → `rewrite: /swagger`. This maps a product-level docs URL to each service's Swagger UI.
7. **Health check per service.** Format: `path: /api/v1/health/<service-name>` → `target: http://<hostname>:<port>/health`. The gateway proxies health checks so monitoring tools have a single entry point.
8. **Modules organized by layer.** `platform` (L1) → `shared` (L2) → `domain` (L3). Each entry has `name`, `version`, `required`, and `config`.
9. **Version constraints use semver ranges.** Typically `"^0.1.0"` during initial development.
10. **`required: true`** means the product cannot function without this module. Optional modules (e.g., add-on features) use `required: false`.
11. **Config includes port and replicas.** Port must match the service registry. Replicas is a deployment hint (minimum instances).
12. **Infrastructure databases follow DB-per-service.** One database entry per module that has persistent storage. Name is snake_case, module references the kebab-case service name.
13. **Messaging uses a product-scoped vhost.** All modules in the product share one RabbitMQ vhost (e.g., `/property-tax`). This provides isolation between products on the same broker.
14. **Cache is shared.** All modules in the product share one Redis instance / database number.
15. **Auth gateway is implicit.** The auth-gateway module is always present (it's a platform service) but may not appear in the `modules` section if it's provisioned separately by the platform layer.

## 4. Structure

```
products/<product-name>/
├── manifest.yaml               # This file (product composition)
├── docker-compose.yml          # Development stack (mirrors manifest)
├── infra/
│   ├── service-registry.ts     # Typed source of truth for local dev
│   ├── generate.ts             # Generates infra files
│   └── init-databases.sql      # Generated from registry
└── start-dev.sh                # Generated dev startup script
```

**Section hierarchy:**

```yaml
product:
    name: ...
    version: ...
    description: ...

gateway:
    type: kong
    subdomain: ...
    routes:
        - path → upstream + port
        - path → upstream + rewrite (for docs)
    health:
        - path → target

modules:
    platform:
        - name, version, required, config
    shared:
        - name, version, required, config
    domain:
        - name, version, required, config

infrastructure:
    databases:
        - name → module
    messaging: type, vhost
    cache: type, db
```

**Route types:**

| Type         | Fields                                  | Purpose                                            |
| ------------ | --------------------------------------- | -------------------------------------------------- |
| API route    | `path`, `upstream`, `port`              | Forward API traffic to the correct service         |
| Docs route   | `path`, `upstream`, `rewrite: /swagger` | Expose per-module Swagger UI at product-level URLs |
| Health route | `path`, `target`                        | Proxy health checks through the gateway            |

## 5. Example Implementation

```yaml
# ─── Product Manifest ────────────────────────────────────────
# Declares which modules compose this product, their versions,
# and the product-level API gateway routing.
#
# The deployment pipeline reads this manifest to provision only
# the required services for each tenant.

product:
    name: product-name
    version: "2026.1"
    description: "Municipal Product Name — Short Description"

# ──────────────────────────────────────────────────
# Product-Level API Gateway
# ──────────────────────────────────────────────────

gateway:
    type: kong
    subdomain: product # product.<tenant>.civic-platform.ca
    routes:
        # ── Auth Gateway (platform — always present) ──
        - path: /api/v1/auth
          upstream: auth-gateway
          port: 4100
        - path: /api/v1/users
          upstream: auth-gateway
          port: 4100

        # ── Audit Logging (platform) ──
        - path: /api/v1/audit-logs
          upstream: audit-logging
          port: 4300

        # ── Notification Engine (platform) ──
        - path: /api/v1/notifications
          upstream: notification-engine
          port: 4101
        - path: /api/v1/templates
          upstream: notification-engine
          port: 4101
        - path: /api/v1/consent
          upstream: notification-engine
          port: 4101

        # ── Billing & Invoicing (shared) ──
        - path: /api/v1/invoices
          upstream: billing-invoicing
          port: 4102
        - path: /api/v1/billing
          upstream: billing-invoicing
          port: 4102

        # ── Resource Module (domain) ──
        - path: /api/v1/resources
          upstream: resource-module
          port: 4104
        - path: /api/v1/sub-resources
          upstream: resource-module
          port: 4104

        # ── Another Module (domain) ──
        - path: /api/v1/other-resources
          upstream: another-module
          port: 4105

        # ── Swagger docs per module ──
        - path: /docs/notifications
          upstream: notification-engine
          rewrite: /swagger
        - path: /docs/billing
          upstream: billing-invoicing
          rewrite: /swagger
        - path: /docs/resources
          upstream: resource-module
          rewrite: /swagger
        - path: /docs/other
          upstream: another-module
          rewrite: /swagger

    # ── Health Check Routes ────────────────────────
    health:
        - path: /api/v1/health/auth-gateway
          target: http://auth-gateway:4100/health
        - path: /api/v1/health/notification-engine
          target: http://notification-engine:4101/health
        - path: /api/v1/health/billing-invoicing
          target: http://billing-invoicing:4102/health
        - path: /api/v1/health/audit-logging
          target: http://audit-logging:4300/health
        - path: /api/v1/health/resource-module
          target: http://resource-module:4104/health
        - path: /api/v1/health/another-module
          target: http://another-module:4105/health

# ──────────────────────────────────────────────────
# Module Composition
# ──────────────────────────────────────────────────

modules:
    # Platform layer (L1) — foundational services
    platform:
        - name: auth-gateway
          version: "^0.1.0"
          required: true
          config:
              port: 4100
              replicas: 2
        - name: notification-engine
          version: "^0.1.0"
          required: true
          config:
              port: 4101
              replicas: 2
        - name: audit-logging
          version: "^0.1.0"
          required: true
          config:
              port: 4300
              replicas: 1

    # Shared layer (L2) — cross-domain services
    shared:
        - name: billing-invoicing
          version: "^0.1.0"
          required: true
          config:
              port: 4102
              replicas: 2

    # Domain layer (L3) — business-specific
    domain:
        - name: resource-module
          version: "^0.1.0"
          required: true
          config:
              port: 4104
              replicas: 2
        - name: another-module
          version: "^0.1.0"
          required: true
          config:
              port: 4105
              replicas: 2

# ──────────────────────────────────────────────────
# Infrastructure
# ──────────────────────────────────────────────────

infrastructure:
    # ── Database Topology ──────────────────────────
    # 1 database per module — full microservice isolation.
    # Each module gets its own dedicated database named after the module.
    # All databases live on the same PostgreSQL cluster per tenant.

    databases:
        - name: auth_gateway
          module: auth-gateway
        - name: notification_engine
          module: notification-engine
        - name: audit_logging
          module: audit-logging
        - name: billing_invoicing
          module: billing-invoicing
        - name: resource_module
          module: resource-module
        - name: another_module
          module: another-module

    messaging:
        type: rabbitmq
        vhost: /product-name

    cache:
        type: redis
        db: 0
```

**Adapting for a new product:**

1. Create `products/<new-product>/manifest.yaml`.
2. Set `product.name` to the product's kebab-case name and `product.version` to `"2026.1"`.
3. Set `gateway.subdomain` to a short product identifier.
4. Add gateway routes for every route prefix in the service registry, organized by service.
5. Add Swagger docs routes: one `path: /docs/<short-name>` with `rewrite: /swagger` per module.
6. Add health check routes: one per service, targeting `http://<hostname>:<port>/health`.
7. List all modules under `modules`, grouped by layer. Set `required: true` for core modules.
8. List all databases under `infrastructure.databases`. Skip services with no database (e.g., API gateway).
9. Set the RabbitMQ vhost to `/<product-name>`.

**Consistency checks (manual or CI):**

| Check                                                   | How to Verify                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Every registry route appears in manifest gateway routes | Compare `serviceRegistry[*].routes` with `gateway.routes[*].path`               |
| Every registry service has a health check               | Compare `Object.keys(serviceRegistry)` with `gateway.health[*].path`            |
| Ports match between registry and manifest               | Compare `serviceRegistry[key].port` with `modules.*.config.port`                |
| Database names match registry                           | Compare `serviceRegistry[key].database` with `infrastructure.databases[*].name` |
| Upstream hostnames match registry                       | Compare `gateway.routes[*].upstream` with `serviceRegistry[key].hostname`       |
