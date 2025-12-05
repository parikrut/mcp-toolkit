# Centralized Route Constants

> Pattern documentation for the single `Routes` object that defines all API route paths as constants, ensuring a single source of truth for path strings across contracts, controllers, frontend services, and tests.

## 1. Component Pattern

The **Centralized Route Constants** pattern is a single `Routes` constant
object in `packages/contracts/src/contracts/routes.ts` that maps logical
resource names to their API path strings. Every `defineEndpoint()` call,
every frontend API service, and every test fixture references `Routes`
instead of hardcoding path strings. This guarantees that route paths are
defined once and stay consistent across the entire stack.

## 2. Overview

| Aspect            | Detail                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| **File location** | `packages/contracts/src/contracts/routes.ts`                                            |
| **Export**        | `export const Routes = { … } as const`                                                  |
| **Path format**   | Bare controller-level prefix (e.g., `"/properties"`)                                    |
| **API prefix**    | `/api` prefix is set at the NestJS global level — not in Routes                         |
| **Naming**        | Keys are camelCase resource names; values are kebab-case plural paths                   |
| **Organization**  | Grouped by domain area with inline comments                                             |
| **Total routes**  | 45+ routes across platform, shared, and domain modules                                  |
| **Consumers**     | Entity contracts (`defineEndpoint`), frontend API services, test fixtures, Swagger docs |

## 3. Rules

1. **All routes use the bare controller-level prefix.** The `/api` global
   prefix is applied by NestJS at the application level — `Routes` values
   do NOT include it.
    ```typescript
    // ✅ Correct
    properties: "/properties";
    // ❌ Wrong — /api prefix is applied globally
    properties: "/api/v1/properties";
    ```
2. **Resource names are kebab-case plural.**
    ```typescript
    taxBills: "/tax-bills"; // ✅ kebab-case plural
    taxBill: "/tax-bill"; // ❌ singular
    tax_bills: "/tax_bills"; // ❌ snake_case
    ```
3. **No trailing slashes.**
    ```typescript
    properties: "/properties"; // ✅
    properties: "/properties/"; // ❌
    ```
4. **Sub-resources use nesting with path parameters.**
    ```typescript
    // Sub-resource pattern:
    // GET /properties/:id/assessments
    path: `${Routes.properties}/:id/assessments`;
    ```
5. **Single source of truth — never hardcode routes elsewhere.** Every path
   reference must go through the `Routes` object.

    ```typescript
    // ✅ Correct
    path: Routes.properties;
    path: `${Routes.taxBills}/:id`;

    // ❌ Wrong — hardcoded strings
    path: "/properties";
    path: "/tax-bills/:id";
    ```

6. **Keys are camelCase and match the domain noun.** They should be readable
   and match the entity contract's naming conventions.
7. **New routes must be added to the `Routes` object** before they can be
   used in `defineEndpoint()` calls.
8. **The object is `as const`** to enable literal type inference on path
   strings.
9. **Group routes by domain area** using inline comments for readability.
10. **Routes are exported from the contracts barrel** and available via
    `import { Routes } from "@myorg/contracts"`.

## 4. Structure

```
packages/contracts/src/contracts/routes.ts
└── export const Routes = {
        // Platform modules
        auth: "/auth",
        users: "/users",
        notifications: "/notifications",
        …

        // Shared modules
        invoices: "/invoices",

        // Domain – Revenue
        properties: "/properties",
        owners: "/owners",
        assessments: "/assessments",
        taxBills: "/tax-bills",
        taxRates: "/tax-rates",
        payments: "/payments",
        …

        // Citizen portal
        citizenPortal: "/citizen-portal",
    } as const
```

**How routes flow through the system:**

```
routes.ts (single source of truth)
    │
    ├── entity.contract.ts
    │   └── defineEndpoint({ path: Routes.properties, … })
    │
    ├── NestJS controller
    │   └── @Controller(Routes.properties)
    │
    ├── Frontend API service
    │   └── api.get(Routes.properties, { params })
    │
    └── Test fixtures
        └── request(app).get(Routes.properties).expect(200)
```

## 5. Example Implementation

### routes.ts — Full Source

```typescript
// packages/contracts/src/contracts/routes.ts

// ─── Centralized Route Constants ────────────────────────────
// All module route prefixes in one place for consistency.
// The /api prefix is set at the NestJS global level — these are
// the bare controller-level prefixes.

export const Routes = {
    // Platform modules
    auth: "/auth",
    users: "/users",
    notifications: "/notifications",
    notificationTemplates: "/templates",
    notificationDeliveries: "/notifications/deliveries",
    notificationConsent: "/consent",
    payments: "/payments",
    auditLogs: "/audit-logs",

    // Shared modules
    invoices: "/invoices",

    // Domain – Revenue
    config: "/config",
    taxBills: "/tax-bills",
    penalties: "/penalties",
    properties: "/properties",
    owners: "/owners",
    appeals: "/appeals",
    assessments: "/assessments",
    taxRates: "/tax-rates",
    levy: "/levy",
    levyCalculations: "/levy-calculations",
    specialAreas: "/special-areas",
    arrears: "/arrears",
    paymentPlans: "/payment-plans",
    pap: "/pap",
    remittance: "/remittance",
    refunds: "/refunds",
    taxCertificates: "/certificate-service",
    propertyInquiry: "/property-inquiry",
    taxSales: "/auction-services",
    tenders: "/tenders",
    vestingOrders: "/vesting-orders",
    encumbrances: "/encumbrances",
    taxSaleFinancials: "/financials",
    reports: "/reports",
    bills: "/bills",
    eBilling: "/e-billing",
    exemptions: "/exemptions",
    pils: "/pils",
    schoolSupport: "/school-support",
    phaseIn: "/phase-in",
    levyReports: "/levy-reports",
    paymentReports: "/payment-reports",
    accountStatements: "/account-statements",

    // Citizen portal
    citizenPortal: "/citizen-portal",
} as const;
```

### Usage in Entity Contracts

```typescript
// packages/contracts/src/contracts/revenue/property.contract.ts
import { Routes } from "../routes";
import { defineEndpoint } from "../base.types";

export const PropertyContract = {
    listProperties: defineEndpoint({
        method: "GET",
        path: Routes.properties, // → "/properties"
        query: PropertyQuerySchema,
        response: PropertyListResponseSchema,
        summary: "List properties with pagination and filters",
        tags: ["revenue", "order-management"],
    }),
    getProperty: defineEndpoint({
        method: "GET",
        path: `${Routes.properties}/:id`, // → "/properties/:id"
        params: PropertyIdParamsSchema,
        response: PropertyResponseSchema,
        summary: "Get property by ID",
        tags: ["revenue", "order-management"],
    }),
} as const;
```

### Sub-resource Routes

For sub-resources, compose paths using template literals and the parent route:

```typescript
// Assessments as a sub-resource of properties
export const AssessmentContract = {
    listByProperty: defineEndpoint({
        method: "GET",
        path: `${Routes.properties}/:id/assessments`, // → "/properties/:id/assessments"
        params: PropertyIdParamsSchema,
        query: AssessmentQuerySchema,
        response: AssessmentListResponseSchema,
        summary: "List assessments for a property",
        tags: ["revenue", "order-management"],
    }),
    // Also available as a top-level collection:
    listAssessments: defineEndpoint({
        method: "GET",
        path: Routes.assessments, // → "/assessments"
        query: AssessmentQuerySchema,
        response: AssessmentListResponseSchema,
        summary: "List all assessments",
        tags: ["revenue", "order-management"],
    }),
} as const;
```

### Frontend Usage

```typescript
// apps/my-app-web/src/services/property.api.ts
import { Routes } from "@myorg/contracts";

export const propertyApi = {
    list: (query: PropertyQuery) =>
        api.get<PropertyListResponse>(Routes.properties, { params: query }),

    getById: (id: string) => api.get<PropertyResponse>(`${Routes.properties}/${id}`),

    create: (body: CreatePropertyBody) => api.post<PropertyResponse>(Routes.properties, body),
};
```

### Test Fixture Usage

```typescript
// Integration test
import { Routes } from "@myorg/contracts";

describe("PropertyController", () => {
    it("should list properties", async () => {
        const res = await request(app.getHttpServer())
            .get(Routes.properties)
            .query({ page: 1, limit: 10 })
            .expect(200);

        expect(res.body.items).toHaveLength(10);
        expect(res.body.pagination.page).toBe(1);
    });

    it("should get property by ID", async () => {
        const res = await request(app.getHttpServer())
            .get(`${Routes.properties}/${testPropertyId}`)
            .expect(200);

        expect(res.body.id).toBe(testPropertyId);
    });
});
```

### Adding a New Route

When adding a new domain entity, follow this checklist:

1. **Add the route to `Routes`:**

    ```typescript
    export const Routes = {
        // ... existing routes
        newResource: "/new-resources", // kebab-case plural, no trailing slash
    } as const;
    ```

2. **Use it in the entity contract:**

    ```typescript
    export const NewResourceContract = {
        listNewResources: defineEndpoint({
            method: "GET",
            path: Routes.newResource,
            // ...
        }),
    } as const;
    ```

3. **The route automatically flows to:** frontend API services, Swagger docs,
   and test fixtures — no other files need path string updates.
