# NestJS Service Pattern (Business Logic Layer)

## 1. Component Pattern

**Type:** Injectable Service  
**Layer:** Business Logic / Application  
**Reference Implementation:** `modules/domain/<domain>/<module>/src/services/<module>.service.ts`

## 2. Overview

Services are the heart of every module — they contain all business logic, orchestration, data mapping, and validation beyond what Zod handles at the boundary. A service is injected into one or more controllers and acts as the single coordination point between the repository (data access), the event publisher (async messaging), and any external service clients.

Services **never** return raw Prisma entities. Every entity retrieved from the repository is mapped through a private `toResponse()` method that calls the contract's Zod response schema `.parse()` to validate the outgoing shape. This ensures the response matches the contract exactly and strips any extra fields. The mapping handles type coercions (e.g., `BigInt` → `Number`, `Decimal` → `string`), nested relation flattening, and field renaming.

Pagination is standardised: `list()` calls the repository's `findMany()` (which returns a `[items[], count]` tuple), then uses `calculateOffset()` and `buildPaginationMeta()` from `@myorg/common` to construct the pagination envelope.

All mutations publish domain events via the `Publisher` so downstream services (notifications, audit log, analytics) react asynchronously.

> **DX Enhancement:** Use `buildUpdateData(body, fieldMap)` from `@myorg/common` to construct partial update payloads instead of manually building `if (field !== undefined)` chains. This generic utility maps contract field names to Prisma column names and only includes defined fields.

## 3. Rules

1. **`@Injectable()` decorator.** Every service class must be decorated with `@Injectable()`.
2. **Constructor injection only.** Inject dependencies via the constructor: repository, publisher, config client, etc.
3. **Never return Prisma entities.** Every public method must map results through `toResponse()` which uses the contract Zod schema `.parse()` before returning.
4. **Use domain error classes.** Throw `NotFoundError`, `ConflictError`, or `ValidationError` from `@myorg/common` — never raw `HttpException` or NestJS built-in exceptions (`NotFoundException`, etc.).
5. **Soft deletes only.** `delete()` sets `status: "DELETED"`, `deletedAt: new Date()`, `updatedBy: userId` — never calls Prisma `delete()`.
6. **Publish events after successful mutations.** Call `publisher.publishResourceCreated()`, `publishResourceUpdated()`, or `publishResourceDeleted()` after the repository operation succeeds.
7. **Pagination via helpers.** Use `calculateOffset(page, limit)` and `buildPaginationMeta(total, page, limit)` from `@myorg/common` — never compute pagination manually.
8. **Partial updates via `buildUpdateData()`.** Use `buildUpdateData(body, fieldMap)` from `@myorg/common` to map contract fields to Prisma columns — never build manual `if (field !== undefined)` chains.
9. **`toResponse()` is private and uses Zod `.parse()`.** It must call `ResponseSchema.parse({ ... })` to validate the shape and strip extra fields.
10. **No HTTP concepts.** Services must not reference status codes, request/response objects, or decorators. They operate in a transport-agnostic domain layer.
11. **No Zod validation of input.** The controller already validated input with Zod — the service receives typed data. Never duplicate Zod parse in services.
12. **`userId: string` required on all write methods.** Controllers extract via `@CurrentUser("userId")` and pass to service for `createdBy`/`updatedBy` audit fields.

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
| `calculateOffset`, `buildPaginationMeta`            | `@myorg/common`                       | Pagination helpers      |
| `buildUpdateData`                                   | `@myorg/common`                       | Partial update mapping  |
| `NotFoundError`, `ConflictError`, `ValidationError` | `@myorg/common`                       | Domain error classes    |

## 5. Example Implementation

```typescript
import { Injectable } from "@nestjs/common";
import {
    calculateOffset,
    buildPaginationMeta,
    buildUpdateData,
    NotFoundError,
    ConflictError,
} from "@myorg/common";
import { ResourceResponseSchema } from "@myorg/contracts";
import type {
    ResourceQuery,
    CreateResourceBody,
    ResourceResponse,
    PaginatedResourceResponse,
} from "@myorg/contracts";
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
     * Partially update a resource. Uses buildUpdateData() to map contract
     * field names to Prisma columns — only defined fields are forwarded.
     */
    async update(
        id: string,
        body: Partial<CreateResourceBody>,
        userId: string,
    ): Promise<ResourceResponse> {
        // Ensure the resource exists before updating
        const existing = await this.resourceRepository.findById(id);
        if (!existing) {
            throw new NotFoundError("Resource", id);
        }

        // Build a partial update payload using the shared utility
        const updateData = buildUpdateData(body, {
            name: "name",
            description: "description",
            status: "status",
            effectiveDate: "effectiveDate",
        });

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
     * Maps a Prisma entity (with includes) to the contract response shape
     * using the Zod schema .parse() for validation and field stripping.
     *
     * Key transformations:
     * - BigInt fields → Number (e.g., `Number(entity.assessedValue)`)
     * - Decimal fields → string (e.g., `entity.rate.toString()`)
     * - Nested relations → flattened or cherry-picked fields
     * - Date objects → ISO strings via `.toISOString()`
     */
    private toResponse(entity: any): ResourceResponse {
        return ResourceResponseSchema.parse({
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
            createdAt: entity.createdAt?.toISOString(),
            updatedAt: entity.updatedAt?.toISOString(),
            createdBy: entity.createdBy,
            updatedBy: entity.updatedBy,
        });
    }
}
```

**Key observations from the example:**

- The `list()` method destructures filter defaults, calls the repository, maps items, and attaches pagination metadata — all in one clean flow.
- `getById()` is a guard-then-map pattern: fetch → null-check → map.
- `create()` optionally checks for uniqueness conflicts before persisting, then publishes an event.
- `update()` uses `buildUpdateData()` from `@myorg/common` to map contract fields to Prisma columns — this prevents accidentally nullifying columns and eliminates manual `if (field !== undefined)` chains.
- `delete()` is a soft delete — the repository sets `status: "DELETED"` and `deletedAt`, never removes the row.
- `toResponse()` calls `ResourceResponseSchema.parse()` to validate the outgoing shape against the contract, stripping any extra fields and catching shape drift at the service boundary.
- **No Zod input validation in services** — the controller already validated with Zod. Services receive typed, validated data.
- **`userId: string` is required on all write methods** — controllers extract via `@CurrentUser("userId")` and pass directly.
