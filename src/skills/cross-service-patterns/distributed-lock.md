# Distributed Lock Service

## 1. Component Pattern

**Type:** NestJS Injectable Service  
**Location:** `packages/common/src/distributed-lock.service.ts`  
**Consumers:** Any service that runs scheduled CRON jobs or needs mutual exclusion across multiple replicas

This pattern defines the `DistributedLockService` — a Redis-based distributed locking mechanism that ensures only one replica of a horizontally-scaled service executes a given critical section at a time. It is primarily used to prevent duplicate execution of scheduled CRON tasks.

---

## 2. Overview

When a NestJS service is scaled to multiple replicas (e.g., 3 pods in Kubernetes), NestJS `@Cron()` decorators fire independently on **every** replica. Without coordination, a CRON job that recalculates property tax penalties would run 3 times simultaneously — causing duplicate penalties, race conditions, and data corruption.

`DistributedLockService` solves this with **Redis-based mutual exclusion**:

1. **Atomic lock acquisition** using `SET key value NX EX ttl` — the `NX` flag ensures only one caller succeeds.
2. **Ownership tracking** — the lock value is `${process.pid}:${Date.now()}`, so only the holder can release it.
3. **Atomic release via Lua script** — a Lua script checks ownership before deleting, preventing a replica from releasing another replica's lock.
4. **TTL safety net** — if the holder crashes without releasing, the lock auto-expires after `ttlSeconds`.
5. **Graceful fallback** — if Redis is not configured (`REDIS_URL` not set) or unavailable, the service runs in **single-instance mode**: it always executes the function and logs a warning. This ensures local development and single-replica deployments work without Redis.

### When to Use

- **CRON jobs** that must run on exactly one replica (penalty calculation, report generation, cleanup tasks).
- **One-time migrations** that should only execute on one pod during rolling deployments.
- **Rate-limited external API calls** where only one replica should call the external service at a time.

### When NOT to Use

- **Request-level concurrency control** — use database-level locking (SELECT FOR UPDATE, optimistic locking) instead.
- **Long-running locks** (> 5 minutes) — distributed locks are designed for short critical sections. For long processes, use a job queue (see RabbitMQ patterns).

### Key Design Decisions

| Decision                     | Rationale                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis `SET NX EX`            | Atomic, well-understood, no external library needed beyond `ioredis`.                                                                                |
| Lua script for release       | Prevents race conditions where a slow holder's lock expires and another replica acquires it, then the original holder deletes the new holder's lock. |
| PID + timestamp as value     | Uniquely identifies the holder. PID distinguishes processes; timestamp distinguishes restarts of the same PID.                                       |
| Graceful fallback (no Redis) | Local development should not require Redis. Single-replica deployments should not fail if Redis is down.                                             |
| `lazyConnect: true`          | Prevents Redis connection failures from crashing the service during startup.                                                                         |
| `enableOfflineQueue: false`  | Commands fail immediately when disconnected instead of queuing forever.                                                                              |
| `maxRetriesPerRequest: 1`    | Fast failure on transient Redis issues. The lock pattern handles this gracefully (another replica will pick up the work).                            |

---

## 3. Rules

1. **Always use `withLock()` for CRON jobs** that must not run concurrently across replicas. Never rely on NestJS `@Cron()` alone in a multi-replica deployment.
2. **Choose meaningful lock keys** that describe the operation: `cron:penalty-calculation`, `cron:generate-monthly-reports`, `migration:v2-schema`. Prefix with the category (e.g., `cron:`, `migration:`).
3. **Set TTL conservatively** — it should be longer than the maximum expected execution time, plus a safety margin. If a job takes up to 2 minutes, set TTL to 300 seconds (5 minutes).
4. **TTL is a safety net, not a timer.** The lock is released immediately when `fn()` completes (or throws). TTL only matters if the process crashes mid-execution.
5. **Handle the `false` return value** from `withLock()`. When it returns `false`, it means another replica holds the lock. Log this and return gracefully — do not treat it as an error.
6. **Do not nest locks.** Acquiring lock A inside lock B risks deadlocks. If you need multiple operations coordinated, use a single lock with a broader scope.
7. **`REDIS_URL` environment variable** is optional. In local development, omit it and the service will run in single-instance mode (always executes).
8. **Do not instantiate `DistributedLockService` manually.** It is an `@Injectable()` managed by NestJS DI. Import the module that provides it.
9. **Register `DistributedLockService` in the common module** and import it wherever needed. Each service gets its own instance connected to the same Redis.
10. **The lock key is automatically prefixed** with `lock:`. Callers pass just the logical key (e.g., `cron:penalty-calculation`), and the service stores `lock:cron:penalty-calculation`.
11. **Errors inside `fn()` do NOT prevent lock release.** The `finally` block ensures the Lua release script always runs.
12. **Do not use this for user-facing request locking.** Use Prisma `$transaction()` with `SELECT FOR UPDATE` or optimistic concurrency (version fields) for request-level mutual exclusion.

---

## 4. Structure

```
packages/common/src/
├── distributed-lock.service.ts    # DistributedLockService — THIS FILE
├── distributed-lock.module.ts     # NestJS module that provides the service
├── service-client.ts              # createInternalHeaders()
├── base-service-client.ts         # BaseServiceClient
└── index.ts                       # Barrel re-exports

modules/domain/<module>/src/
├── schedulers/
│   └── <task>.scheduler.ts        # CRON job that uses withLock()
└── <module>.module.ts             # Imports DistributedLockModule
```

### Class Interface

```typescript
@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {
    /**
     * Executes `fn` under a distributed lock.
     *
     * @param lockKey - Logical lock name (auto-prefixed with "lock:")
     * @param ttlSeconds - Lock TTL as safety net for crash recovery
     * @param fn - Async function to execute under the lock
     * @returns true if the lock was acquired and fn executed, false if lock was already held
     */
    async withLock(lockKey: string, ttlSeconds: number, fn: () => Promise<void>): Promise<boolean>;
}
```

### Lock Lifecycle

```
Replica A                        Redis                         Replica B
    │                              │                               │
    │── SET lock:cron:X val NX EX ▶│                               │
    │◀── "OK" ─────────────────────│                               │
    │                              │                               │
    │   (executing fn...)          │── SET lock:cron:X val NX EX ──│
    │                              │── null (already locked) ──────▶│
    │                              │                               │
    │                              │                        return false
    │   (fn complete)              │                               │
    │                              │                               │
    │── EVAL lua_release ─────────▶│                               │
    │◀── 1 (deleted) ─────────────│                               │
    │                              │                               │
    return true                    │                               │
```

### Redis Key Format

```
lock:cron:penalty-calculation     → "12345:1740000000000"
lock:cron:monthly-reports         → "12346:1740000001000"
lock:migration:v2-schema          → "12347:1740000002000"
```

### Lua Release Script

```lua
-- Atomic release: only delete if we still own the lock
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

This prevents the following race condition:

1. Replica A acquires lock with TTL 60s
2. Replica A takes 65 seconds (lock expires at 60s)
3. Replica B acquires the now-available lock at 61s
4. Replica A finishes at 65s and calls DEL — **without the Lua check, this would delete Replica B's lock**
5. With the Lua check, Replica A's release is a no-op because the value no longer matches

---

## 5. Example Implementation

### The `DistributedLockService`

```typescript
// packages/common/src/distributed-lock.service.ts

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Redis-based distributed lock for coordinating work across multiple replicas.
 *
 * Primary use case: ensuring CRON jobs run on exactly one replica.
 *
 * Falls back to single-instance mode (always executes) when:
 *   - REDIS_URL is not set (local development)
 *   - Redis is unreachable (connection failure)
 *
 * Lock keys are automatically prefixed with "lock:".
 * Lock values use PID:timestamp for ownership tracking.
 * Release uses a Lua script for atomic ownership verification.
 */
@Injectable()
export class DistributedLockService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DistributedLockService.name);
    private redis: Redis | null = null;

    /**
     * Lua script for atomic lock release.
     * Only deletes the key if the current value matches (i.e., we still own it).
     */
    private readonly RELEASE_SCRIPT = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        else
            return 0
        end
    `;

    onModuleInit(): void {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
            this.logger.warn(
                "REDIS_URL not set — running in single-instance mode (locks always acquired)",
            );
            return;
        }

        this.redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
        });

        this.redis.on("error", (err) => {
            this.logger.warn(`Redis connection error: ${err.message}`);
        });

        this.redis.connect().catch((err) => {
            this.logger.warn(
                `Failed to connect to Redis — falling back to single-instance mode: ${err.message}`,
            );
            this.redis = null;
        });
    }

    async onModuleDestroy(): Promise<void> {
        if (this.redis) {
            await this.redis.quit().catch(() => {});
            this.redis = null;
        }
    }

    /**
     * Executes `fn` under a distributed lock.
     *
     * @param lockKey - Logical lock name (auto-prefixed with "lock:")
     * @param ttlSeconds - Lock TTL in seconds. Acts as a safety net if the holder crashes.
     *                     Should be longer than the max expected execution time of fn.
     * @param fn - Async function to execute while holding the lock.
     * @returns true if the lock was acquired and fn was executed;
     *          false if another replica already holds the lock.
     *
     * @example
     * const acquired = await this.lockService.withLock("cron:penalty-calc", 300, async () => {
     *     await this.calculatePenalties();
     * });
     * if (!acquired) {
     *     this.logger.log("Skipped — already running on another replica");
     * }
     */
    async withLock(lockKey: string, ttlSeconds: number, fn: () => Promise<void>): Promise<boolean> {
        // ── Single-Instance Fallback ────────────────────────────────────
        // If Redis is not available, always execute. This is safe for
        // single-replica deployments and local development.
        if (!this.redis) {
            this.logger.debug(`No Redis — executing "${lockKey}" without lock`);
            await fn();
            return true;
        }

        // ── Lock Acquisition ────────────────────────────────────────────
        const lockValue = `${process.pid}:${Date.now()}`;
        const fullKey = `lock:${lockKey}`;

        let result: string | null;
        try {
            // SET key value EX ttl NX
            //   NX = only set if key does not exist (atomic acquire)
            //   EX = set expiry in seconds (safety net)
            result = await this.redis.set(fullKey, lockValue, "EX", ttlSeconds, "NX");
        } catch (error) {
            // Redis error during acquisition — fall back to executing
            this.logger.warn(
                `Redis error acquiring lock "${lockKey}" — executing anyway: ${(error as Error).message}`,
            );
            await fn();
            return true;
        }

        if (result !== "OK") {
            // Lock is already held by another replica
            this.logger.debug(`Lock "${lockKey}" already held — skipping execution`);
            return false;
        }

        // ── Critical Section ────────────────────────────────────────────
        this.logger.debug(`Lock "${lockKey}" acquired — executing`);
        try {
            await fn();
        } finally {
            // ── Lock Release ────────────────────────────────────────────
            // Use Lua script for atomic release: only delete if we still own it.
            // This prevents us from accidentally releasing another replica's lock
            // if our lock expired during a slow execution.
            try {
                const released = await this.redis.eval(this.RELEASE_SCRIPT, 1, fullKey, lockValue);
                if (released === 0) {
                    this.logger.warn(
                        `Lock "${lockKey}" was already released or taken by another holder`,
                    );
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to release lock "${lockKey}": ${(error as Error).message}`,
                );
                // Not re-thrown — the lock will expire via TTL
            }
        }

        return true;
    }
}
```

### The `DistributedLockModule`

```typescript
// packages/common/src/distributed-lock.module.ts

import { Global, Module } from "@nestjs/common";
import { DistributedLockService } from "./distributed-lock.service";

@Global()
@Module({
    providers: [DistributedLockService],
    exports: [DistributedLockService],
})
export class DistributedLockModule {}
```

### Registering in a Service Module

```typescript
// modules/domain/property-tax/src/app.module.ts

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DistributedLockModule } from "@civic/common";
import { PenaltyScheduler } from "./schedulers/penalty.scheduler";
import { PenaltyService } from "./services/penalty.service";

@Module({
    imports: [
        ScheduleModule.forRoot(),
        DistributedLockModule, // Provides DistributedLockService
    ],
    providers: [PenaltyScheduler, PenaltyService],
})
export class AppModule {}
```

### Using in a CRON Scheduler

```typescript
// modules/domain/property-tax/src/schedulers/penalty.scheduler.ts

import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DistributedLockService } from "@civic/common";
import { PenaltyService } from "../services/penalty.service";

@Injectable()
export class PenaltyScheduler {
    private readonly logger = new Logger(PenaltyScheduler.name);

    constructor(
        private readonly lockService: DistributedLockService,
        private readonly penaltyService: PenaltyService,
    ) {}

    /**
     * Runs daily at 2:00 AM. Calculates late-payment penalties for all
     * overdue property tax accounts.
     *
     * Uses a distributed lock to ensure exactly one replica runs this.
     * TTL is 600 seconds (10 minutes) — the job typically completes in 2-3 minutes,
     * but we set a generous TTL as a safety net.
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async handlePenaltyCalculation(): Promise<void> {
        const acquired = await this.lockService.withLock(
            "cron:penalty-calculation",
            600, // 10-minute TTL
            async () => {
                this.logger.log("Starting penalty calculation...");
                const result = await this.penaltyService.calculateOverduePenalties();
                this.logger.log(
                    `Penalty calculation complete: ${result.processed} accounts, ${result.penaltiesApplied} penalties applied`,
                );
            },
        );

        if (!acquired) {
            this.logger.log("Penalty calculation already running on another instance — skipping");
        }
    }

    /**
     * Runs every hour. Sends reminder notifications for accounts with
     * upcoming due dates.
     */
    @Cron(CronExpression.EVERY_HOUR)
    async handleDueReminders(): Promise<void> {
        const acquired = await this.lockService.withLock(
            "cron:due-date-reminders",
            300, // 5-minute TTL
            async () => {
                this.logger.log("Sending due date reminders...");
                await this.penaltyService.sendDueDateReminders();
                this.logger.log("Due date reminders sent");
            },
        );

        if (!acquired) {
            this.logger.debug("Due date reminders already running on another instance");
        }
    }
}
```

### Using for a One-Time Migration

```typescript
// modules/domain/property-tax/src/services/migration.service.ts

import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { DistributedLockService } from "@civic/common";

@Injectable()
export class MigrationService implements OnApplicationBootstrap {
    private readonly logger = new Logger(MigrationService.name);

    constructor(private readonly lockService: DistributedLockService) {}

    /**
     * Runs once on startup. During a rolling deployment, multiple pods start
     * simultaneously — the lock ensures only one runs the migration.
     */
    async onApplicationBootstrap(): Promise<void> {
        const acquired = await this.lockService.withLock(
            "migration:backfill-penalty-types",
            120, // 2-minute TTL
            async () => {
                this.logger.log("Running backfill migration...");
                // ... migration logic
                this.logger.log("Backfill migration complete");
            },
        );

        if (!acquired) {
            this.logger.log("Migration already running on another pod — skipping");
        }
    }
}
```

### Testing with the Fallback (No Redis)

```typescript
// In tests, REDIS_URL is not set, so DistributedLockService always executes fn

describe("PenaltyScheduler", () => {
    let scheduler: PenaltyScheduler;
    let penaltyService: PenaltyService;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            imports: [DistributedLockModule],
            providers: [
                PenaltyScheduler,
                {
                    provide: PenaltyService,
                    useValue: {
                        calculateOverduePenalties: jest.fn().mockResolvedValue({
                            processed: 100,
                            penaltiesApplied: 5,
                        }),
                    },
                },
            ],
        }).compile();

        scheduler = module.get(PenaltyScheduler);
        penaltyService = module.get(PenaltyService);
    });

    it("should calculate penalties when lock is acquired", async () => {
        // No REDIS_URL set → lock always acquired → fn always executes
        await scheduler.handlePenaltyCalculation();
        expect(penaltyService.calculateOverduePenalties).toHaveBeenCalledTimes(1);
    });
});
```
