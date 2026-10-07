# Backend Patterns & Abstractions

Metadata
- Purpose: Document shared backend patterns, services, and abstractions
- Audience: Backend engineers, full-stack engineers
- Status: current
- Owner: Engineering Team
- Last Updated: 2026-02-01

## Overview

This document describes the shared patterns and abstractions used across the backend codebase to ensure consistency, reduce duplication, and improve maintainability.

## Delete Service Pattern

### BaseDeleteService

All entity deletion is handled through a consolidated `BaseDeleteService` abstraction that provides consistent behavior for cascade deletion, storage cleanup, and audit logging.

**Location:** `backend/src/common/base-delete.service.ts`

**Key Features:**
- Configurable cascade relations (cascade, nullify, restrict strategies)
- Automatic storage cleanup with proper error logging (no silent catches)
- Audit logging for all deletions
- Transaction support via EntityManager

**Configuration Interface:**
```typescript
interface DeleteConfig<T> {
  entityName: string;
  storagePrefix?: string;        // For S3 cleanup
  cascadeRelations?: CascadeRelation[];
  auditAction?: string;
}

interface CascadeRelation {
  repository: Repository<any>;
  foreignKey: string;
  deleteStrategy: 'cascade' | 'nullify' | 'restrict';
}
```

**Usage Example:**
```typescript
@Injectable()
export class ContactsDeleteService extends BaseDeleteService<Contact> {
  constructor(
    @InjectRepository(Contact) repository: Repository<Contact>,
    storage: StorageService,
    audit: AuditService,
  ) {
    super(repository, storage, audit, {
      entityName: 'Contact',
      storagePrefix: 'contacts',
      cascadeRelations: [
        { repository: supplierContactLinkRepo, foreignKey: 'contact_id', deleteStrategy: 'cascade' }
      ],
    });
  }
}
```

**Migrated Services (13 total):**
- `contacts-delete.service.ts`
- `tasks-delete.service.ts`
- `suppliers-delete.service.ts`
- `departments-delete.service.ts`
- `companies-delete.service.ts`
- `accounts-delete.service.ts`
- `spend-items-delete.service.ts`
- `capex-items-delete.service.ts`
- `assets-delete.service.ts`
- `users-delete.service.ts`
- `business-processes-delete.service.ts`
- `applications-delete.service.ts`
- `chart-of-accounts-delete.service.ts`

---

## Tenancy Management

### TenancyManager Service

Tenant context is managed through a dedicated `TenancyManager` service that consolidates host resolution, transaction management, and context binding.

**Location:** `backend/src/common/tenancy/`

**Module Structure:**
```
backend/src/common/tenancy/
├── index.ts                    # Barrel exports
├── tenancy.module.ts           # @Global() module
├── tenancy.manager.ts          # Main service
├── tenancy.middleware.ts       # Host resolution middleware
├── tenancy.interceptor.ts      # Transaction lifecycle
└── __tests__/
    └── tenancy.manager.spec.ts
```

**TenancyManager API:**
```typescript
@Injectable({ scope: Scope.REQUEST })
export class TenancyManager {
  // Context management
  resolveFromHost(host: string): Promise<TenantContext | null>
  setContext(context: TenantContext): void
  getContext(): TenantContext | null
  getTenantId(): string  // Throws if not set

  // Transaction management
  getQueryRunner(): Promise<QueryRunner>
  getManager(): Promise<EntityManager>
  commit(): Promise<void>
  rollback(): Promise<void>
  executeInTransaction<T>(callback: (manager: EntityManager) => Promise<T>): Promise<T>
}
```

**Security:** All tenant SQL uses parameterized queries to prevent SQL injection:
```typescript
// Good - parameterized
await runner.query(`SET LOCAL app.current_tenant = $1`, [tenantId]);

// Bad - string interpolation (NEVER DO THIS)
await runner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
```

### @Tenant() Decorator

Replace `@Req() req: any` with the typed `@Tenant()` decorator for cleaner tenant context access.

**Location:** `backend/src/common/decorators/tenant.decorator.ts`

**Usage:**
```typescript
// Before
@Post()
async create(@Body() body: any, @Req() req: any) {
  const tenantId = req.tenantId;
  const userId = req.user?.sub;
  const manager = req?.queryRunner?.manager;
  // ...
}

// After
@Post()
async create(@Body() body: CreateDto, @Tenant() ctx: TenantRequest) {
  const { tenantId, userId, manager } = ctx;
  // ...
}
```

**TenantRequest Interface:**
```typescript
interface TenantRequest {
  tenantId: string;
  userId: string;
  userRoles: string[];
  queryRunner?: QueryRunner;
  manager?: EntityManager;
}
```

### Tenant Scoping in Services (Defense in Depth)

Even with RLS enabled, always pass the request `tenantId` into service options when:
- a service uses raw SQL, or
- a service reads by ID without an explicit tenant filter.

Assets services now expect `tenantId` in `ServiceOpts` and include `tenant_id` in list/detail/attachment/link/relation queries to prevent cross-tenant reads if RLS is bypassed in dev.

---

## Service Decomposition Pattern

Large services (>1000 LOC) are decomposed into focused sub-services using the facade pattern to maintain API compatibility.

### Structure

```
backend/src/{module}/
├── {module}.module.ts          # Updated imports
├── {module}.controller.ts      # Imports from ./services
└── services/
    ├── index.ts                # Barrel exports
    ├── {module}.service.ts     # Facade (delegates to sub-services)
    ├── {module}-base.service.ts    # Shared utilities
    ├── {module}-list.service.ts    # List/filter/pagination
    ├── {module}-crud.service.ts    # Create/Read/Update/Delete
    └── {module}-{feature}.service.ts  # Feature-specific logic
```

### Decomposed Modules

| Module | Original LOC | Sub-services |
|--------|-------------|--------------|
| assets | 1,464 | 6 services |
| connections | 1,555 | 5 services |
| interfaces | 1,977 | 6 services |
| applications | 2,003 | 9 services |
| portfolio | 2,452 | 10 services |

### Facade Pattern

The main service becomes a thin facade that delegates to sub-services:

```typescript
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly list: ApplicationsListService,
    private readonly crud: ApplicationsCrudService,
    private readonly owners: ApplicationsOwnersService,
    // ... other sub-services
  ) {}

  // Delegate to sub-services - maintains API compatibility
  async list(query: any, opts?: ServiceOpts) {
    return this.list.list(query, opts);
  }

  async get(id: string, opts?: ServiceOpts) {
    return this.crud.get(id, opts);
  }

  async create(data: any, userId: string, opts?: ServiceOpts) {
    return this.crud.create(data, userId, opts);
  }
  // ...
}
```

### Base Service Pattern

Each module has a base service with shared utilities:

```typescript
@Injectable()
export abstract class ApplicationsBaseService {
  constructor(
    @InjectRepository(Application) protected readonly appRepo: Repository<Application>,
  ) {}

  protected getRepo(opts?: ServiceOpts) {
    return opts?.manager?.getRepository(Application) ?? this.appRepo;
  }

  protected getManager(opts?: ServiceOpts) {
    return opts?.manager ?? this.appRepo.manager;
  }

  protected normalizeNullable(val: any): string | null {
    if (val === undefined || val === null || val === '') return null;
    return String(val).trim();
  }

  protected async ensureApp(id: string, opts?: ServiceOpts): Promise<Application> {
    const app = await this.getRepo(opts).findOne({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }
}
```

---

## Query Building

Services build queries with TypeORM and reuse the helpers in
`backend/src/common/ag-grid-filtering.ts`: `compileAgFilterCondition`,
`createParamNameGenerator`, and `buildQuickSearchConditions`.

Field mappings, joins, sorting, and `include` expansions are handled by the
individual services. For an example of sharing filter conditions across list,
navigation, and summary queries, see `buildFilteredScope` in
`backend/src/applications/services/applications-list.service.ts`.

---

## Type Safety

### DTOs with Zod

All input validation uses Zod schemas with the `nestjs-zod` integration.

**Common DTOs:** `backend/src/common/dto/`

```typescript
// list-query.dto.ts
export const ListQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  sort: z.string().optional(),
  filter: z.string().optional(),
  include: z.string().optional(),
  q: z.string().optional(),
});

export class ListQueryDto {
  static parse(input: unknown): ListQuery { ... }
  static safeParse(input: unknown): { success: boolean; data?: ListQuery; error?: ZodError } { ... }
}
```

**Response Types:** `backend/src/common/types/responses.ts`

```typescript
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

interface SingleResponse<T> {
  data: T;
}

interface DeleteResponse {
  deleted: boolean;
  id: string;
}

// Helper functions
function paginatedResponse<T>(items: T[], total: number, offset: number, limit: number): PaginatedResponse<T>
function singleResponse<T>(data: T): SingleResponse<T>
function deleteResponse(id: string): DeleteResponse
```

### Module DTOs

Each major module has typed DTOs in a `dto/` folder:

```
backend/src/{module}/dto/
├── create-{entity}.dto.ts
├── update-{entity}.dto.ts
├── list-{entity}-query.dto.ts
└── index.ts
```

**Modules with DTOs:**
- applications
- capex
- spend
- interfaces
- portfolio

---

## TypeORM Best Practices

### Use TypeORM Operators

Always use TypeORM operators, not MongoDB-style syntax:

```typescript
// ✅ Correct - TypeORM In() operator
import { In } from 'typeorm';
const items = await repo.find({ where: { id: In(ids) } });

// ❌ Wrong - MongoDB $in syntax (will fail)
const items = await repo.find({ where: { id: { $in: ids } } });
```

### Transaction Management

Use the request-scoped EntityManager for all queries:

```typescript
async create(data: CreateDto, @Tenant() ctx: TenantRequest) {
  const { manager } = ctx;
  const repo = manager.getRepository(Entity);
  // All queries use the tenant-scoped transaction
}
```

---

## Known Traps

- **TypeORM find options drop `null` and `undefined`.** `where: { fiscal_year: null }` silently matches every row (a budget total once summed every year). Use `IsNull()`.
- **Nest matches routes in declaration order.** Declare `@Get('export')` and other fixed paths before `@Get(':id')`, or the fixed path is read as an id and the request fails.
- **The JWT carries the user id in `sub`.** `req.user.id` is `undefined`, and an audit row written with it has no author. Read `req.user.sub`.
- **Fire-and-forget work must never reject.** The process has no `unhandledRejection` handler and Node exits on one. A method that callers do not await (notifications) is marked `@NeverRejects()` (`notifications/notifications.service.ts`): it logs and resolves. Never hand such a method the request's `EntityManager`: the request can release it first.
- **A new tenant-scoped table is registered in two inventories**, or CI fails: `TENANT_SCOPED_TABLES` in `common/tenant-isolation.inventory.ts` and `TENANT_PURGE_TABLES` in `admin/tenants/tenant-purge.inventory.ts`. The policy is named `<table>_tenant_isolation` and has both `USING` and `WITH CHECK`. The reset to the post-activation state (`admin/tenants/tenant-reset.inventory.ts`) purges the new table too, unless it is added to `TENANT_RESET_KEEP_TABLES` with its reason.
- **A migration cannot insert into a table it has just put under FORCE RLS**, because migrations run without a tenant context. Seed first, then enable RLS.
- **A new `NOT NULL` column or a new numbered reference (`item_number`) breaks raw SQL seed inserts.** Update `backend/scripts/rls-self-test.ts` and `backend/src/ai/__tests__/ai-phase1.integration.spec.ts` (and `item_sequences`).
- **`count(*)` in `psql` on a FORCE RLS table returns 0 without `app.current_tenant`, even for the table owner.** Count inside a `DO` block that loops over tenants and calls `set_config('app.current_tenant', <id>, true)`.

---

## File Structure Summary

```
backend/src/common/
├── base-delete.service.ts      # Delete service abstraction
├── delete.types.ts             # Delete-related types
├── tenancy/                    # Tenant context management
│   ├── tenancy.manager.ts
│   ├── tenancy.module.ts
│   ├── tenancy.middleware.ts
│   ├── tenancy.interceptor.ts
│   └── index.ts
├── dto/                        # Common DTOs
│   └── list-query.dto.ts
├── types/                      # Common types
│   ├── responses.ts
│   └── index.ts
├── decorators/                 # Custom decorators
│   ├── tenant.decorator.ts
│   └── index.ts
└── ag-grid-filtering.ts        # AG-Grid filter compilation
```

---

## List IDs Endpoint Pattern

Workspace pages use prev/next navigation to move through filtered lists. Each module provides a `GET /{module}/ids` endpoint returning ordered IDs matching the current filter criteria.

### Endpoint Contract

```typescript
// Request
GET /tasks/ids?sort=created_at:DESC&q=search&filters={...}&assigneeUserId=...&teamId=...

// Response
{ ids: string[] }
```

### Implementation Pattern

```typescript
// tasks-list.service.ts
async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[] }> {
  const mg = this.getManager(opts);
  const repo = mg.getRepository(Task);

  const { sort, q, filters } = parsePagination(query, { field: 'created_at', direction: 'DESC' });

  const qb = repo.createQueryBuilder('t').select('t.id');

  // Apply AG Grid filters (same as list endpoint)
  // ... filter compilation ...

  // Apply scope filters (module-specific)
  if (query?.assigneeUserId) {
    qb.andWhere('t.assignee_user_id = :assigneeUserId', { assigneeUserId: query.assigneeUserId });
  }
  if (query?.teamId) {
    qb.andWhere(`t.assignee_user_id IN (
      SELECT user_id FROM portfolio_team_member_configs WHERE team_id = :teamId
    )`, { teamId: query.teamId });
  }

  // Apply sorting (same field validation as list endpoint)
  qb.orderBy(`t.${sortField}`, sort.direction);

  const rows = await qb.getRawMany();
  return { ids: rows.map((r) => r.t_id) };
}
```

### Key Requirements

1. **Same filter logic as list()**: The `listIds()` method must apply the same filters as `list()` so navigation stays within the visible set.

2. **Scope params**: For modules with scope filters (e.g., Tasks with "My tasks"/"Team tasks"), accept the same params (`assigneeUserId`, `teamId`) and apply matching WHERE clauses.

3. **No pagination**: Returns all matching IDs. Client-side navigation hooks handle indexing.

4. **Performance**: Use `SELECT id` only, no JOINs unless required for filtering.

### Modules with /ids Endpoints

| Module | Endpoint | Scope Params |
|--------|----------|--------------|
| Tasks | `/tasks/ids` | `assigneeUserId`, `teamId` |
| OPEX | `/spend-items/summary/ids` | `year` |
| CAPEX | `/capex-items/summary/ids` | `year` |
| Contracts | `/contracts/ids` | - |
| Requests | `/portfolio/requests/ids` | - |
| Projects | `/portfolio/projects/ids` | - |
| Assets | `/assets/ids` | - |
| Applications | `/applications/ids` | - |
| Suppliers | `/suppliers/ids` | - |
| Companies | `/companies/ids` | - |
| Departments | `/departments/ids` | - |
| Accounts | `/accounts/ids` | - |

---

## References

- [architecture.md](../architecture.md) - System architecture
- [workspace-patterns.md](workspace-patterns.md) - RLS and tenant patterns
