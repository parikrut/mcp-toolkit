# NestJS Service Pattern (Business Logic Layer)

## 1. Component Pattern

**Type:** Injectable Service  
**Layer:** Business Logic / Application  
**Reference Implementation:** `modules/domain/revenue/assessment-roll/src/services/property.service.ts`

## 2. Overview

Services are the heart of every module — they contain all business logic, orchestration, data mapping, and validation beyond what Zod handles at the boundary. A service is injected into one or more controllers and acts as the single coordination point between the repository (data access), the event publisher (async messaging), and any external service clients.

Services **never** return raw Prisma entities. Every entity retrieved from the repository is mapped through a private `toResponse()` method that converts the Prisma model into the shape defined by the `@civic/contracts` response schema. This mapping handles type coercions (e.g., `BigInt` → `Number`, `Decimal` → `string`), nested relation flattening, and field renaming.

Pagination is standardised: `list()` calls the repository's `findMany()` (which returns a `[items[], count]` tuple), then uses `calculateOffset()` and `buildPaginationMeta()` from `@civic/common` to construct the pagination envelope.

All mutations publish domain events via the `Publisher` so downstream services (notifications, audit log, analytics) react asynchronously.

## 3. Rules

1. **`@Injectable()` decorator.** Every service class must be decorated with `@Injectable()`.
2. **Constructor injection only.** Inject dependencies via the constructor: repository, publisher, config client, etc.
3. **Never return Prisma entities.** Every public method must map results through `toResponse()` before returning.
4. **Use domain error classes.** Throw `NotFoundError`, `ConflictError`, or `ValidationError` from `@civic/common` — never raw `HttpException`.
5. **Soft deletes only.** `delete()` sets `status: "DELETED"`, `deletedAt: new Date()`, `updatedBy: userId` — never calls Prisma `delete()`.
6. **Publish events after successful mutations.** Call `publisher.publishResourceCreated()`, `publishResourceUpdated()`, or `publishResourceDeleted()` after the repository operation succeeds.
7. **Pagination via helpers.** Use `calculateOffset(page, limit)` and `buildPaginationMeta(total, page, limit)` from `@civic/common` — never compute pagination manually.
8. **Partial updates.** `update()` must only forward fields that are actually present in the parsed body — never overwrite with `undefined`.
9. **`toResponse()` is private.** It is an internal mapping concern and must not be exposed or reused outside the service.
10. **No HTTP concepts.** Services must not reference status codes, request/response objects, or decorators. They operate in a transport-agnostic domain layer.

## 4. Structure

```
modules/domain/<domain>/<module>/src/services/
├── resource.service.ts          # Primary aggregate service
├── sub-resource.service.ts      # Child resource service (if needed)
└── resource-calculation.service.ts  # Complex calc extracted to its own service
```

**Injection dependencies:**

| Dependency                                          | Source                                | Purpose                 |
| --------------------------------------------------- | ------------------------------------- | ----------------------- |
| `ResourceRepository`                                | `../repositories/resource.repository` | Data access             |
| `ResourcePublisher`                                 | `../publishers/resource.publisher`    | Domain event publishing |
| `ConfigClient`                                      | `../clients/config.client` (optional) | External service config |
| `calculateOffset`, `buildPaginationMeta`            | `@civic/common`                       | Pagination helpers      |
| `NotFoundError`, `ConflictError`, `ValidationError` | `@civic/common`                       | Domain error classes    |

## 5. Example Implementation

```typescript
import { Injectable } from "@nestjs/common";
import { calculateOffset, buildPaginationMeta, NotFoundError, ConflictError } from "@civic/common";
import type {
    ResourceQuery,
    CreateResourceBody,
    UpdateResourceBody,
    ResourceResponse,
    PaginatedResourceResponse,
} from "@civic/contracts";
import { ResourceRepository } from "../repositories/resource.repository";
import { ResourcePublisher } from "../publishers/resource.publisher";

@Injectable()
export class ResourceService {
    constructor(
        private readonly resourceRepository: ResourceRepository,
        private readonly publisher: ResourcePublisher,
    ) {}

    /**
     * List resources with pagination and optional filters.
     * Returns the paginated envelope shape expected by the contract.
     */
    async list(filters: ResourceQuery): Promise<PaginatedResourceResponse> {
        const { page = 1, limit = 20, status, search } = filters;
        const offset = calculateOffset(page, limit);

        const [items, total] = await this.resourceRepository.findMany({
            offset,
            limit,
            status,
            search,
        });

        return {
            items: items.map((item) => this.toResponse(item)),
            pagination: buildPaginationMeta(total, page, limit),
        };
    }

    /**
     * Find a single resource by ID or throw NotFoundError.
     */
    async getById(id: string): Promise<ResourceResponse> {
        const entity = await this.resourceRepository.findById(id);

        if (!entity) {
            throw new NotFoundError("Resource", id);
        }

        return this.toResponse(entity);
    }

    /**
     * Create a new resource, publish the creation event, and return the
     * contract-shaped response.
     */
    async create(data: CreateResourceBody, userId: string): Promise<ResourceResponse> {
        // Optional: check for duplicates before creation
        const existing = await this.resourceRepository.findByUniqueField(data.code);
        if (existing) {
            throw new ConflictError(`Resource with code "${data.code}" already exists`);
        }

        const entity = await this.resourceRepository.create({
            ...data,
            createdBy: userId,
            updatedBy: userId,
        });

        await this.publisher.publishResourceCreated({
            resourceId: entity.id,
            userId,
        });

        return this.toResponse(entity);
    }

    /**
     * Partially update a resource. Only fields present in the input are
     * forwarded to the repository — undefined fields are not overwritten.
     */
    async update(id: string, data: UpdateResourceBody, userId: string): Promise<ResourceResponse> {
        // Ensure the resource exists before updating
        const existing = await this.resourceRepository.findById(id);
        if (!existing) {
            throw new NotFoundError("Resource", id);
        }

        // Build a partial update payload — only include defined fields
        const updateData: Record<string, unknown> = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.status !== undefined) updateData.status = data.status;
        if (data.effectiveDate !== undefined)
            updateData.effectiveDate = new Date(data.effectiveDate);

        const entity = await this.resourceRepository.update(id, {
            ...updateData,
            updatedBy: userId,
        });

        await this.publisher.publishResourceUpdated({
            resourceId: entity.id,
            userId,
            changes: Object.keys(updateData),
        });

        return this.toResponse(entity);
    }

    /**
     * Soft-delete a resource by setting status to DELETED with a timestamp.
     */
    async delete(id: string, userId: string): Promise<void> {
        const existing = await this.resourceRepository.findById(id);
        if (!existing) {
            throw new NotFoundError("Resource", id);
        }

        await this.resourceRepository.delete(id, userId);

        await this.publisher.publishResourceDeleted({
            resourceId: id,
            userId,
        });
    }

    // ---------------------------------------------------------------------------
    // Private mapping
    // ---------------------------------------------------------------------------

    /**
     * Maps a Prisma entity (with includes) to the contract response shape.
     *
     * Key transformations:
     * - BigInt fields → Number (e.g., `Number(entity.assessedValue)`)
     * - Decimal fields → string (e.g., `entity.rate.toString()`)
     * - Nested relations → flattened or cherry-picked fields
     * - Date objects → ISO strings handled by JSON serialization
     */
    private toResponse(entity: any): ResourceResponse {
        return {
            id: entity.id,
            code: entity.code,
            name: entity.name,
            description: entity.description,
            status: entity.status,
            // BigInt → Number conversion
            totalValue: Number(entity.totalValue),
            // Nested relation mapping
            category: entity.category
                ? {
                      id: entity.category.id,
                      name: entity.category.name,
                  }
                : null,
            // Flatten latest child record (repository uses orderBy + take: 1)
            latestAssessment: entity.assessments?.[0]
                ? {
                      year: entity.assessments[0].year,
                      value: Number(entity.assessments[0].value),
                  }
                : null,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            createdBy: entity.createdBy,
            updatedBy: entity.updatedBy,
        };
    }
}
```

**Key observations from the example:**

- The `list()` method destructures filter defaults, calls the repository, maps items, and attaches pagination metadata — all in one clean flow.
- `getById()` is a guard-then-map pattern: fetch → null-check → map.
- `create()` optionally checks for uniqueness conflicts before persisting, then publishes an event.
- `update()` builds a partial payload so that only explicitly provided fields are sent to Prisma — this prevents accidentally nullifying columns.
- `delete()` is a soft delete — the repository sets `status: "DELETED"` and `deletedAt`, never removes the row.
- `toResponse()` centralises all Prisma-to-contract mapping, including `BigInt` → `Number`, `Decimal` → `string`, and nested relation extraction.
