# Infrastructure Patterns

> Canonical reference for Docker, deployment, and infrastructure-as-code
> patterns in the Civic Modules platform.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

Infrastructure is code-generated from a typed service registry. A single
TypeScript file defines every service's port, database, routes, and
dependencies. A generator script produces nginx configs, SQL init scripts,
and dev startup scripts. Each module ships as a multi-stage Docker image
with Prisma schema sync at startup. Products compose modules via a YAML
manifest that drives the deployment pipeline.

```
┌───────────────────────────────────────────────────────┐
│  products/property-tax/infra/                         │
│                                                       │
│  service-registry.ts  ◀── Single source of truth      │
│       │                                               │
│       ├──▶ generate.ts                                │
│       │      │                                        │
│       │      ├──▶ nginx.conf      (reverse proxy)     │
│       │      ├──▶ init-databases.sql  (DB creation)   │
│       │      └──▶ start-dev.sh    (dev startup)       │
│       │                                               │
│       └──▶ manifest.yaml  (deployment composition)    │
│                                                       │
│  docker-compose.yml                                   │
│   ├── postgres:16  ├── rabbitmq:3.13  ├── redis:7     │
│   ├── auth-gateway  ├── notification-engine           │
│   ├── billing-invoicing  ├── assessment-roll          │
│   ├── tax-billing  ├── tax-levy-rate                  │
│   ├── payment-processing  ├── tax-certificates        │
│   ├── tax-sale-proceedings  ├── property-tax-web      │
│   └── prisma-studio                                   │
└───────────────────────────────────────────────────────┘

Each module:
┌──────────────────────────────────────┐
│  Dockerfile (multi-stage)            │
│  ┌────────────────────────────────┐  │
│  │  Stage 1: builder              │  │
│  │  pnpm install → generate       │  │
│  │  → build → deploy --prod       │  │
│  ├────────────────────────────────┤  │
│  │  Stage 2: production           │  │
│  │  node:20-alpine, USER node     │  │
│  │  HEALTHCHECK /health           │  │
│  │  CMD docker-entrypoint.sh      │  │
│  └────────────────────────────────┘  │
│                                      │
│  docker-entrypoint.sh                │
│  prisma db push → node dist/main.js │
└──────────────────────────────────────┘
```

## Pattern Documents

| #   | Pattern                                      | Description                                          |
| --- | -------------------------------------------- | ---------------------------------------------------- |
| 1   | [dockerfile.md](dockerfile.md)               | Multi-stage Docker build with pnpm + Prisma          |
| 2   | [docker-entrypoint.md](docker-entrypoint.md) | Entrypoint script — schema sync then exec node       |
| 3   | [docker-compose.md](docker-compose.md)       | Development stack — infra, services, networks        |
| 4   | [service-registry.md](service-registry.md)   | Typed service registry — ports, routes, dependencies |
| 5   | [infra-generator.md](infra-generator.md)     | Code generator — nginx, SQL, dev script              |
| 6   | [product-manifest.md](product-manifest.md)   | Product YAML manifest for deployment pipeline        |
