# Repository Pattern (Data Access Layer)

## 1. Component Pattern

**Type:** Injectable Repository  
**Layer:** Data Access / Persistence  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/src/repositories/property.repository.ts`

## 2. Overview

Repositories are the exclusive gateway to the database. They encapsulate all Prisma Client calls behind a clean interface that the service layer consumes. A repository is responsible for query building, include/relation management, and returning raw Prisma entities (with typed includes). It contains **zero** business logic — no validation, no error mapping, no event publishing.

Every repository defines a `WithIncludes` type alias using `Prisma.ModelGetPayload<{ include: ... }>` to strongly type the return shape including nested relations. All read methods (`findMany`, `findById`) and write methods (`create`, `update`) use the same includes so the service always receives a consistent entity shape.

The `findMany()` method returns a `Promise<[items[], count]>` tuple (via `Promise.all`) to support pagination. It dynamically builds a `where` clause from the filter options object, only adding conditions for fields that are defined.

Soft deletion is handled at the repository level: `delete()` is an `update()` call that sets `status: "DELETED"`, `deletedAt: new Date()`, and `updatedBy: userId`.

## 3. Rules

1. **`@Injectable()` decorator.** Every repository must be decorated with `@Injectable()`.
2. **Inject `PrismaService` only.** Repositories depend on nothing except the Prisma client.
3. **No business logic.** No conditionals that encode domain rules, no error throwing (except Prisma's native errors), no event publishing.
4. **Define a `WithIncludes` type.** Use `Prisma.<Model>GetPayload<{ include: typeof includes }>` so all methods return identically typed entities.
5. **Use a shared `includes` constant.** Define the include tree once and reference it in every query to keep includes consistent.
6. **`findMany()` returns `[items[], count]`.** Always return a tuple of data and total count for pagination. Use `Promise.all([findMany, count])`.
7. **Dynamic `where` building.** Only add filter conditions for fields that are defined (not `undefined`). Use spread or conditional object construction.
8. **`delete()` is a soft delete.** Call `prisma.model.update(...)` with `status: "DELETED"`, `deletedAt`, and `updatedBy`. Never call `prisma.model.delete()`.
9. **Consistent ordering in includes.** Nested relations that are lists should always specify `orderBy` and optionally `take` to keep results deterministic.
10. **No response mapping.** Return raw Prisma entities — mapping to contract shapes is the service's responsibility.

## 4. Structure

```
modules/domain/<domain>/<module>/src/repositories/
├── resource.repository.ts         # One repository per Prisma model / aggregate root
└── sub-resource.repository.ts     # Child entity repository (if needed)
```

**Type construction pattern:**

```typescript
import { Prisma } from "@prisma/client";

// 1. Define the include tree as a const (enables Prisma type inference)
const resourceIncludes = {
    category: true,
    assessments: {
        orderBy: { assessmentYear: "desc" as const },
        take: 1,
    },
    address: true,
} satisfies Prisma.ResourceInclude;

// 2. Derive the fully-typed entity shape
type ResourceWithIncludes = Prisma.ResourceGetPayload<{
    include: typeof resourceIncludes;
}>;
```

## 5. Example Implementation

```typescript
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";

// ---------------------------------------------------------------------------
// Include tree — shared across all queries for shape consistency
// ---------------------------------------------------------------------------
const resourceIncludes = {
    category: true,
    assessments: {
        orderBy: { assessmentYear: "desc" as const },
        take: 1,
    },
    owner: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
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
    offset: number;
    limit: number;
    status?: string;
    categoryId?: string;
    search?: string;
    ownerId?: string;
}

@Injectable()
export class ResourceRepository {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Return a tuple of [items, totalCount] for paginated listing.
     * Dynamically builds the `where` clause from provided filter options.
     */
    async findMany(options: FindManyOptions): Promise<[ResourceWithIncludes[], number]> {
        const { offset, limit, status, categoryId, search, ownerId } = options;

        // Build where clause dynamically — only include defined filters
        const where: Prisma.ResourceWhereInput = {
            // Always exclude soft-deleted records unless explicitly requesting them
            ...(status ? { status } : { status: { not: "DELETED" } }),
            ...(categoryId ? { categoryId } : {}),
            ...(ownerId ? { ownerId } : {}),
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: "insensitive" } },
                          { code: { contains: search, mode: "insensitive" } },
                          { description: { contains: search, mode: "insensitive" } },
                      ],
                  }
                : {}),
        };

        const [items, count] = await Promise.all([
            this.prisma.resource.findMany({
                where,
                include: resourceIncludes,
                skip: offset,
                take: limit,
                orderBy: { createdAt: "desc" },
            }),
            this.prisma.resource.count({ where }),
        ]);

        return [items, count];
    }

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

    /**
     * Find by a unique business field (e.g., code) for conflict detection.
     */
    async findByUniqueField(code: string): Promise<ResourceWithIncludes | null> {
        return this.prisma.resource.findUnique({
            where: { code },
            include: resourceIncludes,
        });
    }

    /**
     * Create a new resource and return it with all includes.
     */
    async create(data: Prisma.ResourceCreateInput): Promise<ResourceWithIncludes> {
        return this.prisma.resource.create({
            data,
            include: resourceIncludes,
        });
    }

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

    /**
     * Soft-delete: sets status to DELETED, stamps deletedAt, and records
     * the user who performed the deletion. Never calls prisma.delete().
     */
    async delete(id: string, userId: string): Promise<ResourceWithIncludes> {
        return this.prisma.resource.update({
            where: { id },
            data: {
                status: "DELETED",
                deletedAt: new Date(),
                updatedBy: userId,
            },
            include: resourceIncludes,
        });
    }
}
```

**Key observations from the example:**

- The `resourceIncludes` const is defined once at module scope and reused by every method — this guarantees the `ResourceWithIncludes` type is always accurate.
- `findMany()` uses spread syntax for conditional `where` clauses: e.g., `...(categoryId ? { categoryId } : {})`. This avoids `undefined` keys leaking into the Prisma query.
- The default filter `{ status: { not: "DELETED" } }` ensures soft-deleted records are hidden in normal listing. Passing an explicit `status` overrides this (e.g., admin views).
- `Promise.all([findMany, count])` fires both queries concurrently — reducing total latency for paginated reads.
- `delete()` is `update()` under the hood — the row is never physically removed.
- The repository returns raw Prisma entities (`ResourceWithIncludes`); the service's `toResponse()` handles the contract mapping.
