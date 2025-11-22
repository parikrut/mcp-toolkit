# Database Repository Layer

## 1. Component Pattern

**Type:** Injectable Repository (Database Interaction)  
**Layer:** Data Access / Persistence  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/src/repositories/property.repository.ts`

## 2. Overview

Repositories are the exclusive gateway between the service layer and the database. They encapsulate all Prisma Client queries behind a clean, domain-oriented interface. This pattern focuses on the **database interaction specifics** — how to construct Prisma queries, build dynamic filters, handle pagination, type-safe includes, and implement soft deletes.

Every repository injects the module's `PrismaService` and exposes methods like `findMany`, `findById`, `create`, `update`, and `delete`. The `findMany` method is the most complex — it dynamically constructs a `Prisma.ModelWhereInput` from optional filter parameters, runs a parallel `Promise.all` for the data query and count query, and returns a `[items[], totalCount]` tuple for pagination.

All queries that return entities use a shared `includes` constant (defined once at the top of the file) to ensure every method returns the same shape. The TypeScript type for this shape is extracted using `Prisma.ModelGetPayload<{ include: typeof includes }>`, providing full type safety for nested relations without manual interface definitions.

Soft deletion is enforced at the repository layer: `delete()` calls `prisma.model.update()` to set `deletedAt` and update the status, never `prisma.model.delete()`. All `findMany` queries automatically exclude soft-deleted records by including `deletedAt: null` in the `where` clause.

## 3. Rules

1. **Dynamic `where` clause building.** Build the `Prisma.ModelWhereInput` object conditionally — only add filter conditions for parameters that are defined (not `undefined`). Use object spread or conditional properties.
2. **Always exclude soft-deleted records.** Every `findMany` query must include `deletedAt: null` in its `where` clause. This is the default filter and should be the first property in the where object.
3. **`Promise.all` for parallel count + data.** `findMany()` always runs `prisma.model.findMany()` and `prisma.model.count()` in parallel using `Promise.all` to avoid sequential database round-trips.
4. **Return `[items[], totalCount]` tuple.** `findMany()` returns a `Promise<[ModelWithIncludes[], number]>` — a tuple of the data array and the total count. The service layer converts this into a paginated response.
5. **Shared includes constant.** Define the include tree as a `const` at module scope with `satisfies Prisma.ModelInclude`. Reference this constant in every query method that returns entities.
6. **Type extraction via `GetPayload`.** Derive the entity type using `Prisma.ModelGetPayload<{ include: typeof includes }>`. Never manually define interfaces that mirror Prisma's generated types.
7. **Consistent ordering in nested includes.** Nested relations that are arrays must always specify `orderBy` for deterministic ordering. Use `take: 1` when only the latest/most recent record is needed (e.g., latest assessment).
8. **Search with case-insensitive contains.** Text search filters use `{ contains: search, mode: "insensitive" }` inside an `OR` array to search across multiple fields simultaneously.
9. **Soft delete is an update.** The `delete()` method calls `prisma.model.update()` with `{ status: "DELETED", deletedAt: new Date(), updatedBy: userId }`. Never call `prisma.model.delete()`.
10. **No business logic in repositories.** Repositories never throw domain exceptions, validate business rules, or emit events. They are pure data access — read, write, return.
11. **Pagination via `skip` and `take`.** Use `skip` (calculated from page/offset) and `take` (limit) for paginated queries. The `calculateOffset(page, limit)` helper computes `(page - 1) * limit`.
12. **Dynamic sorting.** Accept `sortBy` and `sortOrder` parameters and pass them as `orderBy: { [sortBy]: sortOrder }` to support client-configurable sorting.
13. **`findById` returns `null`.** The `findById()` method uses `findUnique()` and returns `null` if the record is not found. The service layer decides whether to throw a `NotFoundException`.
14. **`create` and `update` return the entity.** Write methods return the full entity with includes so the service can return it in the response without a second query.
15. **Filter options as an interface.** Define a `FindManyOptions` interface for the filter parameters. This keeps the method signature clean and documents the available filters.

## 4. Structure

```
modules/domain/<domain>/<module>/src/repositories/
├── resource.repository.ts         # One repository per Prisma model / aggregate root
└── sub-resource.repository.ts     # Child entity repository (if needed)
```

**Repository file layout:**

```
1. Imports (Prisma types, PrismaService, helpers)
2. Includes constant (shared across all queries)
3. Type alias (Prisma.ModelGetPayload with includes)
4. FindManyOptions interface
5. @Injectable() class
   a. constructor(private readonly prisma: PrismaService)
   b. findMany(options): Promise<[Model[], number]>
   c. findById(id): Promise<Model | null>
   d. findByUniqueField(field): Promise<Model | null>
   e. create(data): Promise<Model>
   f. update(id, data): Promise<Model>
   g. delete(id, userId): Promise<Model>
```

**Type construction pattern:**

```typescript
import { Prisma } from "../../generated/prisma";

// 1. Define the include tree as a const (enables Prisma type inference)
const resourceIncludes = {
    category: true,
    assignments: {
        where: { deletedAt: null },
        orderBy: { effectiveDate: "desc" as const },
    },
    tags: {
        orderBy: { tag: "asc" as const },
    },
} satisfies Prisma.ResourceInclude;

// 2. Derive the fully-typed entity shape
type ResourceWithIncludes = Prisma.ResourceGetPayload<{
    include: typeof resourceIncludes;
}>;
```

## 5. Example Implementation

```typescript
import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma";
import { PrismaService } from "../prisma.service";

// ---------------------------------------------------------------------------
// Include tree — shared across all queries for shape consistency
// ---------------------------------------------------------------------------
const resourceIncludes = {
    category: true,
    assignments: {
        where: { deletedAt: null, status: "ACTIVE" },
        orderBy: { effectiveDate: "desc" as const },
        take: 5,
        select: {
            id: true,
            assigneeId: true,
            assignmentType: true,
            effectiveDate: true,
            endDate: true,
            allocationPct: true,
            status: true,
        },
    },
    tags: {
        where: { deletedAt: null },
        orderBy: { tag: "asc" as const },
        select: {
            id: true,
            tag: true,
        },
    },
    parent: {
        select: {
            id: true,
            name: true,
            code: true,
        },
    },
} satisfies Prisma.ResourceInclude;

// Fully-typed entity shape including nested relations
type ResourceWithIncludes = Prisma.ResourceGetPayload<{
    include: typeof resourceIncludes;
}>;

// ---------------------------------------------------------------------------
// Filter options accepted by findMany
// ---------------------------------------------------------------------------
interface FindManyOptions {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: "asc" | "desc";
    search?: string;
    status?: string;
    type?: string;
    categoryId?: string;
    ward?: string;
    parentId?: string;
}

/**
 * Calculate offset from 1-based page number and page size.
 */
function calculateOffset(page: number, limit: number): number {
    return (page - 1) * limit;
}

@Injectable()
export class ResourceRepository {
    constructor(private readonly prisma: PrismaService) {}

    // ── List with pagination and dynamic filters ──────────────
    /**
     * Return a tuple of [items, totalCount] for paginated listing.
     * Dynamically builds the `where` clause from provided filter options.
     */
    async findMany(options: FindManyOptions): Promise<[ResourceWithIncludes[], number]> {
        const where: Prisma.ResourceWhereInput = {
            // Always exclude soft-deleted records
            deletedAt: null,
        };

        // ── Text search across multiple fields ──────────────
        if (options.search) {
            where.OR = [
                { name: { contains: options.search, mode: "insensitive" } },
                { code: { contains: options.search, mode: "insensitive" } },
                { description: { contains: options.search, mode: "insensitive" } },
                { legalReference: { contains: options.search, mode: "insensitive" } },
            ];
        }

        // ── Enum / exact-match filters ──────────────────────
        if (options.status) {
            where.status = options.status as Prisma.EnumResourceStatusFilter;
        }

        if (options.type) {
            where.type = options.type as Prisma.EnumResourceTypeFilter;
        }

        // ── Foreign key filters ─────────────────────────────
        if (options.categoryId) {
            where.categoryId = options.categoryId;
        }

        if (options.ward) {
            where.ward = options.ward;
        }

        if (options.parentId) {
            where.parentId = options.parentId;
        }

        // ── Parallel data + count fetch ─────────────────────
        const [items, count] = await Promise.all([
            this.prisma.resource.findMany({
                where,
                include: resourceIncludes,
                orderBy: { [options.sortBy]: options.sortOrder },
                skip: calculateOffset(options.page, options.limit),
                take: options.limit,
            }),
            this.prisma.resource.count({ where }),
        ]);

        return [items, count];
    }

    // ── Find by ID ────────────────────────────────────────────
    /**
     * Find a single resource by ID with all includes.
     * Returns null if not found — the service layer decides whether to throw.
     */
    async findById(id: string): Promise<ResourceWithIncludes | null> {
        return this.prisma.resource.findUnique({
            where: { id },
            include: resourceIncludes,
        });
    }

    // ── Find by unique business field ─────────────────────────
    /**
     * Find by a unique business field (e.g., code) for conflict detection.
     */
    async findByCode(code: string): Promise<ResourceWithIncludes | null> {
        return this.prisma.resource.findUnique({
            where: { code },
            include: resourceIncludes,
        });
    }

    // ── Create ────────────────────────────────────────────────
    /**
     * Create a new resource and return it with all includes.
     */
    async create(data: Prisma.ResourceCreateInput): Promise<ResourceWithIncludes> {
        return this.prisma.resource.create({
            data,
            include: resourceIncludes,
        });
    }

    // ── Update ────────────────────────────────────────────────
    /**
     * Update an existing resource. The service is responsible for building
     * the partial payload — the repository forwards it verbatim.
     */
    async update(id: string, data: Prisma.ResourceUpdateInput): Promise<ResourceWithIncludes> {
        return this.prisma.resource.update({
            where: { id },
            data,
            include: resourceIncludes,
        });
    }

    // ── Soft Delete ───────────────────────────────────────────
    /**
     * Soft-delete: sets status to DELETED, stamps deletedAt, and records
     * the user who performed the deletion. Never calls prisma.delete().
     */
    async delete(id: string, userId: string): Promise<ResourceWithIncludes> {
        return this.prisma.resource.update({
            where: { id },
            data: {
                status: "DECOMMISSIONED",
                deletedAt: new Date(),
                updatedBy: userId,
            },
            include: resourceIncludes,
        });
    }

    // ── Batch operations ──────────────────────────────────────
    /**
     * Find multiple resources by IDs (e.g., for bulk operations).
     * Still excludes soft-deleted records.
     */
    async findManyByIds(ids: string[]): Promise<ResourceWithIncludes[]> {
        return this.prisma.resource.findMany({
            where: {
                id: { in: ids },
                deletedAt: null,
            },
            include: resourceIncludes,
            orderBy: { name: "asc" },
        });
    }

    // ── Existence check ───────────────────────────────────────
    /**
     * Check if a resource exists by ID (lightweight — no includes).
     */
    async exists(id: string): Promise<boolean> {
        const count = await this.prisma.resource.count({
            where: { id, deletedAt: null },
        });
        return count > 0;
    }
}
```

**Key observations from the example:**

- `deletedAt: null` is always the first condition in the `where` clause — it acts as a global filter that excludes soft-deleted records from every read query.
- The `where` object is built incrementally: each optional filter adds a property only if the filter value is defined. This produces clean SQL with only the necessary `WHERE` conditions.
- `Promise.all` runs `findMany` and `count` in parallel — this halves the response time compared to sequential queries for paginated endpoints.
- `resourceIncludes` is defined once and used in every method (`findMany`, `findById`, `create`, `update`, `delete`). This guarantees all methods return the exact same shape and the `ResourceWithIncludes` type is always accurate.
- The `delete()` method calls `update()`, not `delete()`. It sets `deletedAt` to the current timestamp and changes the status. The record remains in the database for audit purposes.
- Nested includes use `where`, `orderBy`, `take`, and `select` to keep the response lean: assignments are limited to the 5 most recent active ones, tags are sorted alphabetically, and the parent resource only includes `id`, `name`, and `code`.
- The repository has **zero** business logic. It does not validate that a resource exists before updating, does not check permissions, and does not emit events. Those responsibilities belong to the service layer.
