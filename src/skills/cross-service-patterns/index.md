# Cross-Service Patterns

> Canonical reference for service-to-service HTTP communication, response
> envelope handling, and distributed coordination in the Civic Modules platform.
> Each pattern document below is self-contained with five sections:
> **Component Pattern**, **Overview**, **Rules**, **Structure**, and **Example Implementation**.

## Architecture Overview

When a module needs data from another module, it makes an authenticated
HTTP call (never a direct database query). The `BaseServiceClient` abstract
class provides retry with exponential backoff, timeout, response unwrapping,
and optional Zod validation. Authentication uses short-lived JWTs with the
SERVICE_ACCOUNT role. A distributed lock service ensures scheduled jobs run
on exactly one replica.

```
┌─────────────────────┐         ┌─────────────────────┐
│  Module A           │         │  Module B           │
│  ┌───────────────┐  │  HTTP   │  ┌───────────────┐  │
│  │ ServiceClient  │──┼────────┼─▶│  Controller    │  │
│  │ (extends Base) │  │  JWT   │  │  (AuthGuard    │  │
│  └───────┬───────┘  │  30s   │  │   validates)   │  │
│          │          │         │  └───────┬───────┘  │
│  ┌───────▼───────┐  │         │  ┌───────▼───────┐  │
│  │ createInternal │  │         │  │  Service →    │  │
│  │ Headers()     │  │         │  │  Repository   │  │
│  └───────────────┘  │         │  └───────────────┘  │
│                     │         │                     │
│  Response:          │         │  Response:          │
│  unwrapEnvelope()   │◀────────│  { success, data }  │
│  + Zod validate     │         │  (auto-wrapped)     │
└─────────────────────┘         └─────────────────────┘

┌─────────────────────────────────────────┐
│  DistributedLockService                 │
│  Redis SET NX EX → Lua release          │
│  Ensures 1 replica runs CRON job        │
└─────────────────────────────────────────┘
```

## Pattern Documents

| #   | Pattern                                          | Description                                                     |
| --- | ------------------------------------------------ | --------------------------------------------------------------- |
| 1   | [service-client.md](service-client.md)           | `createInternalHeaders()` — 30s JWT for service-to-service auth |
| 2   | [base-service-client.md](base-service-client.md) | Abstract client with retry, timeout, Zod validation             |
| 3   | [response-envelope.md](response-envelope.md)     | Response wrapping interceptor + unwrapEnvelope utility          |
| 4   | [distributed-lock.md](distributed-lock.md)       | Redis-based distributed lock with Lua atomic release            |
