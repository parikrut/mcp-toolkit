# Database Seed Script

## 1. Component Pattern

**Type:** Database Seed Script  
**Layer:** Data / DevOps  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/prisma/seed.ts`

## 2. Overview

Every module that owns a database includes a seed script at `prisma/seed.ts` that populates the database with realistic test data. The seed script is the developer's first experience with the module's data model — it demonstrates every entity, every relationship, and every enum value in a working context.

The seed script uses `PrismaClient` directly (not the NestJS `PrismaService`) because it runs as a standalone CLI script outside the NestJS application lifecycle. The client is imported from the module's local generated directory (`../../generated/prisma` or `../generated/prisma`).

All seed records use deterministic UUIDs with a recognizable pattern (e.g., `a0000001-0001-4000-8000-000000000001`) so they are easily identifiable in the database and consistent across repeated seed runs. The `createdBy` and `updatedBy` audit fields are set to a `SYSTEM_USER_ID` constant — a well-known UUID that represents automated system operations.

Idempotency is achieved through `upsert` operations (not `create`). This means the seed script can be run multiple times safely without duplicating data. The `where` clause of each `upsert` targets a unique business key (e.g., `rollNumber`, `code`, or a compound unique constraint), the `update` block is empty `{}` (no-op if the record exists), and the `create` block contains the full record.

The script wraps all operations in a `$transaction` for atomicity and disconnects from the database in a `finally` block to ensure the connection is always closed, even on failure.

## 3. Rules

1. **File location: `prisma/seed.ts`.** The seed script lives in the `prisma/` directory alongside `schema.prisma`. This is the Prisma convention and where `npx prisma db seed` expects it.
2. **Uses PrismaClient directly.** Import `PrismaClient` from the module's generated client (`../../generated/prisma` or `../generated/prisma`). Do NOT import `PrismaService` — the seed script runs outside NestJS.
3. **Deterministic UUIDs.** All seed IDs follow a recognizable pattern: `"a0000001-0001-4000-8000-00000000000N"` where the prefix letter identifies the entity type (`a` = entity A, `b` = entity B, etc.) and the last digits are sequential. This makes seed records instantly identifiable in queries and logs.
4. **SYSTEM_USER_ID for audit fields.** All `createdBy` and `updatedBy` fields must use the `SYSTEM_USER_ID` constant (imported from `../src/constants` or defined locally). This is a well-known UUID representing automated system actions.
5. **Idempotent via `upsert`.** All write operations must use `prisma.model.upsert()` with a unique `where` clause, empty `update: {}`, and the full record in `create`. This makes the script safe to run multiple times.
6. **Wrap in `$transaction`.** All seed operations should be wrapped in `prisma.$transaction(async (tx) => { ... })` for atomicity. If any seed operation fails, the entire batch is rolled back.
7. **Realistic test data.** Seed data should represent realistic scenarios: varying statuses, different enum values, edge cases (e.g., exempt properties, expired agreements, zero-value records). Use 5–20 records per entity type.
8. **Money values as BigInt literals.** Use BigInt literals (e.g., `35_000_000n` for $350,000 in cents) with underscore separators for readability. Add inline comments showing the dollar amount.
9. **Run via `npx prisma db seed`.** Configure the seed command in the module's `package.json` under the `prisma` key. Use `tsx` to run the TypeScript seed file directly.
10. **Disconnect in `finally` block.** Always call `prisma.$disconnect()` in a `finally` block after the seed operations complete (or fail) to ensure the database connection is closed.
11. **Seed order follows relations.** Insert parent entities before children. In a transaction, seed entities in dependency order: independent entities first, then entities with foreign keys.
12. **Log progress.** Use `console.log()` to print progress messages (e.g., `"Seeding resources..."`, `"Seeding assignments..."`) so the developer can track which step is running.

## 4. Structure

```
modules/domain/<domain>/<module>/
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── seed.ts                 # ← This pattern (seed script)
├── generated/
│   └── prisma/                 # Generated client (used by seed)
├── src/
│   └── constants.ts            # SYSTEM_USER_ID constant
└── package.json                # Contains "prisma": { "seed": "tsx prisma/seed.ts" }
```

**package.json seed configuration:**

```json
{
    "name": "@civic/resource-management",
    "prisma": {
        "seed": "tsx prisma/seed.ts"
    }
}
```

**Seed script layout:**

```
1. Imports (PrismaClient, SYSTEM_USER_ID)
2. PrismaClient instantiation
3. Deterministic UUID constants (grouped by entity)
4. Seed data arrays (grouped by entity, with inline comments)
5. main() function
   a. console.log("Seeding <module>...")
   b. prisma.$transaction(async (tx) => { ... })
      i.   Parent entities (upsert loop)
      ii.  Child entities (upsert loop)
      iii. Junction / audit entities
   c. console.log("Seeding complete.")
6. main().catch(...).finally(() => prisma.$disconnect())
```

## 5. Example Implementation

```typescript
/**
 * Resource Management — Prisma Seed Data
 *
 * Seeds 8 categories, 15 resources, 10 assignments, and 20 tags.
 *
 * Idempotent via upsert. Run: npx prisma db seed
 */
import { PrismaClient } from "../../generated/prisma";

const prisma = new PrismaClient();

// Well-known system user ID for audit fields
const SYSTEM_USER_ID = "00000000-0000-4000-8000-000000000000";

// ─── Deterministic UUIDs ────────────────────────────────────
// Prefix letter identifies entity type for easy identification:
//   a = Category, b = Resource, c = Assignment, d = Tag

const CATEGORY_IDS = [
    "a0000001-0001-4000-8000-000000000001",
    "a0000001-0001-4000-8000-000000000002",
    "a0000001-0001-4000-8000-000000000003",
    "a0000001-0001-4000-8000-000000000004",
    "a0000001-0001-4000-8000-000000000005",
    "a0000001-0001-4000-8000-000000000006",
    "a0000001-0001-4000-8000-000000000007",
    "a0000001-0001-4000-8000-000000000008",
];

const RESOURCE_IDS = [
    "b0000001-0001-4000-8000-000000000001",
    "b0000001-0001-4000-8000-000000000002",
    "b0000001-0001-4000-8000-000000000003",
    "b0000001-0001-4000-8000-000000000004",
    "b0000001-0001-4000-8000-000000000005",
    "b0000001-0001-4000-8000-000000000006",
    "b0000001-0001-4000-8000-000000000007",
    "b0000001-0001-4000-8000-000000000008",
    "b0000001-0001-4000-8000-000000000009",
    "b0000001-0001-4000-8000-000000000010",
    "b0000001-0001-4000-8000-000000000011",
    "b0000001-0001-4000-8000-000000000012",
    "b0000001-0001-4000-8000-000000000013",
    "b0000001-0001-4000-8000-000000000014",
    "b0000001-0001-4000-8000-000000000015",
];

const ASSIGNMENT_IDS = [
    "c0000001-0001-4000-8000-000000000001",
    "c0000001-0001-4000-8000-000000000002",
    "c0000001-0001-4000-8000-000000000003",
    "c0000001-0001-4000-8000-000000000004",
    "c0000001-0001-4000-8000-000000000005",
    "c0000001-0001-4000-8000-000000000006",
    "c0000001-0001-4000-8000-000000000007",
    "c0000001-0001-4000-8000-000000000008",
    "c0000001-0001-4000-8000-000000000009",
    "c0000001-0001-4000-8000-000000000010",
];

const ASSIGNEE_IDS = [
    "e0000001-0001-4000-8000-000000000001", // Jane Doe (Operations)
    "e0000001-0001-4000-8000-000000000002", // John Smith (Maintenance)
    "e0000001-0001-4000-8000-000000000003", // Sarah Chen (Engineering)
];

// ─── Category Data ──────────────────────────────────────────
const CATEGORIES = [
    { id: CATEGORY_IDS[0], name: "Roads & Bridges", code: "ROADS", sortOrder: 1 },
    { id: CATEGORY_IDS[1], name: "Water Infrastructure", code: "WATER", sortOrder: 2 },
    { id: CATEGORY_IDS[2], name: "Parks & Recreation", code: "PARKS", sortOrder: 3 },
    { id: CATEGORY_IDS[3], name: "Fleet Vehicles", code: "FLEET", sortOrder: 4 },
    { id: CATEGORY_IDS[4], name: "Buildings & Facilities", code: "BUILDINGS", sortOrder: 5 },
    { id: CATEGORY_IDS[5], name: "IT Equipment", code: "IT", sortOrder: 6 },
    { id: CATEGORY_IDS[6], name: "Heavy Equipment", code: "HEAVY_EQUIP", sortOrder: 7 },
    { id: CATEGORY_IDS[7], name: "Natural Areas", code: "NATURAL", sortOrder: 8 },
];

// ─── Resource Data ──────────────────────────────────────────
// Values in cents: 150_000_000n = $1,500,000
const RESOURCES = [
    {
        id: RESOURCE_IDS[0],
        categoryId: CATEGORY_IDS[0],
        name: "Main Street Bridge",
        code: "ROAD-BR-001",
        type: "INFRASTRUCTURE" as const,
        status: "ACTIVE" as const,
        priority: "HIGH" as const,
        valueCents: 250_000_000n, // $2,500,000
        lengthMetres: 45.5,
        ward: "1",
        zone: "C1",
    },
    {
        id: RESOURCE_IDS[1],
        categoryId: CATEGORY_IDS[0],
        name: "Concession Road 5 — Section A",
        code: "ROAD-RD-001",
        type: "INFRASTRUCTURE" as const,
        status: "ACTIVE" as const,
        priority: "NORMAL" as const,
        valueCents: 180_000_000n, // $1,800,000
        lengthMetres: 2400.0,
        ward: "4",
    },
    {
        id: RESOURCE_IDS[2],
        categoryId: CATEGORY_IDS[1],
        name: "Water Treatment Plant #1",
        code: "WATER-WTP-001",
        type: "INFRASTRUCTURE" as const,
        status: "ACTIVE" as const,
        priority: "CRITICAL" as const,
        valueCents: 1_500_000_000n, // $15,000,000
        ward: "2",
    },
    {
        id: RESOURCE_IDS[3],
        categoryId: CATEGORY_IDS[1],
        name: "Pump Station — Lakeview",
        code: "WATER-PS-001",
        type: "EQUIPMENT" as const,
        status: "ACTIVE" as const,
        priority: "HIGH" as const,
        valueCents: 75_000_000n, // $750,000
        ward: "3",
    },
    {
        id: RESOURCE_IDS[4],
        categoryId: CATEGORY_IDS[2],
        name: "Centennial Park",
        code: "PARK-CP-001",
        type: "PROPERTY" as const,
        status: "ACTIVE" as const,
        priority: "NORMAL" as const,
        valueCents: 350_000_000n, // $3,500,000
        areaHectares: 12.5,
        ward: "1",
    },
    {
        id: RESOURCE_IDS[5],
        categoryId: CATEGORY_IDS[3],
        name: "Plow Truck #12",
        code: "FLEET-PT-012",
        type: "VEHICLE" as const,
        status: "ACTIVE" as const,
        priority: "NORMAL" as const,
        valueCents: 28_000_000n, // $280,000
        weightKg: 12500.0,
    },
    {
        id: RESOURCE_IDS[6],
        categoryId: CATEGORY_IDS[3],
        name: "Fire Engine — Station 1",
        code: "FLEET-FE-001",
        type: "VEHICLE" as const,
        status: "ACTIVE" as const,
        priority: "CRITICAL" as const,
        valueCents: 85_000_000n, // $850,000
        weightKg: 18000.0,
    },
    {
        id: RESOURCE_IDS[7],
        categoryId: CATEGORY_IDS[4],
        name: "Town Hall",
        code: "BLDG-TH-001",
        type: "PROPERTY" as const,
        status: "ACTIVE" as const,
        priority: "HIGH" as const,
        valueCents: 800_000_000n, // $8,000,000
        areaHectares: 0.8,
        ward: "1",
        zone: "I1",
    },
    {
        id: RESOURCE_IDS[8],
        categoryId: CATEGORY_IDS[4],
        name: "Community Arena",
        code: "BLDG-CA-001",
        type: "PROPERTY" as const,
        status: "UNDER_REVIEW" as const, // Under review for renovation
        priority: "HIGH" as const,
        valueCents: 450_000_000n, // $4,500,000
        areaHectares: 2.1,
        ward: "2",
    },
    {
        id: RESOURCE_IDS[9],
        categoryId: CATEGORY_IDS[5],
        name: "Server Rack — DC1",
        code: "IT-SR-001",
        type: "DIGITAL" as const,
        status: "ACTIVE" as const,
        priority: "CRITICAL" as const,
        valueCents: 12_000_000n, // $120,000
    },
    {
        id: RESOURCE_IDS[10],
        categoryId: CATEGORY_IDS[6],
        name: "Excavator CAT 320",
        code: "HEAVY-EX-001",
        type: "EQUIPMENT" as const,
        status: "ACTIVE" as const,
        priority: "NORMAL" as const,
        valueCents: 42_000_000n, // $420,000
        weightKg: 20000.0,
    },
    {
        id: RESOURCE_IDS[11],
        categoryId: CATEGORY_IDS[7],
        name: "Lakeside Conservation Area",
        code: "NAT-LCA-001",
        type: "NATURAL" as const,
        status: "ACTIVE" as const,
        priority: "NORMAL" as const,
        valueCents: 0n, // $0 (conservation - no commercial value)
        areaHectares: 85.3,
        ward: "3",
    },
    {
        id: RESOURCE_IDS[12],
        categoryId: CATEGORY_IDS[3],
        name: "Pickup Truck #7 (Decommissioned)",
        code: "FLEET-PK-007",
        type: "VEHICLE" as const,
        status: "DECOMMISSIONED" as const, // Decommissioned vehicle
        priority: "LOW" as const,
        valueCents: 500_000n, // $5,000 (residual value)
        weightKg: 2500.0,
    },
    {
        id: RESOURCE_IDS[13],
        categoryId: CATEGORY_IDS[0],
        name: "Highway 11 Overpass",
        code: "ROAD-BR-002",
        type: "INFRASTRUCTURE" as const,
        status: "ACTIVE" as const,
        priority: "CRITICAL" as const,
        valueCents: 500_000_000n, // $5,000,000
        lengthMetres: 120.0,
        ward: "2",
    },
    {
        id: RESOURCE_IDS[14],
        categoryId: CATEGORY_IDS[2],
        name: "Dog Park — South End",
        code: "PARK-DP-001",
        type: "PROPERTY" as const,
        status: "INACTIVE" as const, // Closed for winter
        priority: "LOW" as const,
        valueCents: 15_000_000n, // $150,000
        areaHectares: 0.4,
        ward: "4",
    },
];

// ─── Seed Function ──────────────────────────────────────────

async function main() {
    console.log("Seeding resource-management...");

    await prisma.$transaction(async (tx) => {
        // ── Categories (parent entities — seed first) ───────
        console.log("  Seeding categories...");
        for (const c of CATEGORIES) {
            await tx.category.upsert({
                where: { code: c.code },
                update: {},
                create: {
                    id: c.id,
                    name: c.name,
                    code: c.code,
                    sortOrder: c.sortOrder,
                    createdBy: SYSTEM_USER_ID,
                    updatedBy: SYSTEM_USER_ID,
                },
            });
        }

        // ── Resources (depend on categories) ────────────────
        console.log("  Seeding resources...");
        for (const r of RESOURCES) {
            await tx.resource.upsert({
                where: { code: r.code },
                update: {},
                create: {
                    id: r.id,
                    categoryId: r.categoryId,
                    name: r.name,
                    code: r.code,
                    type: r.type,
                    status: r.status,
                    priority: r.priority,
                    valueCents: r.valueCents,
                    weightKg: r.weightKg,
                    lengthMetres: r.lengthMetres,
                    areaHectares: r.areaHectares,
                    ward: r.ward,
                    zone: r.zone,
                    createdBy: SYSTEM_USER_ID,
                    updatedBy: SYSTEM_USER_ID,
                },
            });
        }

        // ── Assignments (depend on resources) ───────────────
        console.log("  Seeding assignments...");
        const ASSIGNMENTS = [
            {
                id: ASSIGNMENT_IDS[0],
                resourceId: RESOURCE_IDS[0],
                assigneeId: ASSIGNEE_IDS[0],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
            {
                id: ASSIGNMENT_IDS[1],
                resourceId: RESOURCE_IDS[2],
                assigneeId: ASSIGNEE_IDS[2],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
            {
                id: ASSIGNMENT_IDS[2],
                resourceId: RESOURCE_IDS[2],
                assigneeId: ASSIGNEE_IDS[1],
                assignmentType: "SECONDARY" as const,
                effectiveDate: new Date("2025-03-15"),
            },
            {
                id: ASSIGNMENT_IDS[3],
                resourceId: RESOURCE_IDS[4],
                assigneeId: ASSIGNEE_IDS[0],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
            {
                id: ASSIGNMENT_IDS[4],
                resourceId: RESOURCE_IDS[5],
                assigneeId: ASSIGNEE_IDS[1],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-04-01"),
            },
            {
                id: ASSIGNMENT_IDS[5],
                resourceId: RESOURCE_IDS[6],
                assigneeId: ASSIGNEE_IDS[2],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
            {
                id: ASSIGNMENT_IDS[6],
                resourceId: RESOURCE_IDS[7],
                assigneeId: ASSIGNEE_IDS[0],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
            {
                id: ASSIGNMENT_IDS[7],
                resourceId: RESOURCE_IDS[9],
                assigneeId: ASSIGNEE_IDS[2],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-02-01"),
            },
            {
                id: ASSIGNMENT_IDS[8],
                resourceId: RESOURCE_IDS[10],
                assigneeId: ASSIGNEE_IDS[1],
                assignmentType: "TEMPORARY" as const,
                effectiveDate: new Date("2025-06-01"),
                endDate: new Date("2025-09-30"),
            },
            {
                id: ASSIGNMENT_IDS[9],
                resourceId: RESOURCE_IDS[13],
                assigneeId: ASSIGNEE_IDS[0],
                assignmentType: "PRIMARY" as const,
                effectiveDate: new Date("2025-01-01"),
            },
        ];

        for (const a of ASSIGNMENTS) {
            await tx.assignment.upsert({
                where: {
                    resourceId_assigneeId_assignmentType: {
                        resourceId: a.resourceId,
                        assigneeId: a.assigneeId,
                        assignmentType: a.assignmentType,
                    },
                },
                update: {},
                create: {
                    id: a.id,
                    resourceId: a.resourceId,
                    assigneeId: a.assigneeId,
                    assignmentType: a.assignmentType,
                    effectiveDate: a.effectiveDate,
                    endDate: (a as Record<string, unknown>).endDate as Date | undefined,
                    createdBy: SYSTEM_USER_ID,
                    updatedBy: SYSTEM_USER_ID,
                },
            });
        }

        // ── Tags (depend on resources) ──────────────────────
        console.log("  Seeding tags...");
        const TAGS = [
            { resourceId: RESOURCE_IDS[0], tag: "critical-infrastructure" },
            { resourceId: RESOURCE_IDS[0], tag: "annual-inspection" },
            { resourceId: RESOURCE_IDS[2], tag: "critical-infrastructure" },
            { resourceId: RESOURCE_IDS[2], tag: "regulatory-compliance" },
            { resourceId: RESOURCE_IDS[4], tag: "public-use" },
            { resourceId: RESOURCE_IDS[4], tag: "seasonal-maintenance" },
            { resourceId: RESOURCE_IDS[6], tag: "emergency-services" },
            { resourceId: RESOURCE_IDS[6], tag: "critical-infrastructure" },
            { resourceId: RESOURCE_IDS[7], tag: "heritage-building" },
            { resourceId: RESOURCE_IDS[8], tag: "renovation-2026" },
            { resourceId: RESOURCE_IDS[9], tag: "cybersecurity" },
            { resourceId: RESOURCE_IDS[11], tag: "conservation" },
            { resourceId: RESOURCE_IDS[11], tag: "public-use" },
            { resourceId: RESOURCE_IDS[13], tag: "critical-infrastructure" },
            { resourceId: RESOURCE_IDS[13], tag: "provincial-highway" },
        ];

        let tagIdx = 0;
        for (const t of TAGS) {
            const tagId = `d0000001-0001-4000-8000-${String(tagIdx + 1).padStart(12, "0")}`;
            await tx.resourceTag.upsert({
                where: {
                    resourceId_tag: {
                        resourceId: t.resourceId,
                        tag: t.tag,
                    },
                },
                update: {},
                create: {
                    id: tagId,
                    resourceId: t.resourceId,
                    tag: t.tag,
                    createdBy: SYSTEM_USER_ID,
                    updatedBy: SYSTEM_USER_ID,
                },
            });
            tagIdx++;
        }
    });

    console.log("Seeding complete.");
}

// ─── Execute ────────────────────────────────────────────────
main()
    .catch((error) => {
        console.error("Seed failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
```

**Key observations from the example:**

- `PrismaClient` is imported from the generated directory, not from `@prisma/client`. This ensures the client matches the module's schema.
- `SYSTEM_USER_ID` is a well-known UUID used for all audit fields. It represents automated operations and is defined as a constant, not generated dynamically.
- UUID patterns use letter prefixes (`a`, `b`, `c`, `d`, `e`) to identify entity types at a glance: `a` = Category, `b` = Resource, `c` = Assignment, `d` = Tag, `e` = Assignee (external user IDs).
- Every `upsert` uses a unique business key in the `where` clause (e.g., `code` for categories/resources, compound unique key for assignments/tags) ensuring idempotency.
- The `update: {}` block means "do nothing if the record already exists" — seed data is insert-only, never overwritten on re-run.
- BigInt literals use underscore separators (`35_000_000n`) with inline dollar-amount comments for readability.
- The `$transaction` ensures atomicity: if any seed operation fails, all changes are rolled back.
- `prisma.$disconnect()` in the `finally` block guarantees the database connection is closed regardless of success or failure.
- Seed order follows the relation dependency graph: Categories → Resources → Assignments → Tags.
