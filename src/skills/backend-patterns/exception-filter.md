# Global Exception Filter Pattern

## 1. Component Pattern

**Type:** NestJS Exception Filter  
**Layer:** Infrastructure / Error Handling  
**Reference Implementation:** `packages/common/src/exception.filter.ts`

## 2. Overview

The Global Exception Filter is a `@Catch()` filter that intercepts every unhandled exception in the application and maps it to a standardised HTTP error response. It is registered globally in `bootstrapModule()` via `app.useGlobalFilters()`, so individual controllers and services never need to catch or format errors themselves.

The filter's primary responsibilities:

1. **Classify the error** — determine whether it's a Zod validation error, a Prisma client error, a known domain error, a NestJS `HttpException`, or an unknown failure.
2. **Map to an HTTP status code** — each error class maps to a specific status (see rules below).
3. **Format the response body** — every error response follows the same shape: `{ statusCode, message, correlationId, timestamp }`.
4. **Log the error** — structured logging with correlation ID, error type, and stack trace for 5xx errors.

The filter ensures that internal implementation details (Prisma error codes, stack traces, raw Zod issues) never leak to the client. Instead, it produces human-readable messages suitable for API consumers.

## 3. Rules

### Error → HTTP Status Code Mapping

| Error Type                                   | Status Code                 | Description                                                           |
| -------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| `ZodError`                                   | `422 Unprocessable Entity`  | Request validation failed. Issues are formatted as readable messages. |
| Prisma `P2002` (unique constraint)           | `409 Conflict`              | Duplicate value on a unique field.                                    |
| Prisma `P2025` (record not found)            | `404 Not Found`             | Record referenced in update/delete does not exist.                    |
| Prisma `P2003` (foreign key constraint)      | `409 Conflict`              | Referenced parent record does not exist or child records exist.       |
| Prisma `P2014` (required relation violation) | `400 Bad Request`           | A required related record is missing.                                 |
| Prisma `P2000` (value too long)              | `400 Bad Request`           | Column value exceeds max length.                                      |
| Prisma `P2024` (connection timeout)          | `503 Service Unavailable`   | Database connection pool exhausted or timed out.                      |
| `NotFoundError` (domain)                     | `404 Not Found`             | Business logic determined the resource doesn't exist.                 |
| `ConflictError` (domain)                     | `409 Conflict`              | Business rule conflict (e.g., duplicate code).                        |
| `ValidationError` (domain)                   | `400 Bad Request`           | Domain-level validation failure.                                      |
| Fastify plugin errors                        | `400 Bad Request`           | Malformed request at the framework level.                             |
| `HttpException` (NestJS)                     | Pass-through                | Status and message from the exception itself.                         |
| Unknown / unhandled                          | `500 Internal Server Error` | Catch-all for unexpected failures.                                    |

### Response Shape

Every error response follows this exact structure:

```json
{
    "statusCode": 422,
    "message": "Validation failed: name is required; status must be ACTIVE or INACTIVE",
    "correlationId": "abc-123-def-456",
    "timestamp": "2026-02-24T12:00:00.000Z"
}
```

### Additional Rules

1. **`@Catch()` with no arguments.** The filter catches all exceptions, not a specific type.
2. **Correlation ID from request headers.** Always read `X-Correlation-ID` from the request and include it in the response.
3. **Zod issues are flattened.** Each `ZodIssue` is mapped to `"${path}: ${message}"` and joined with `"; "`.
4. **Prisma errors are detected by `error.code`.** Check for `PrismaClientKnownRequestError` and switch on the code string.
5. **5xx errors log the full stack trace.** 4xx errors log only the message (they're expected/normal).
6. **Never expose internal details.** Stack traces, SQL queries, and raw error objects must not appear in the response body.
7. **Domain errors use the message from the thrown instance.** `NotFoundError("Property", "abc-123")` → `"Property with ID abc-123 not found"`.
8. **Fastify plugin errors** (e.g., payload too large, invalid content type) are caught by checking `error.statusCode` on the raw error.

## 4. Structure

```
packages/common/src/
├── filters/
│   └── exception.filter.ts     # The global exception filter
├── errors/
│   ├── not-found.error.ts      # NotFoundError class
│   ├── conflict.error.ts       # ConflictError class
│   └── validation.error.ts     # ValidationError class
└── index.ts                    # Re-exports all errors and the filter
```

**Domain error classes:**

```typescript
// not-found.error.ts
export class NotFoundError extends Error {
    constructor(resource: string, id: string) {
        super(`${resource} with ID ${id} not found`);
        this.name = "NotFoundError";
    }
}

// conflict.error.ts
export class ConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConflictError";
    }
}

// validation.error.ts
export class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ValidationError";
    }
}
```

## 5. Example Implementation

```typescript
import { Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "../errors/not-found.error";
import { ConflictError } from "../errors/conflict.error";
import { ValidationError } from "../errors/validation.error";

interface ErrorResponse {
    statusCode: number;
    message: string;
    correlationId: string;
    timestamp: string;
}

@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const request = ctx.getRequest<FastifyRequest>();
        const reply = ctx.getResponse<FastifyReply>();

        const correlationId = (request.headers["x-correlation-id"] as string) ?? "unknown";

        const { statusCode, message } = this.mapException(exception);

        const response: ErrorResponse = {
            statusCode,
            message,
            correlationId,
            timestamp: new Date().toISOString(),
        };

        // Log: full stack for 5xx, message-only for 4xx
        if (statusCode >= 500) {
            this.logger.error(
                {
                    correlationId,
                    statusCode,
                    message,
                    stack: exception instanceof Error ? exception.stack : undefined,
                    path: request.url,
                    method: request.method,
                },
                `[${correlationId}] ${statusCode} ${message}`,
            );
        } else {
            this.logger.warn(
                {
                    correlationId,
                    statusCode,
                    message,
                    path: request.url,
                    method: request.method,
                },
                `[${correlationId}] ${statusCode} ${message}`,
            );
        }

        reply.status(statusCode).send(response);
    }

    /**
     * Maps an unknown exception to { statusCode, message }.
     * Each branch handles a specific error type with the appropriate HTTP status.
     */
    private mapException(exception: unknown): {
        statusCode: number;
        message: string;
    } {
        // -----------------------------------------------------------------------
        // 1. Zod validation errors → 422 Unprocessable Entity
        // -----------------------------------------------------------------------
        if (exception instanceof ZodError) {
            const messages = exception.issues.map((issue) => {
                const path = issue.path.join(".");
                return path ? `${path}: ${issue.message}` : issue.message;
            });
            return {
                statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
                message: `Validation failed: ${messages.join("; ")}`,
            };
        }

        // -----------------------------------------------------------------------
        // 2. Prisma known request errors → mapped by error code
        // -----------------------------------------------------------------------
        if (exception instanceof Prisma.PrismaClientKnownRequestError) {
            return this.mapPrismaError(exception);
        }

        // -----------------------------------------------------------------------
        // 3. Domain errors (custom error classes from @myorg/common)
        // -----------------------------------------------------------------------
        if (exception instanceof NotFoundError) {
            return {
                statusCode: HttpStatus.NOT_FOUND,
                message: exception.message,
            };
        }

        if (exception instanceof ConflictError) {
            return {
                statusCode: HttpStatus.CONFLICT,
                message: exception.message,
            };
        }

        if (exception instanceof ValidationError) {
            return {
                statusCode: HttpStatus.BAD_REQUEST,
                message: exception.message,
            };
        }

        // -----------------------------------------------------------------------
        // 4. NestJS HttpException → pass through status and message
        // -----------------------------------------------------------------------
        if (exception instanceof HttpException) {
            const response = exception.getResponse();
            const message =
                typeof response === "string"
                    ? response
                    : ((response as any).message ?? exception.message);
            return {
                statusCode: exception.getStatus(),
                message: Array.isArray(message) ? message.join("; ") : message,
            };
        }

        // -----------------------------------------------------------------------
        // 5. Fastify plugin errors (e.g., payload too large, bad content type)
        // -----------------------------------------------------------------------
        if (typeof exception === "object" && exception !== null && "statusCode" in exception) {
            const err = exception as { statusCode: number; message?: string };
            if (err.statusCode >= 400 && err.statusCode < 500) {
                return {
                    statusCode: err.statusCode,
                    message: err.message ?? "Bad Request",
                };
            }
        }

        // -----------------------------------------------------------------------
        // 6. Unknown / unhandled → 500 Internal Server Error
        // -----------------------------------------------------------------------
        return {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: "Internal server error",
        };
    }

    /**
     * Maps Prisma error codes to HTTP status codes with user-friendly messages.
     */
    private mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
        statusCode: number;
        message: string;
    } {
        switch (error.code) {
            // Unique constraint violation
            case "P2002": {
                const fields = (error.meta?.target as string[])?.join(", ") ?? "field";
                return {
                    statusCode: HttpStatus.CONFLICT,
                    message: `A record with this ${fields} already exists`,
                };
            }

            // Record not found (update/delete on non-existent row)
            case "P2025": {
                return {
                    statusCode: HttpStatus.NOT_FOUND,
                    message: "The requested record was not found",
                };
            }

            // Foreign key constraint failure
            case "P2003": {
                const field = (error.meta?.field_name as string) ?? "relation";
                return {
                    statusCode: HttpStatus.CONFLICT,
                    message: `Related ${field} does not exist or has dependent records`,
                };
            }

            // Required relation violation
            case "P2014": {
                return {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: "A required related record is missing",
                };
            }

            // Value too long for column
            case "P2000": {
                const column = (error.meta?.column_name as string) ?? "field";
                return {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: `Value too long for ${column}`,
                };
            }

            // Connection pool timeout
            case "P2024": {
                return {
                    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                    message: "Database connection timeout — please retry",
                };
            }

            // Unhandled Prisma error code — treat as 500
            default: {
                return {
                    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                    message: "An unexpected database error occurred",
                };
            }
        }
    }
}
```

**Key observations from the example:**

- **`@Catch()` with no arguments** catches everything — Zod errors, Prisma errors, domain errors, HTTP exceptions, and completely unknown failures.
- **Zod issues are human-readable:** `"name: Required; status: Invalid enum value"` instead of raw JSON.
- **Prisma `P2002`** extracts the `target` field names from `error.meta` to tell the user _which_ unique constraint was violated.
- **Correlation ID** is always included, enabling end-to-end request tracing in logs and error responses.
- **5xx vs 4xx logging:** Server errors get full stack traces for debugging; client errors get message-only logs to reduce noise.
- **No internal details leak:** The response body never contains stack traces, SQL queries, or raw error objects. The `"Internal server error"` message is deliberately generic for unknown failures.
- **Fastify plugin errors** (like `FST_ERR_CTP_INVALID_CONTENT_LENGTH`) have a `statusCode` property on the raw error object — the filter detects and passes them through.
