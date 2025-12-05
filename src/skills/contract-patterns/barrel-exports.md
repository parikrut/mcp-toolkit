# Contract Package Barrel Exports

> Pattern documentation for the barrel export structure of the `@myorg/contracts` package — the layered re-export chain from leaf modules up to a single top-level `index.ts` that consumers import from.

## 1. Component Pattern

The **Barrel Export** pattern uses a chain of `index.ts` files that re-export
every schema, type, constant, and helper from the `@myorg/contracts` package.
The top-level barrel at `src/index.ts` is the **only** import path consumers
should ever use. Internal directory barrels (`common/index.ts`,
`contracts/index.ts`, `events/index.ts`) aggregate their children so the
top-level barrel stays clean with just three re-export lines.

## 2. Overview

| Layer              | File                                                                  | Re-exports                                                                                |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Top-level**      | `src/index.ts`                                                        | `common/`, `contracts/`, `events/`                                                        |
| **Common**         | `src/common/index.ts`                                                 | `base`, `money`, `pagination`, `address`, `audit`                                         |
| **Contracts**      | `src/contracts/index.ts`                                              | `base.types`, `routes`, + all domain contracts (`revenue/`, `platform/`, `shared/`, etc.) |
| **Events**         | `src/events/index.ts`                                                 | `revenue/`, `platform/`, `shared/`                                                        |
| **Domain barrels** | `src/contracts/revenue/index.ts`, `src/events/revenue/index.ts`, etc. | Individual `.contract.ts` and `.events.ts` files                                          |

Consumer import pattern:

```typescript
// ✅ Correct — always import from the package root
import {
    PropertyContract,
    PropertyQuerySchema,
    MoneySchema,
    Routes,
    OrderManagementEvents,
    PaginatedResponseSchema,
} from "@myorg/contracts";
```

```typescript
// ❌ FORBIDDEN — never import from deep paths
import { MoneySchema } from "@myorg/contracts/src/common/money";
import { Routes } from "@myorg/contracts/src/contracts/routes";
```

## 3. Rules

1. **Every directory has an `index.ts` barrel.** No exceptions. If you create
   a new directory, create its barrel immediately.

2. **Top-level barrel is the only import consumers use.**

    ```typescript
    import { X } from "@myorg/contracts";
    ```

    This applies to frontend apps, backend modules, and test files equally.

3. **Never import from deep paths.** The following are **forbidden**:

    ```typescript
    "@myorg/contracts/src/common/money";
    "@myorg/contracts/src/contracts/revenue/property.contract";
    "@myorg/contracts/src/events/revenue/order-management.events";
    ```

    The `package.json` `exports` field enforces this at the package level.

4. **New contract files must be added to the appropriate barrel.** When you
   create `my-entity.contract.ts`, you must also add
   `export * from "./my-entity.contract"` to the domain barrel file.

5. **New event files must be added to the appropriate barrel.** Same rule
   as contracts — add to the domain `events/<domain>/index.ts`.

6. **Barrel files use `export * from "…"` exclusively.** No logic, no
   re-mapping, no conditional exports. Pure re-exports only.

7. **Domain barrels aggregate leaf files.** The `revenue/index.ts` re-exports
   all revenue contract or event files. The mid-level barrel (`contracts/index.ts`)
   re-exports the domain barrel.

8. **No circular dependencies.** Contracts may import from `common/` but
   never from `events/`. Events may import from `contracts/` (for shared enum
   schemas) but never from other event domains. Common imports nothing from
   contracts or events.

9. **The barrel chain is exactly 3 levels deep:**

    ```
    src/index.ts → src/contracts/index.ts → src/contracts/revenue/index.ts → leaf files
    ```

10. **Keep barrels alphabetically ordered** for maintainability.

## 4. Structure

```
packages/contracts/src/
├── index.ts                                    ← TOP-LEVEL BARREL
│   ├── export * from "./common"
│   ├── export * from "./contracts"
│   └── export * from "./events"
│
├── common/
│   └── index.ts                                ← COMMON BARREL
│       ├── export * from "./base"
│       ├── export * from "./money"
│       ├── export * from "./pagination"
│       ├── export * from "./address"
│       └── export * from "./audit"
│
├── contracts/
│   ├── index.ts                                ← CONTRACTS BARREL
│   │   ├── export * from "./auth.contract"
│   │   ├── export * from "./users.contract"
│   │   ├── export * from "./base.types"
│   │   ├── export * from "./routes"
│   │   ├── export * from "./platform"
│   │   ├── export * from "./shared"
│   │   ├── export * from "./revenue"
│   │   └── export * from "./citizen-portal.contract"
│   │
│   ├── platform/
│   │   └── index.ts                            ← PLATFORM CONTRACTS BARREL
│   │       └── export * from "./notifications.contract"
│   │
│   ├── revenue/
│   │   └── index.ts                            ← REVENUE CONTRACTS BARREL
│   │       ├── export * from "./property.contract"
│   │       ├── export * from "./tax-bills.contract"
│   │       ├── export * from "./order-management.contract"
│   │       ├── export * from "./rate-service.contract"
│   │       ├── export * from "./payment-service.contract"
│   │       ├── export * from "./certificate-service.contract"
│   │       └── export * from "./exemptions.contract"
│   │
│   └── shared/
│       └── index.ts                            ← SHARED CONTRACTS BARREL
│           └── export * from "./billing.contract"
│
└── events/
    ├── index.ts                                ← EVENTS BARREL
    │   ├── export * from "./platform"
    │   ├── export * from "./shared"
    │   └── export * from "./revenue"
    │
    ├── platform/
    │   └── index.ts
    │       └── export * from "./notification.events"
    │
    ├── revenue/
    │   └── index.ts                            ← REVENUE EVENTS BARREL
    │       ├── export * from "./order-management.events"
    │       ├── export * from "./tax-bill.events"
    │       ├── export * from "./certificate.events"
    │       ├── export * from "./rate-service.events"
    │       ├── export * from "./auction.events"
    │       └── export * from "./payment-service.events"
    │
    └── shared/
        └── index.ts
            └── export * from "./billing.events"
```

**Import dependency graph (no cycles allowed):**

```
  common/  ←── contracts/  ←── events/
    │              │               │
    │              │               │
    ▼              ▼               ▼
  (no imports)   (imports from   (imports from
                  common/)        contracts/ for
                                  shared enums)
```

## 5. Example Implementation

### Top-Level Barrel

```typescript
// packages/contracts/src/index.ts

// @myorg/contracts — Single source of truth for all API boundaries
// ─────────────────────────────────────────────────────────────────

// Common building blocks
export * from "./common";

// API contracts per module
export * from "./contracts";

// Event schemas (async contracts)
export * from "./events";
```

### Common Barrel

```typescript
// packages/contracts/src/common/index.ts
export * from "./base";
export * from "./money";
export * from "./pagination";
export * from "./address";
export * from "./audit";
```

### Contracts Barrel

```typescript
// packages/contracts/src/contracts/index.ts
export * from "./auth.contract";
export * from "./users.contract";
export * from "./base.types";
export * from "./routes";
export * from "./platform";
export * from "./shared";
export * from "./revenue";
export * from "./citizen-portal.contract";
```

### Revenue Domain Barrel (Contracts)

```typescript
// packages/contracts/src/contracts/revenue/index.ts
export * from "./property.contract";
export * from "./tax-bills.contract";
export * from "./order-management.contract";
export * from "./rate-service.contract";
export * from "./payment-service.contract";
export * from "./certificate-service.contract";
export * from "./exemptions.contract";
```

### Events Barrel

```typescript
// packages/contracts/src/events/index.ts
export * from "./platform";
export * from "./shared";
export * from "./revenue";
```

### Revenue Domain Barrel (Events)

```typescript
// packages/contracts/src/events/revenue/index.ts
export * from "./order-management.events";
export * from "./tax-bill.events";
export * from "./certificate.events";
export * from "./rate-service.events";
export * from "./auction.events";
export * from "./payment-service.events";
```

### Adding a New Entity — Full Barrel Checklist

When adding a new entity (e.g., `fleet-vehicle`), update barrels at every level:

**Step 1: Create the contract file**

```typescript
// packages/contracts/src/contracts/fleet/fleet-vehicle.contract.ts
// ... 7-section entity contract
```

**Step 2: Create or update the domain barrel**

```typescript
// packages/contracts/src/contracts/fleet/index.ts
export * from "./fleet-vehicle.contract";
```

**Step 3: Add domain barrel to contracts barrel**

```typescript
// packages/contracts/src/contracts/index.ts
export * from "./auth.contract";
export * from "./users.contract";
export * from "./base.types";
export * from "./routes";
export * from "./platform";
export * from "./shared";
export * from "./revenue";
export * from "./fleet"; // ← NEW
export * from "./citizen-portal.contract";
```

**Step 4: Create the events file**

```typescript
// packages/contracts/src/events/fleet/fleet-vehicle.events.ts
// ... event constants + payload schemas
```

**Step 5: Create or update the events domain barrel**

```typescript
// packages/contracts/src/events/fleet/index.ts
export * from "./fleet-vehicle.events";
```

**Step 6: Add events domain barrel to events barrel**

```typescript
// packages/contracts/src/events/index.ts
export * from "./platform";
export * from "./shared";
export * from "./revenue";
export * from "./fleet"; // ← NEW
```

**Step 7: Verify — consumer import works**

```typescript
import {
    FleetVehicleContract,
    FleetVehicleQuerySchema,
    FleetVehicleEvents,
    VehicleCreatedEventSchema,
} from "@myorg/contracts";
// All four should resolve without errors.
```

### Package.json Exports Configuration

The `package.json` enforces single-entry-point imports:

```json
{
    "name": "@myorg/contracts",
    "main": "./dist/index.js",
    "module": "./dist/index.mjs",
    "types": "./dist/index.d.ts",
    "exports": {
        ".": {
            "import": "./dist/index.mjs",
            "require": "./dist/index.js",
            "types": "./dist/index.d.ts"
        }
    }
}
```

This means `import { X } from "@myorg/contracts/src/common/money"` will fail
at the package resolution level — not just by convention, but by configuration.
