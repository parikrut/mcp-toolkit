# Anti-Patterns — What NOT to Do

> Common mistakes found during DX alignment audits. Every anti-pattern below was found in production code and corrected.

## Controller Anti-Patterns

### ❌ Using `@Put` for updates

```typescript
// BAD — @Put replaces the entire resource
@Put(":id")
async update(@Param("id") id: string, @Body() body: UpdateDto) { ... }
```

```typescript
// GOOD — @Patch for partial updates
@Patch(":id")
async update(@Param() rawParams: unknown, @Body() rawBody: unknown, @CurrentUser("userId") userId: string) {
    const { id } = IdParamsSchema.parse(rawParams);
    const body = CreateBodySchema.partial().parse(rawBody);
    return this.service.update(id, body, userId);
}
```

### ❌ Using `@CurrentUser()` with full `RequestUser`

```typescript
// BAD — extracts entire user object, then plucks userId
async create(@Body() body: unknown, @CurrentUser() user: RequestUser) {
    return this.service.create(body, user.userId);
}
```

```typescript
// GOOD — extract just what you need
async create(@Body() rawBody: unknown, @CurrentUser("userId") userId: string) {
    const body = CreateBodySchema.parse(rawBody);
    return this.service.create(body, userId);
}
```

### ❌ Typed parameters instead of `unknown` + Zod parse

```typescript
// BAD — trusts framework to validate, no Zod parse
async getById(@Param("id") id: string) {
    return this.service.getById(id);
}
```

```typescript
// GOOD — unknown + Zod parse at the gate
async getById(@Param() rawParams: unknown) {
    const { id } = IdParamsSchema.parse(rawParams);
    return this.service.getById(id);
}
```

### ❌ `@ApiBearerAuth()` per method / missing entirely

```typescript
// BAD — repeated or missing
@Get()
@ApiBearerAuth()
async list() { ... }
```

```typescript
// GOOD — class-level, once
@ApiBearerAuth()
@Controller("resources")
export class ResourceController { ... }
```

### ❌ Missing `@ResponseSchema()` on handlers

```typescript
// BAD — no response validation
@Get(":id")
async getById(...) { ... }
```

```typescript
// GOOD — response validated against contract
@ResponseSchema(ResourceResponseSchema)
@Get(":id")
@ApiOperation({ summary: "Get by ID" })
async getById(...) { ... }
```

### ❌ Missing `@ApiOperation()` on handlers

Every handler must have `@ApiOperation({ summary: "..." })` for Swagger docs.

### ❌ Uppercase audit action verbs

```typescript
// BAD — uppercase
@AuditAction("CREATE", "Resource")

// GOOD — lowercase verb, kebab-case resource
@AuditAction("create", "benefit-plan")
```

### ❌ Using `z.coerce.date()` for query date parameters

```typescript
// BAD — produces a Date object, services expect string
const PeriodQuerySchema = z.object({
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
});
```

```typescript
// GOOD — string, services handle new Date() internally
const PeriodQuerySchema = z.object({
    periodStart: z.string(),
    periodEnd: z.string(),
});
```

---

## Service Anti-Patterns

### ❌ Using NestJS exception classes

```typescript
// BAD — @nestjs/common exception
import { NotFoundException } from "@nestjs/common";
throw new NotFoundException(`Resource ${id} not found`);
```

```typescript
// GOOD — domain error from @myorg/common
import { NotFoundError } from "@myorg/common";
throw new NotFoundError("Resource", id);
```

### ❌ Duplicating Zod parse in services

```typescript
// BAD — controller already validated
async create(body: unknown) {
    const parsed = CreateBodySchema.parse(body);  // duplicate!
    return this.repo.create(parsed);
}
```

```typescript
// GOOD — body is already validated, typed from contract
async create(body: CreateResourceBody, userId: string) {
    return this.repo.create({ ...body, createdBy: userId });
}
```

### ❌ Returning raw Prisma entities

```typescript
// BAD — leaks internal DB shape
async getById(id: string) {
    return this.repo.findById(id);
}
```

```typescript
// GOOD — map through toResponse() with Zod .parse()
async getById(id: string) {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundError("Resource", id);
    return this.toResponse(record);
}

private toResponse(record: any) {
    return ResourceResponseSchema.parse({ /* map fields */ });
}
```

### ❌ Manual `if (field !== undefined)` update chains

```typescript
// BAD — verbose, error-prone
const updateData: Record<string, unknown> = {};
if (body.name !== undefined) updateData.name = body.name;
if (body.status !== undefined) updateData.status = body.status;
if (body.planType !== undefined) updateData.type = body.planType;
```

```typescript
// GOOD — use buildUpdateData from @myorg/common
import { buildUpdateData } from "@myorg/common";

const updateData = buildUpdateData(body, {
    name: "name",
    status: "status",
    planType: "type", // contract field → DB column
});
```

### ❌ Omitting `userId` on write methods

```typescript
// BAD — no audit trail
async create(body: CreateResourceBody) {
    return this.repo.create(body);
}
```

```typescript
// GOOD — userId for createdBy/updatedBy
async create(body: CreateResourceBody, userId: string) {
    return this.repo.create({ ...body, createdBy: userId });
}
```

---

## Contract Anti-Patterns

### ❌ Using native TypeScript `enum`

```typescript
// BAD
enum Status {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
}
```

```typescript
// GOOD — Zod enum with inferred type
export const StatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export type Status = z.infer<typeof StatusSchema>;
```

### ❌ Maintaining parallel hand-written interfaces

```typescript
// BAD — duplicates the schema definition
interface CreateResourceBody {
    name: string;
    status: string;
}
```

```typescript
// GOOD — single source of truth
export type CreateResourceBody = z.infer<typeof CreateResourceBodySchema>;
```

---

## Summary Checklist

Before merging any PR, verify:

- [ ] No `@Put` — only `@Patch` for updates
- [ ] No `NotFoundException` — only `NotFoundError` from `@myorg/common`
- [ ] No `@CurrentUser() user: RequestUser` — use `@CurrentUser("userId") userId: string`
- [ ] No Zod parse in services — controller validates input
- [ ] No raw Prisma returns — `toResponse()` with schema `.parse()`
- [ ] No `z.coerce.date()` in query schemas — use `z.string()`
- [ ] `@ResponseSchema()` on every handler
- [ ] `@ApiOperation()` on every handler
- [ ] `userId` flows through all write paths
