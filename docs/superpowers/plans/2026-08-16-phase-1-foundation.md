# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, CDK infrastructure, an app client on the shared Cognito pool, and end-to-end household management (create, share via invite, switch, delete) with an empty, working board registry.

**Architecture:** npm workspaces (`api`, `app`, `packages/shared`, `infrastructure`). One DynamoDB table behind a Hono API on Lambda, documented via `@hono/zod-openapi` so the contract is machine-readable from day one. A React SPA on S3/CloudFront, authenticated against the pool CoreInfra now owns (Phase 0 must be complete first). Boards are a generic, empty registry in this phase — no board type is registered until Phase 2.

**Tech Stack:** Hono 4 + `@hono/zod-openapi`, Zod 4, DynamoDB (`@aws-sdk/lib-dynamodb`), React 19, Vite 8, TanStack Query 5, `oidc-client-ts`, AWS CDK 2.

**Spec:** `docs/superpowers/specs/2026-08-16-household-manager-design.md` §3–7, §9–10

## Global Constraints

- **Prerequisite:** Phase 0 (`docs/superpowers/plans/2026-08-16-phase-0-cognito-relocation.md`) must be complete — `/core/auth/user-pool-id` and `/core/auth/hosted-domain` must resolve in SSM before Task 4 of this plan can be verified.
- **No test cases** — `PRACTICES.md` forbids them unless explicitly requested. Verification is `tsc --noEmit`, `cdk synth`, and manual `curl`/dev-server checks.
- Node 24, ESM (`"type": "module"`), TypeScript 5.9 `strict` + `exactOptionalPropertyTypes`, ES module specifiers end in `.js` even for `.ts` source files (Poster Walls Editor convention — verify by reading `api/src/app.ts` there if unsure).
- Every AWS resource is tagged `environment=prd`, `project=household-manager` (applied once, at the `App` level, in Task 6).
- **`.use()` uses Hono's `:param` path syntax; `createRoute({ path })` uses OpenAPI's `{param}` syntax.** They are not interchangeable — this trips up everyone once.
- Package names: `@hhm/shared`, `@hhm/api`, `@hhm/app`, `@hhm/infrastructure` — short-scope convention matching the reference app (`@pwe/*` in Poster Walls Editor).
- Claude cannot run `cdk deploy`. Deploy steps are operator hand-offs with the exact command.

---

### Task 1: Root monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`
- Create: `scripts/write-dev-env.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: the `npm run typecheck` / `npm run build` / `npm run dev` scripts every later task's verification step calls.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "household-manager",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "api", "app", "infrastructure"],
  "engines": { "node": ">=24" },
  "scripts": {
    "typecheck": "tsc --build && tsc -p infrastructure/tsconfig.json --noEmit && tsc -p app/tsconfig.json --noEmit",
    "build": "npm run build --workspaces --if-present",
    "dev:env": "node scripts/write-dev-env.mjs",
    "dev:api": "tsx watch --env-file-if-exists=.env.local api/src/dev-server.ts",
    "dev:app": "npm run dev --workspace @hhm/app",
    "dev": "concurrently -n api,app -c cyan,magenta \"npm:dev:api\" \"npm:dev:app\""
  },
  "devDependencies": {
    "concurrently": "^9.2.4",
    "tsx": "^4.23.1",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: `tsconfig.base.json`** (identical to Poster Walls Editor's — copy verbatim)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

- [ ] **Step 3: Root `tsconfig.json`** — project references, filled in as later tasks add workspaces. For now:

```json
{
  "files": [],
  "references": [{ "path": "packages/shared" }]
}
```

(Task 7 adds `{ "path": "api" }` when `api/` exists.)

- [ ] **Step 4: `scripts/write-dev-env.mjs`** — reads the deployed stack's outputs, writes the two files local dev needs. Copy Poster Walls Editor's `scripts/write-dev-env.mjs` and adjust for this app's outputs (no `IMAGES_BUCKET`/`VITE_IMAGE_BASE_URL` — this app has no images bucket):

```js
#!/usr/bin/env node
/**
 * Writes the local dev environment from the deployed stack's outputs.
 *
 * Local development runs against real AWS — the real (imported) Cognito pool
 * and the real DynamoDB table — so that auth and persistence behave exactly
 * as they do in production.
 *
 * Produces two files, both git-ignored:
 *   .env.local          consumed by the local API server
 *   app/.env.local      consumed by Vite
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const STACK = process.env.STACK_NAME ?? 'HouseholdManager';

function outputs() {
  const raw = execFileSync(
    'aws',
    ['cloudformation', 'describe-stacks', '--stack-name', STACK, '--query', 'Stacks[0].Outputs', '--output', 'json'],
    { encoding: 'utf8' },
  );
  return Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
}

let o;
try {
  o = outputs();
} catch {
  console.error('Could not read the stack outputs.\nMost likely your AWS session has expired — run `aws login`, then retry.');
  process.exit(1);
}

const API_PORT = process.env.PORT ?? '8787';

writeFileSync(
  '.env.local',
  [
    '# Generated by scripts/write-dev-env.mjs — do not edit, do not commit.',
    `TABLE_NAME=${o.TableName}`,
    `USER_POOL_ID=${o.UserPoolId}`,
    `USER_POOL_CLIENT_ID=${o.UserPoolClientId}`,
    `PORT=${API_PORT}`,
    '',
  ].join('\n'),
);

writeFileSync(
  'app/.env.local',
  [
    '# Generated by scripts/write-dev-env.mjs — do not edit, do not commit.',
    `VITE_API_URL=http://localhost:${API_PORT}`,
    `VITE_COGNITO_DOMAIN=${o.CognitoDomain}`,
    `VITE_USER_POOL_CLIENT_ID=${o.UserPoolClientId}`,
    '',
  ].join('\n'),
);

console.log('wrote .env.local and app/.env.local');
console.log(`  api  -> http://localhost:${API_PORT}`);
console.log(`  app  -> http://localhost:5173`);
console.log(`  data -> ${o.TableName} (real table)`);
```

- [ ] **Step 5: Install root devDependencies and verify**

Run: `npm install`
Expected: exits 0, creates `package-lock.json`.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json tsconfig.json scripts/write-dev-env.mjs package-lock.json
git commit -m "chore: scaffold the npm workspaces monorepo"
```

---

### Task 2: `packages/shared` — ids, keys, board registry, domain schemas

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/ids.ts`, `packages/shared/src/keys.ts`, `packages/shared/src/boards.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every type and schema the API and app import — `IdSchema`, key builders (`householdPk`, `userPk`, `invitePk`, `boardSk`, `memberSk`, `normalizeEmail`), `registerBoardType`/`boardType`/`boardTypeIds`, and the Zod schemas for `Household`, `Member`, `Profile`, `Invite`, `Board`, and `MeResponse` (with their `Create*`/`Update*` variants).

- [ ] **Step 1: `packages/shared/package.json`**

```json
{
  "name": "@hhm/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": { "zod": "^4.4.3" }
}
```

- [ ] **Step 2: `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/shared/src/ids.ts`** — identical rationale to Poster Walls Editor: `#` is the key-segment separator, so it is excluded from valid ids.

```ts
import { z } from 'zod';

/**
 * IDs are opaque strings generated with `crypto.randomUUID()`.
 *
 * `#` is excluded deliberately: it is the key-segment separator used
 * throughout `keys.ts`, so an id containing `#` could make one item's key
 * collide with another's.
 */
export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must contain only letters, digits, hyphen, or underscore');
```

- [ ] **Step 4: `packages/shared/src/keys.ts`**

```ts
/**
 * DynamoDB key addressing for the single table (spec §4).
 *
 * Layout:
 *   HH#<householdId>       META
 *   HH#<householdId>       BOARD#<boardId>
 *   HH#<householdId>       BOARD#<boardId>#TASK#<taskId>          (phase 2)
 *   HH#<householdId>       MEMBER#<sub>
 *   HH#<householdId>       INVITE#<email>
 *   USER#<sub>              PROFILE
 *   USER#<sub>              HH#<householdId>                       (membership / switcher index)
 *   INVITE#<email>          HH#<householdId>                       (invite, by invitee)
 *
 * GSI1 (sparse): only a currently-notifiable task carries GSI1PK/GSI1SK.
 * Declared here so phase 2 does not have to touch the table construct again.
 */

export const META = 'META';
export const PROFILE = 'PROFILE';

export const BOARD_SK_PREFIX = 'BOARD#';
export const MEMBER_SK_PREFIX = 'MEMBER#';
export const INVITE_SK_PREFIX = 'INVITE#';

export function householdPk(householdId: string): string {
  return `HH#${householdId}`;
}

export function userPk(sub: string): string {
  return `USER#${sub}`;
}

export function invitePk(email: string): string {
  return `INVITE#${normalizeEmail(email)}`;
}

export function boardSk(boardId: string): string {
  return `${BOARD_SK_PREFIX}${boardId}`;
}

export function memberSk(sub: string): string {
  return `${MEMBER_SK_PREFIX}${sub}`;
}

export function householdInviteSk(email: string): string {
  return `${INVITE_SK_PREFIX}${normalizeEmail(email)}`;
}

/** Lowercased and trimmed — the one normalized form every invite/member/profile email is stored and compared as. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The sparse reminder queue (spec §4, §6). Phase 2 writes to it; the table declares it now. */
export const GSI1 = 'GSI1';
export const DUE_PARTITION = 'DUE';
```

- [ ] **Step 5: `packages/shared/src/boards.ts`** — the pluggable-board registry (spec §5)

```ts
import type { z } from 'zod';

export interface BoardTypeDefinition {
  readonly id: string;
  readonly displayName: string;
  /** A short label used as a fallback icon — an emoji, e.g. "✅". */
  readonly icon: string;
  readonly configSchema: z.ZodTypeAny;
}

const registry = new Map<string, BoardTypeDefinition>();

/**
 * Called once per board type, at module load, by that type's own module —
 * e.g. `boards/tasks.ts` in phase 2. The core never imports a specific
 * board type; only `index.ts` decides which type modules are loaded at all.
 */
export function registerBoardType(def: BoardTypeDefinition): void {
  if (registry.has(def.id)) {
    throw new Error(`board type "${def.id}" is already registered`);
  }
  registry.set(def.id, def);
}

export function boardType(id: string): BoardTypeDefinition | undefined {
  return registry.get(id);
}

export function boardTypeIds(): string[] {
  return [...registry.keys()];
}
```

- [ ] **Step 6: `packages/shared/src/schemas.ts`**

```ts
import { z } from 'zod';
import { IdSchema } from './ids.js';

export const EmailSchema = z
  .string()
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

// --- households --------------------------------------------------------

export const HouseholdSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().nonnegative(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(120),
});
export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;

export const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).max(120),
  /** The version the client last read. A mismatch means someone else wrote. */
  version: z.number().int().nonnegative(),
});
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;

export const HouseholdSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
});
export type HouseholdSummary = z.infer<typeof HouseholdSummarySchema>;

// --- members & invites ---------------------------------------------------

export const MemberSchema = z.object({
  sub: z.string(),
  email: z.string(),
  joinedAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InviteSchema = z.object({
  householdId: IdSchema,
  email: z.string(),
  invitedAt: z.string(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const CreateInviteSchema = z.object({
  email: EmailSchema,
});
export type CreateInviteInput = z.input<typeof CreateInviteSchema>;

// --- profile ---------------------------------------------------------------

export const ProfileSchema = z.object({
  sub: z.string(),
  email: z.string(),
  lastHouseholdId: IdSchema.nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const MeResponseSchema = z.object({
  sub: z.string(),
  email: z.string(),
  lastHouseholdId: IdSchema.nullable(),
  households: z.array(HouseholdSummarySchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- boards ------------------------------------------------------------

export const BoardSchema = z.object({
  id: IdSchema,
  householdId: IdSchema,
  type: z.string(),
  title: z.string().min(1).max(120),
  position: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Board = z.infer<typeof BoardSchema>;

export const CreateBoardSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).max(120),
});
export type CreateBoard = z.infer<typeof CreateBoardSchema>;

export const UpdateBoardSchema = z.object({
  title: z.string().min(1).max(120),
});
export type UpdateBoard = z.infer<typeof UpdateBoardSchema>;
```

- [ ] **Step 7: `packages/shared/src/index.ts`**

```ts
export * from './ids.js';
export * from './keys.js';
export * from './boards.js';
export * from './schemas.js';
```

- [ ] **Step 8: Install and verify**

```bash
npm install
npx tsc -p packages/shared/tsconfig.json --noEmit
```
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): ids, DynamoDB keys, board registry, domain schemas"
```

---

### Task 3: `infrastructure` — bootstrap stack

**Files:**
- Create: `infrastructure/package.json`, `infrastructure/tsconfig.json`, `infrastructure/cdk.json`
- Create: `infrastructure/lib/bootstrap-stack.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BootstrapStack`, instantiated by Task 6's `bin/app.ts`.

- [ ] **Step 1: `infrastructure/package.json`**

```json
{
  "name": "@hhm/infrastructure",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "synth": "cdk synth",
    "deploy": "cdk deploy --require-approval never"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.262.1",
    "constructs": "^10.7.1"
  },
  "devDependencies": {
    "aws-cdk": "^2.1133.0",
    "@types/node": "^26.1.1"
  }
}
```

- [ ] **Step 2: `infrastructure/cdk.json`**

```json
{
  "app": "npx tsx bin/app.ts",
  "context": { "@aws-cdk/customresources:installLatestAwsSdkDefault": false }
}
```

- [ ] **Step 3: `infrastructure/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "composite": false },
  "include": ["bin", "lib"]
}
```

- [ ] **Step 4: `infrastructure/lib/bootstrap-stack.ts`** — copy Poster Walls Editor's `infrastructure/lib/bootstrap-stack.ts` verbatim; it takes owner/repo as props, so no content changes are needed, only the values passed to it in Task 6.

```ts
import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface BootstrapStackProps extends StackProps {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubOwnerId: string;
  readonly githubRepoId: string;
}

/**
 * Deployed once, manually, from a local admin identity. It is what allows
 * GitHub Actions to deploy everything else, so it cannot itself be deployed
 * by GitHub Actions.
 */
export class BootstrapStack extends Stack {
  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);

    // REFERENCED, not created. An OIDC provider is an account-level singleton
    // keyed on its URL, and this account already has one — PosterWalls'
    // bootstrap stack owns it. Declaring a second provider for the same URL
    // fails the deploy with `EntityAlreadyExists`.
    const providerArn = `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`;

    const role = new iam.Role(this, 'DeployRole', {
      roleName: 'HouseholdManagerGithubDeploy',
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${props.githubOwner}/${props.githubRepo}:*`,
            `repo:${props.githubOwner}@${props.githubOwnerId}/${props.githubRepo}@${props.githubRepoId}:*`,
          ],
        },
      }),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')],
    });

    new CfnOutput(this, 'DeployRoleArn', { value: role.roleArn });
  }
}
```

- [ ] **Step 5: Install and verify it compiles standalone**

```bash
npm install
npx tsc -p infrastructure/tsconfig.json --noEmit
```
Expected: fails — `bin/app.ts` does not exist yet, and `lib/main-stack.ts` (referenced by nothing yet) is fine. If `tsc` complains only about a missing `bin/app.ts` entry (there is no entry point requirement in a plain `--noEmit` check of `include`), that's expected; a real failure elsewhere is not. If unsure, skip this step's gate and let Task 6's synth be the real check — note that here rather than guessing.

- [ ] **Step 6: Commit**

```bash
git add infrastructure/package.json infrastructure/tsconfig.json infrastructure/cdk.json infrastructure/lib/bootstrap-stack.ts package-lock.json
git commit -m "feat(infra): bootstrap stack for the GitHub Actions deploy role"
```

---

### Task 4: `infrastructure` — data and auth constructs

**Files:**
- Create: `infrastructure/lib/constructs/data.ts`, `infrastructure/lib/constructs/auth.ts`

**Interfaces:**
- Consumes: `/core/auth/user-pool-id` and `/core/auth/hosted-domain` from SSM (published by Phase 0).
- Produces: `DataConstruct.table: dynamodb.TableV2`, `AuthConstruct.userPoolId: string`, `AuthConstruct.client: cognito.UserPoolClient`, `AuthConstruct.hostedDomain: string`.

**Precondition:** Phase 0 complete — verify with `aws ssm get-parameter --name /core/auth/user-pool-id --query Parameter.Value --output text` before starting; it must return a pool ID, not an error.

- [ ] **Step 1: `infrastructure/lib/constructs/data.ts`**

```ts
import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Single-table store. GSI1 is the sparse reminder queue (spec §4, §6): only
 * a currently-notifiable task carries GSI1PK/GSI1SK, so the phase-3 reminder
 * Lambda's query naturally excludes completed and dismissed tasks rather
 * than filtering them out after the fact.
 */
export class DataConstruct extends Construct {
  readonly table: dynamodb.TableV2;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.ALL,
        },
      ],
    });
  }
}
```

- [ ] **Step 2: `infrastructure/lib/constructs/auth.ts`**

```ts
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface AuthConstructProps {
  /** Callback/logout origins for THIS app's client. */
  readonly webOrigins: string[];
}

/**
 * This app's client on the account's shared Cognito pool (spec §2). The pool
 * is owned by CoreInfra; this construct never declares one — it reads the
 * published contract and adds only its own client.
 */
export class AuthConstruct extends Construct {
  readonly userPoolId: string;
  readonly client: cognito.UserPoolClient;
  readonly hostedDomain: string;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    this.userPoolId = ssm.StringParameter.valueForStringParameter(this, '/core/auth/user-pool-id');
    this.hostedDomain = ssm.StringParameter.valueForStringParameter(this, '/core/auth/hosted-domain');

    // fromUserPoolId() returns IUserPool, not the concrete UserPool class —
    // but IUserPool still exposes addClient(): a client only needs the
    // pool's ID/ARN, not its full configuration, so this is sufficient for
    // an app that does not own the pool.
    const pool = cognito.UserPool.fromUserPoolId(this, 'ImportedPool', this.userPoolId);

    this.client = pool.addClient('WebClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.webOrigins.map((o) => `${o}/callback`),
        logoutUrls: props.webOrigins,
      },
      preventUserExistenceErrors: true,
    });
  }
}
```

- [ ] **Step 3: Verify these two files typecheck in isolation**

There is no standalone entry point yet, so full `cdk synth` is not possible until Task 6. Confirm no obvious syntax/type errors by running:
```bash
npx tsc -p infrastructure/tsconfig.json --noEmit
```
Expected: still fails only on the missing `bin/app.ts` (or passes cleanly if `tsc` tolerates an empty `include` resolution) — a type error inside `data.ts` or `auth.ts` themselves is a real failure to fix now. Full confirmation happens in Task 6.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lib/constructs/data.ts infrastructure/lib/constructs/auth.ts
git commit -m "feat(infra): DynamoDB table and the shared pool's app client"
```

---

### Task 5: `infrastructure` — web and api constructs

**Files:**
- Create: `infrastructure/lib/constructs/web.ts`, `infrastructure/lib/constructs/api.ts`

**Interfaces:**
- Consumes: `DataConstruct.table`, `AuthConstruct.userPoolId`/`client.userPoolClientId` (Task 4).
- Produces: `WebConstruct.webBucket`/`distribution`, `ApiConstruct.httpApi`/`fn`/`domain`.

- [ ] **Step 1: `infrastructure/lib/constructs/web.ts`** — S3 + CloudFront for the SPA. No images bucket: nothing in phases 1–3 stores images.

```ts
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface WebConstructProps {
  /** Omitted until DNS is delegated — see main-stack.ts. */
  readonly domainName?: string;
  readonly certificate?: acm.ICertificate;
}

export class WebConstruct extends Construct {
  readonly webBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebConstructProps = {}) {
    super(scope, id);

    this.webBucket = new s3.Bucket(this, 'WebBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const customDomain =
      props.domainName !== undefined && props.certificate !== undefined
        ? {
            domainNames: [props.domainName],
            certificate: props.certificate,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
          }
        : {};

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      ...customDomain,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.webBucket as s3.IBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // The SPA owns routing, so unknown paths must return index.html rather
      // than S3's 403/404.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(5) },
      ],
    });
  }
}
```

- [ ] **Step 2: `infrastructure/lib/constructs/api.ts`**

```ts
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface ApiConstructProps {
  readonly table: dynamodb.TableV2;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly domainName?: string;
  readonly certificate?: acm.ICertificate;
}

export class ApiConstruct extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly fn: NodejsFunction;
  readonly domain: apigwv2.DomainName | undefined;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'FnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new NodejsFunction(this, 'Fn', {
      entry: fileURLToPath(new URL('../../../api/src/lambda.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      logGroup,
      environment: {
        TABLE_NAME: props.table.tableName,
        USER_POOL_ID: props.userPoolId,
        USER_POOL_CLIENT_ID: props.userPoolClientId,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true },
    });

    props.table.grantReadWriteData(this.fn);

    if (props.domainName !== undefined && props.certificate !== undefined) {
      this.domain = new apigwv2.DomainName(this, 'DomainName', {
        domainName: props.domainName,
        certificate: props.certificate,
      });
    }

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      ...(this.domain === undefined ? {} : { defaultDomainMapping: { domainName: this.domain } }),
      // Hono owns CORS. Deliberately NOT named 'Default' — see the
      // Poster Walls Editor api.ts comment on logical-ID collisions if this
      // needs revisiting.
      defaultIntegration: new HttpLambdaIntegration('DefaultIntegration', this.fn),
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lib/constructs/web.ts infrastructure/lib/constructs/api.ts
git commit -m "feat(infra): S3/CloudFront web construct and Lambda/HTTP API construct"
```

---

### Task 6: `infrastructure` — main stack, entry point, tagging

**Files:**
- Create: `infrastructure/lib/main-stack.ts`, `infrastructure/bin/app.ts`

**Interfaces:**
- Consumes: all four constructs from Tasks 3–5.
- Produces: the deployable `HouseholdManager` and `HouseholdManagerBootstrap` stacks — the first point this plan can run `cdk synth` successfully.

**Note:** `api/src/lambda.ts` does not exist until Task 13. `cdk synth` in this task will fail at bundling with "no such file". That's expected — Step 3 verifies with `cdk synth --validation` skipped, or simply accept the failure and note it; do not spend time working around it. Task 13 is what makes synth succeed end to end; Task 13's own verification step is the real gate.

- [ ] **Step 1: `infrastructure/lib/main-stack.ts`**

```ts
import { CfnOutput, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';
import { ApiConstruct } from './constructs/api.js';
import { AuthConstruct } from './constructs/auth.js';
import { DataConstruct } from './constructs/data.js';
import { WebConstruct } from './constructs/web.js';

/** The subdomain the app lives on. Its zone is delegated; the apex is not. */
export const DOMAIN_NAME = 'household-manager.chrisbridewell.dev';
export const API_DOMAIN_NAME = `api.${DOMAIN_NAME}`;

export interface MainStackProps extends StackProps {
  /** Two-phase switch — see spec §9. Flip to true once the NS records are delegated. */
  readonly useCustomDomain: boolean;
}

export class MainStack extends Stack {
  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    const data = new DataConstruct(this, 'Data');

    const zone = new route53.PublicHostedZone(this, 'Zone', {
      zoneName: DOMAIN_NAME,
      comment: 'Delegated subdomain; the apex stays with the registrar',
    });

    const certificate = props.useCustomDomain
      ? new acm.Certificate(this, 'Certificate', {
          domainName: DOMAIN_NAME,
          subjectAlternativeNames: [API_DOMAIN_NAME],
          validation: acm.CertificateValidation.fromDns(zone),
        })
      : undefined;

    const web = new WebConstruct(this, 'Web', {
      ...(certificate === undefined ? {} : { domainName: DOMAIN_NAME, certificate }),
    });

    const webUrl = props.useCustomDomain
      ? `https://${DOMAIN_NAME}`
      : `https://${web.distribution.distributionDomainName}`;

    const auth = new AuthConstruct(this, 'Auth', {
      webOrigins: [
        `https://${web.distribution.distributionDomainName}`,
        ...(props.useCustomDomain ? [`https://${DOMAIN_NAME}`] : []),
        'http://localhost:5173',
      ],
    });

    const api = new ApiConstruct(this, 'Api', {
      table: data.table,
      userPoolId: auth.userPoolId,
      userPoolClientId: auth.client.userPoolClientId,
      ...(certificate === undefined ? {} : { domainName: API_DOMAIN_NAME, certificate }),
    });

    api.fn.addEnvironment('WEB_ORIGIN', webUrl);

    const apiUrl = api.domain === undefined ? api.httpApi.apiEndpoint : `https://${API_DOMAIN_NAME}`;

    if (api.domain !== undefined) {
      const toDistribution = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(web.distribution));
      new route53.ARecord(this, 'AppAlias', { zone, target: toDistribution });
      new route53.AaaaRecord(this, 'AppAliasV6', { zone, target: toDistribution });
      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: 'api',
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGatewayv2DomainProperties(api.domain.regionalDomainName, api.domain.regionalHostedZoneId),
        ),
      });
    }

    new CfnOutput(this, 'ApiUrl', { value: apiUrl });
    new CfnOutput(this, 'TableName', { value: data.table.tableName });
    new CfnOutput(this, 'WebUrl', { value: webUrl });
    new CfnOutput(this, 'WebBucketName', { value: web.webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: web.distribution.distributionId });
    new CfnOutput(this, 'UserPoolId', { value: auth.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: auth.client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', {
      value: `https://${auth.hostedDomain}.auth.${this.region}.amazoncognito.com`,
    });
    new CfnOutput(this, 'ZoneNameServers', {
      description: 'Add these as NS records for host "household-manager" at your registrar',
      value: Fn.join(', ', zone.hostedZoneNameServers ?? []),
    });
    new CfnOutput(this, 'CustomDomainEnabled', { value: String(props.useCustomDomain) });
  }
}
```

- [ ] **Step 2: `infrastructure/bin/app.ts`**

```ts
#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { BootstrapStack } from '../lib/bootstrap-stack.js';
import { MainStack } from '../lib/main-stack.js';

const app = new App();

const env = {
  ...(process.env.CDK_DEFAULT_ACCOUNT ? { account: process.env.CDK_DEFAULT_ACCOUNT } : {}),
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const main = new MainStack(app, 'HouseholdManager', {
  stackName: 'HouseholdManager',
  env,
  // Phase 1: false, until the NS records printed by ZoneNameServers are
  // delegated at the registrar (spec §9, §11). Flip once they resolve.
  useCustomDomain: false,
});

const bootstrap = new BootstrapStack(app, 'HouseholdManagerBootstrap', {
  stackName: 'HouseholdManagerBootstrap',
  env,
  githubOwner: 'CrispyCabot',
  githubRepo: 'household-manager',
  githubOwnerId: '18431358',
  githubRepoId: '1336082588',
});

for (const stack of [main, bootstrap]) {
  Tags.of(stack).add('environment', 'prd');
  Tags.of(stack).add('project', 'household-manager');
}
```

- [ ] **Step 3: Attempt synth — confirm the only failure is the missing Lambda entry**

```bash
cd infrastructure && npx cdk synth --quiet
```
Expected: fails, and the error names `api/src/lambda.ts` as missing (`NodejsFunction` bundling can't find the entry). Any *other* error — a type error, a missing import, a bad prop — must be fixed now. This task's real completion gate is Task 13's synth, not this one.

- [ ] **Step 4: Update the root `tsconfig.json` project references**

```json
{
  "files": [],
  "references": [{ "path": "packages/shared" }, { "path": "infrastructure" }]
}
```

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lib/main-stack.ts infrastructure/bin/app.ts tsconfig.json
git commit -m "feat(infra): wire the main stack and CDK entry point"
```

---

### Task 7: `api` — errors, auth middleware, DynamoDB client

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`
- Create: `api/src/errors.ts`, `api/src/auth.ts`, `api/src/db/client.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ApiError`, `errorHandler`, `notFound` (identical contract to Poster Walls Editor); `AuthedUser { sub, email }`, `AuthedEnv`, `TokenVerifier`, `createAuthMiddleware`, `cognitoVerifier`; `docClient()`, `tableName()`.

- [ ] **Step 1: `api/package.json`**

```json
{
  "name": "@hhm/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/lambda.ts",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.1095.0",
    "@aws-sdk/lib-dynamodb": "^3.1095.0",
    "@hono/node-server": "^1.19.17",
    "@hono/zod-openapi": "latest",
    "@hhm/shared": "*",
    "aws-jwt-verify": "^5.2.1",
    "hono": "^4.12.32",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^26.1.1"
  }
}
```

`@hono/zod-openapi` is pinned to `"latest"` deliberately, not a caret range copied from memory — install it in Step 4 and then **replace `"latest"` with the exact resolved version** from `package-lock.json`, the same way every other dependency here is pinned.

- [ ] **Step 2: `api/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: `api/src/errors.ts`** — identical to Poster Walls Editor's

```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (c: Context) =>
  c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);

export function errorHandler(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof ZodError) {
    console.error('validation error', err.issues);
    return c.json({ error: { code: 'validation_error', message: 'Invalid request' } }, 400);
  }
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error('unhandled error', err);
  return c.json({ error: { code: 'internal_error', message: 'Internal server error' } }, 500);
}
```

- [ ] **Step 4: `api/src/auth.ts`** — verifies the **ID token**, not the access token. This is the one deliberate deviation from Poster Walls Editor's `auth.ts`, and why matters:

```ts
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createMiddleware } from 'hono/factory';
import { ApiError } from './errors.js';

export interface AuthedUser {
  sub: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<AuthedUser>;
export type AuthedEnv = { Variables: { user: AuthedUser } };

export function createAuthMiddleware(verify: TokenVerifier) {
  return createMiddleware<AuthedEnv>(async (c, next) => {
    const header = c.req.header('Authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }
    let user: AuthedUser;
    try {
      user = await verify(header.slice('Bearer '.length));
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid token');
    }
    c.set('user', user);
    await next();
  });
}

/**
 * Production verifier. Verifies the ID token, not the access token.
 *
 * Unlike Poster Walls Editor, this app needs `email` on nearly every
 * authenticated request — member records, invite claiming, the profile —
 * and Cognito puts standard attributes like `email` on the ID token, not
 * the access token. The SPA (see app/src/auth/AuthProvider.tsx) sends
 * `id_token` as the bearer token to match.
 *
 * Built lazily for the same reason as Poster Walls Editor: eager
 * construction would call CognitoJwtVerifier.create() with an empty pool ID
 * whenever a test injects its own `verify` and never exercises this path.
 */
export function cognitoVerifier(): TokenVerifier {
  let verifier: ReturnType<typeof buildVerifier> | undefined;

  function buildVerifier() {
    return CognitoJwtVerifier.create({
      userPoolId: process.env.USER_POOL_ID ?? '',
      tokenUse: 'id',
      clientId: process.env.USER_POOL_CLIENT_ID ?? '',
    });
  }

  return async (token) => {
    if (verifier === undefined) {
      try {
        verifier = buildVerifier();
      } catch (err) {
        console.error('failed to construct Cognito verifier', err);
        throw err;
      }
    }
    const payload = await verifier.verify(token);
    const email = payload.email;
    if (typeof email !== 'string') {
      // Self-signup requires a verified email before the pool issues tokens
      // at all, so this should be unreachable — but a missing claim must
      // fail loudly rather than store "undefined" as someone's email.
      throw new Error('ID token has no email claim');
    }
    return { sub: payload.sub, email: email.toLowerCase() };
  };
}
```

- [ ] **Step 5: `api/src/db/client.ts`** — identical to Poster Walls Editor's

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let cached: DynamoDBDocumentClient | undefined;

export function docClient(): DynamoDBDocumentClient {
  cached ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return cached;
}

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (name === undefined || name === '') {
    throw new Error('TABLE_NAME is not set');
  }
  return name;
}

export function resetDocClient(): void {
  cached = undefined;
}
```

- [ ] **Step 6: Install, resolve `@hono/zod-openapi`'s real version, and verify**

```bash
npm install
```
Then open `package-lock.json`, find the resolved version of `@hono/zod-openapi`, and replace `"latest"` in `api/package.json` with that exact `^`-prefixed version (matching the pinning style of every other dependency in the file). Run `npm install` once more so the lockfile reflects the pinned range.

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: fails only on missing modules that later tasks create (`./routes/...`, `./lambda.js`, etc. do not exist yet — but nothing is imported yet, so this should in fact pass cleanly). If it does not pass cleanly, fix the three files above before proceeding.

- [ ] **Step 7: Add `api` to the root tsconfig references**

```json
{
  "files": [],
  "references": [{ "path": "packages/shared" }, { "path": "infrastructure" }, { "path": "api" }]
}
```

- [ ] **Step 8: Commit**

```bash
git add api/package.json api/tsconfig.json api/src/errors.ts api/src/auth.ts api/src/db/client.ts tsconfig.json package-lock.json
git commit -m "feat(api): errors, ID-token auth middleware, DynamoDB client"
```

---

### Task 8: `api` — household and profile persistence

**Files:**
- Create: `api/src/db/households.ts`, `api/src/db/profiles.ts`

**Interfaces:**
- Consumes: `docClient`, `tableName` (Task 7); key builders from `@hhm/shared` (Task 2).
- Produces: `VersionConflictError`; `createHousehold`, `listHouseholdsForUser`, `isMember`, `loadHousehold`, `listMembers`, `renameHousehold`, `deleteHousehold`, `addMember`, `removeMember`; `upsertProfile`, `setLastHousehold`.

- [ ] **Step 1: `api/src/db/households.ts`**

```ts
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { META, householdPk, memberSk, userPk } from '@hhm/shared';
import type { Household, HouseholdSummary, Member } from '@hhm/shared';
import { docClient, tableName } from './client.js';

/** Raised when a conditional write loses — another writer got there first. */
export class VersionConflictError extends Error {
  constructor() {
    super('The household was modified by someone else');
    this.name = 'VersionConflictError';
  }
}

export async function createHousehold(input: {
  creatorSub: string;
  creatorEmail: string;
  name: string;
}): Promise<Household> {
  const now = new Date().toISOString();
  const household: Household = {
    id: crypto.randomUUID(),
    name: input.name,
    createdBy: input.creatorSub,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  // Three items, one transaction: a household never exists without also
  // being a member's household and appearing in the creator's switcher.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(household.id), SK: META, ...household },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: householdPk(household.id),
              SK: memberSk(input.creatorSub),
              sub: input.creatorSub,
              email: input.creatorEmail,
              joinedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              PK: userPk(input.creatorSub),
              SK: householdPk(household.id),
              id: household.id,
              name: household.name,
            },
          },
        },
      ],
    }),
  );

  return household;
}

export async function listHouseholdsForUser(sub: string): Promise<HouseholdSummary[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': userPk(sub), ':sk': 'HH#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({ id: String(i.id), name: String(i.name) }));
}

/** True membership check. Every route scoped to `:hid` calls this first (see middleware/household.ts). */
export async function isMember(householdId: string, sub: string): Promise<boolean> {
  const result = await docClient().send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: memberSk(sub) },
    }),
  );
  return result.Item !== undefined;
}

export async function loadHousehold(householdId: string): Promise<Household | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: META } }),
  );
  if (result.Item === undefined) return null;
  const i = result.Item;
  return {
    id: String(i.id),
    name: String(i.name),
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  };
}

export async function listMembers(householdId: string): Promise<Member[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'MEMBER#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({
    sub: String(i.sub),
    email: String(i.email),
    joinedAt: String(i.joinedAt),
  }));
}

export async function renameHousehold(
  householdId: string,
  name: string,
  expectedVersion: number,
): Promise<Household> {
  try {
    const result = await docClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: householdPk(householdId), SK: META },
        UpdateExpression: 'SET #name = :name, updatedAt = :now, version = :next',
        ConditionExpression: 'version = :expected',
        ExpressionAttributeNames: { '#name': 'name' },
        ExpressionAttributeValues: {
          ':name': name,
          ':now': new Date().toISOString(),
          ':next': expectedVersion + 1,
          ':expected': expectedVersion,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const a = result.Attributes ?? {};
    return {
      id: String(a.id),
      name: String(a.name),
      createdBy: String(a.createdBy),
      createdAt: String(a.createdAt),
      updatedAt: String(a.updatedAt),
      version: Number(a.version),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      throw new VersionConflictError();
    }
    throw err;
  }
}

/** Creator-only restriction is enforced by the caller (routes/households.ts), not here. */
export async function deleteHousehold(householdId: string): Promise<void> {
  const members = await listMembers(householdId);
  const items = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': householdPk(householdId) },
    }),
  );

  const itemDeletions = (items.Items ?? []).map((item) =>
    docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } })),
  );
  const membershipDeletions = members.map((m) =>
    docClient().send(
      new DeleteCommand({ TableName: tableName(), Key: { PK: userPk(m.sub), SK: householdPk(householdId) } }),
    ),
  );

  await Promise.all([...itemDeletions, ...membershipDeletions]);
}

export async function addMember(householdId: string, sub: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  const household = await loadHousehold(householdId);
  if (household === null) throw new Error(`household ${householdId} does not exist`);

  // Member + membership, transactionally — the pairing invariant applies to
  // every write that adds someone, not only to household creation.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(householdId), SK: memberSk(sub), sub, email, joinedAt: now },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: { PK: userPk(sub), SK: householdPk(householdId), id: householdId, name: household.name },
          },
        },
      ],
    }),
  );
}

export async function removeMember(householdId: string, sub: string): Promise<void> {
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: memberSk(sub) } } },
        { Delete: { TableName: tableName(), Key: { PK: userPk(sub), SK: householdPk(householdId) } } },
      ],
    }),
  );
}
```

- [ ] **Step 2: `api/src/db/profiles.ts`**

```ts
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PROFILE, userPk } from '@hhm/shared';
import type { Profile } from '@hhm/shared';
import { docClient, tableName } from './client.js';

/**
 * Called on every `GET /me`. Idempotent: `if_not_exists` means an existing
 * `lastHouseholdId` is never clobbered by a routine profile touch.
 */
export async function upsertProfile(sub: string, email: string): Promise<Profile> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression:
        'SET sub = :sub, email = :email, lastHouseholdId = if_not_exists(lastHouseholdId, :null)',
      ExpressionAttributeValues: { ':sub': sub, ':email': email, ':null': null },
    }),
  );
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: userPk(sub), SK: PROFILE } }),
  );
  const i = result.Item ?? {};
  return {
    sub: String(i.sub ?? sub),
    email: String(i.email ?? email),
    lastHouseholdId: (i.lastHouseholdId as string | null | undefined) ?? null,
  };
}

export async function setLastHousehold(sub: string, householdId: string): Promise<void> {
  await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: PROFILE },
      UpdateExpression: 'SET lastHouseholdId = :id',
      ExpressionAttributeValues: { ':id': householdId },
    }),
  );
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/households.ts api/src/db/profiles.ts
git commit -m "feat(api): household, membership, and profile persistence"
```

---

### Task 9: `api` — invite and board persistence

**Files:**
- Create: `api/src/db/invites.ts`, `api/src/db/boards.ts`

**Interfaces:**
- Consumes: `addMember` (Task 8); `boardType` from `@hhm/shared` (Task 2); `ApiError` (Task 7).
- Produces: `createInvite`, `listInvites`, `revokeInvite`, `claimInvites`; `createBoard`, `listBoards`, `loadBoard`, `renameBoard`, `deleteBoard`.

- [ ] **Step 1: `api/src/db/invites.ts`**

```ts
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { householdInviteSk, householdPk, invitePk, normalizeEmail } from '@hhm/shared';
import type { Invite } from '@hhm/shared';
import { docClient, tableName } from './client.js';
import { addMember } from './households.js';

export async function createInvite(householdId: string, email: string): Promise<Invite> {
  const normalized = normalizeEmail(email);
  const now = new Date().toISOString();

  // Both directions written together: "pending invites for this household"
  // and "pending invites for this email" must always agree, or claiming
  // could see one without the other.
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { PK: householdPk(householdId), SK: householdInviteSk(normalized), email: normalized, invitedAt: now },
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: { PK: invitePk(normalized), SK: householdPk(householdId), householdId, invitedAt: now },
          },
        },
      ],
    }),
  );

  return { householdId, email: normalized, invitedAt: now };
}

export async function listInvites(householdId: string): Promise<Invite[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'INVITE#' },
    }),
  );
  return (result.Items ?? []).map((i) => ({
    householdId,
    email: String(i.email),
    invitedAt: String(i.invitedAt),
  }));
}

export async function revokeInvite(householdId: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  await docClient().send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: householdInviteSk(normalized) } } },
        { Delete: { TableName: tableName(), Key: { PK: invitePk(normalized), SK: householdPk(householdId) } } },
      ],
    }),
  );
}

/**
 * Converts every pending invite for this email into membership.
 *
 * Called from `GET /me` on every request (routes/me.ts) — this is what lets
 * someone be invited before they have an account. They sign up, and the
 * next time they load the app the household is simply there.
 */
export async function claimInvites(sub: string, email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': invitePk(normalized) },
    }),
  );

  for (const invite of result.Items ?? []) {
    const householdId = String(invite.householdId);
    await addMember(householdId, sub, normalized);
    await docClient().send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: tableName(), Key: { PK: householdPk(householdId), SK: householdInviteSk(normalized) } } },
          { Delete: { TableName: tableName(), Key: { PK: invitePk(normalized), SK: householdPk(householdId) } } },
        ],
      }),
    );
  }
}
```

- [ ] **Step 2: `api/src/db/boards.ts`**

```ts
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { boardSk, boardType, householdPk } from '@hhm/shared';
import type { Board } from '@hhm/shared';
import { ApiError } from '../errors.js';
import { docClient, tableName } from './client.js';

function fromItem(i: Record<string, unknown>): Board {
  return {
    id: String(i.id),
    householdId: String(i.householdId),
    type: String(i.type),
    title: String(i.title),
    position: Number(i.position),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
  };
}

export async function createBoard(input: { householdId: string; type: string; title: string }): Promise<Board> {
  // The registry is the single source of truth for what a board can be.
  // Rejecting an unknown type here is what stops a client from creating a
  // board no UI or route can ever render. In phase 1 the registry is empty,
  // so every create fails until phase 2 registers "tasks" — that is expected.
  if (boardType(input.type) === undefined) {
    throw new ApiError(400, 'unknown_board_type', `No board type "${input.type}" is registered`);
  }

  const now = new Date().toISOString();
  const existing = await listBoards(input.householdId);
  const board: Board = {
    id: crypto.randomUUID(),
    householdId: input.householdId,
    type: input.type,
    title: input.title,
    position: existing.length,
    createdAt: now,
    updatedAt: now,
  };

  await docClient().send(
    new PutCommand({ TableName: tableName(), Item: { PK: householdPk(input.householdId), SK: boardSk(board.id), ...board } }),
  );

  return board;
}

export async function listBoards(householdId: string): Promise<Board[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': 'BOARD#' },
    }),
  );
  // A board's own item has SK "BOARD#<id>" — exactly one '#'. Items a board
  // type stores beneath it (e.g. phase 2's "BOARD#<id>#TASK#<id>") share the
  // prefix but have more, so they are filtered out here.
  return (result.Items ?? [])
    .filter((i) => String(i.SK).split('#').length === 2)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map(fromItem);
}

export async function loadBoard(householdId: string, boardId: string): Promise<Board | null> {
  const result = await docClient().send(
    new GetCommand({ TableName: tableName(), Key: { PK: householdPk(householdId), SK: boardSk(boardId) } }),
  );
  return result.Item === undefined ? null : fromItem(result.Item);
}

export async function renameBoard(householdId: string, boardId: string, title: string): Promise<Board | null> {
  const existing = await loadBoard(householdId, boardId);
  if (existing === null) return null;

  const result = await docClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: householdPk(householdId), SK: boardSk(boardId) },
      UpdateExpression: 'SET title = :title, updatedAt = :now',
      ExpressionAttributeValues: { ':title': title, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return fromItem(result.Attributes ?? {});
}

export async function deleteBoard(householdId: string, boardId: string): Promise<boolean> {
  const existing = await loadBoard(householdId, boardId);
  if (existing === null) return false;

  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': householdPk(householdId), ':sk': boardSk(boardId) },
    }),
  );

  // Deletes the board item and everything a board type stored beneath it —
  // a board type never has to clean up after itself when its board is
  // removed (spec §5).
  await Promise.all(
    (result.Items ?? []).map((item) =>
      docClient().send(new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } })),
    ),
  );
  return true;
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/invites.ts api/src/db/boards.ts
git commit -m "feat(api): invite claiming and generic board persistence"
```

---

### Task 10: `api` — membership middleware and `/me` route

**Files:**
- Create: `api/src/middleware/household.ts`, `api/src/routes/me.ts`

**Interfaces:**
- Consumes: `isMember` (Task 8), `AuthedEnv` (Task 7).
- Produces: `HouseholdEnv`, `requireMembership()`; `MeDb`, `defaultMeDb`, `registerMeRoutes`.

- [ ] **Step 1: `api/src/middleware/household.ts`**

```ts
import { createMiddleware } from 'hono/factory';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { isMember } from '../db/households.js';

export type HouseholdEnv = AuthedEnv & { Variables: { householdId: string } };

/**
 * Resolves `:hid` and confirms the caller belongs to it.
 *
 * Reads the raw path param, not `c.req.valid('param')` — this runs as
 * Hono `.use()` middleware ahead of `@hono/zod-openapi`'s own per-route
 * parameter validation, so the validated form is not available here yet.
 *
 * Failure is 404, never 403: a household a stranger does not belong to must
 * look identical to one that does not exist, so IDs cannot be probed.
 */
export function requireMembership(checkMembership: typeof isMember = isMember) {
  return createMiddleware<HouseholdEnv>(async (c, next) => {
    const householdId = c.req.param('hid');
    const { sub } = c.get('user');
    if (!(await checkMembership(householdId, sub))) {
      throw new ApiError(404, 'not_found', 'Not found');
    }
    c.set('householdId', householdId);
    await next();
  });
}
```

- [ ] **Step 2: `api/src/routes/me.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, MeResponseSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { claimInvites } from '../db/invites.js';
import { listHouseholdsForUser } from '../db/households.js';
import { setLastHousehold, upsertProfile } from '../db/profiles.js';

export interface MeDb {
  claimInvites: typeof claimInvites;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  upsertProfile: typeof upsertProfile;
  setLastHousehold: typeof setLastHousehold;
}

export const defaultMeDb: MeDb = { claimInvites, listHouseholdsForUser, upsertProfile, setLastHousehold };

const getMeRoute = createRoute({
  method: 'get',
  path: '/v1/me',
  security: [{ Bearer: [] }],
  responses: {
    200: { content: { 'application/json': { schema: MeResponseSchema } }, description: 'The caller, their households, and their last-visited one' },
  },
});

const putLastHouseholdRoute = createRoute({
  method: 'put',
  path: '/v1/me/last-household',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: z.object({ householdId: IdSchema }) } } } },
  responses: { 204: { description: 'Remembered' } },
});

export function registerMeRoutes(app: OpenAPIHono<AuthedEnv>, db: MeDb): void {
  app.openapi(getMeRoute, async (c) => {
    const { sub, email } = c.get('user');
    // Must run before households are listed — otherwise an invite claimed
    // moments ago would not show up until the NEXT request.
    await db.claimInvites(sub, email);
    const profile = await db.upsertProfile(sub, email);
    const households = await db.listHouseholdsForUser(sub);
    return c.json({ sub, email: profile.email, lastHouseholdId: profile.lastHouseholdId, households }, 200);
  });

  app.openapi(putLastHouseholdRoute, async (c) => {
    const { sub } = c.get('user');
    const { householdId } = c.req.valid('json');
    await db.setLastHousehold(sub, householdId);
    return c.body(null, 204);
  });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/middleware/household.ts api/src/routes/me.ts
git commit -m "feat(api): membership middleware and /me (with invite claiming)"
```

---

### Task 11: `api` — household and member routes

**Files:**
- Create: `api/src/routes/households.ts`, `api/src/routes/members.ts`

**Interfaces:**
- Consumes: Task 8's household db functions; `ApiError`.
- Produces: `HouseholdDb`, `defaultHouseholdDb`, `registerHouseholdRoutes`; `MemberDb`, `defaultMemberDb`, `registerMemberRoutes`.

- [ ] **Step 1: `api/src/routes/households.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateHouseholdSchema, HouseholdSchema, IdSchema, UpdateHouseholdSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import {
  VersionConflictError,
  createHousehold,
  deleteHousehold,
  listHouseholdsForUser,
  loadHousehold,
  renameHousehold,
} from '../db/households.js';

export interface HouseholdDb {
  createHousehold: typeof createHousehold;
  listHouseholdsForUser: typeof listHouseholdsForUser;
  loadHousehold: typeof loadHousehold;
  renameHousehold: typeof renameHousehold;
  deleteHousehold: typeof deleteHousehold;
}

export const defaultHouseholdDb: HouseholdDb = {
  createHousehold,
  listHouseholdsForUser,
  loadHousehold,
  renameHousehold,
  deleteHousehold,
};

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households',
  security: [{ Bearer: [] }],
  responses: {
    200: { content: { 'application/json': { schema: z.object({ households: z.array(HouseholdSchema) }) } }, description: 'Households the caller belongs to' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households',
  security: [{ Bearer: [] }],
  request: { body: { content: { 'application/json': { schema: CreateHouseholdSchema } } } },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'Created' },
  },
});

const getRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'OK' },
    404: { description: 'Not found' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateHouseholdSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ household: HouseholdSchema }) } }, description: 'Updated' },
    409: { description: 'Version conflict' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: { 204: { description: 'Deleted' }, 403: { description: 'Only the creator may delete a household' } },
});

export function registerHouseholdRoutes(app: OpenAPIHono<AuthedEnv>, db: HouseholdDb): void {
  app.openapi(listRoute, async (c) => {
    const { sub } = c.get('user');
    const summaries = await db.listHouseholdsForUser(sub);
    const full = await Promise.all(summaries.map((h) => db.loadHousehold(h.id)));
    return c.json({ households: full.filter((h): h is NonNullable<typeof h> => h !== null) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { sub, email } = c.get('user');
    const body = c.req.valid('json');
    const household = await db.createHousehold({ creatorSub: sub, creatorEmail: email, name: body.name });
    return c.json({ household }, 201);
  });

  app.openapi(getRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const household = await db.loadHousehold(hid);
    if (household === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ household }, 200);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const body = c.req.valid('json');
    try {
      const household = await db.renameHousehold(hid, body.name, body.version);
      return c.json({ household }, 200);
    } catch (err) {
      if (err instanceof VersionConflictError) throw new ApiError(409, 'version_conflict', err.message);
      throw err;
    }
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid } = c.req.valid('param');
    const { sub } = c.get('user');
    const household = await db.loadHousehold(hid);
    if (household === null) throw new ApiError(404, 'not_found', 'Not found');
    // The one asymmetry in an otherwise equal-rights household — spec's
    // Non-goals section.
    if (household.createdBy !== sub) {
      throw new ApiError(403, 'forbidden', 'Only the creator may delete this household');
    }
    await db.deleteHousehold(hid);
    return c.body(null, 204);
  });
}
```

- [ ] **Step 2: `api/src/routes/members.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { IdSchema, MemberSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { listMembers, loadHousehold, removeMember } from '../db/households.js';

export interface MemberDb {
  listMembers: typeof listMembers;
  loadHousehold: typeof loadHousehold;
  removeMember: typeof removeMember;
}

export const defaultMemberDb: MemberDb = { listMembers, loadHousehold, removeMember };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/members',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ members: z.array(MemberSchema) }) } }, description: 'Members' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/members/{sub}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, sub: z.string() }) },
  responses: { 204: { description: 'Removed' }, 403: { description: 'The creator cannot be removed' } },
});

export function registerMemberRoutes(app: OpenAPIHono<AuthedEnv>, db: MemberDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    return c.json({ members: await db.listMembers(hid) }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, sub } = c.req.valid('param');
    const household = await db.loadHousehold(hid);
    // A member removing themselves IS "leaving" — same endpoint, same rule:
    // the creator cannot be removed, since deletion rights are tied to that
    // identity and a household must always have someone who can delete it.
    if (household !== null && household.createdBy === sub) {
      throw new ApiError(403, 'forbidden', 'The creator cannot be removed from the household');
    }
    await db.removeMember(hid, sub);
    return c.body(null, 204);
  });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/households.ts api/src/routes/members.ts
git commit -m "feat(api): household CRUD and member routes"
```

---

### Task 12: `api` — invite and board routes

**Files:**
- Create: `api/src/routes/invites.ts`, `api/src/routes/boards.ts`

**Interfaces:**
- Consumes: Task 9's invite/board db functions.
- Produces: `InviteDb`, `defaultInviteDb`, `registerInviteRoutes`; `BoardDb`, `defaultBoardDb`, `registerBoardRoutes`.

- [ ] **Step 1: `api/src/routes/invites.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CreateInviteSchema, IdSchema, InviteSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { createInvite, listInvites, revokeInvite } from '../db/invites.js';

export interface InviteDb {
  createInvite: typeof createInvite;
  listInvites: typeof listInvites;
  revokeInvite: typeof revokeInvite;
}

export const defaultInviteDb: InviteDb = { createInvite, listInvites, revokeInvite };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/invites',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ invites: z.array(InviteSchema) }) } }, description: 'Pending invites' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/invites',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: CreateInviteSchema } } },
  },
  responses: { 201: { content: { 'application/json': { schema: z.object({ invite: InviteSchema }) } }, description: 'Invited' } },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/invites/{email}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, email: z.string() }) },
  responses: { 204: { description: 'Revoked' } },
});

export function registerInviteRoutes(app: OpenAPIHono<AuthedEnv>, db: InviteDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    return c.json({ invites: await db.listInvites(hid) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { hid } = c.req.valid('param');
    const { email } = c.req.valid('json');
    const invite = await db.createInvite(hid, email);
    return c.json({ invite }, 201);
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, email } = c.req.valid('param');
    // Path segments are percent-encoded — an invited email like
    // "a+b@example.com" arrives as "a%2Bb%40example.com".
    await db.revokeInvite(hid, decodeURIComponent(email));
    return c.body(null, 204);
  });
}
```

- [ ] **Step 2: `api/src/routes/boards.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { BoardSchema, CreateBoardSchema, IdSchema, UpdateBoardSchema } from '@hhm/shared';
import type { AuthedEnv } from '../auth.js';
import { ApiError } from '../errors.js';
import { createBoard, deleteBoard, listBoards, renameBoard } from '../db/boards.js';

export interface BoardDb {
  createBoard: typeof createBoard;
  listBoards: typeof listBoards;
  renameBoard: typeof renameBoard;
  deleteBoard: typeof deleteBoard;
}

export const defaultBoardDb: BoardDb = { createBoard, listBoards, renameBoard, deleteBoard };

const listRoute = createRoute({
  method: 'get',
  path: '/v1/households/{hid}/boards',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema }) },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ boards: z.array(BoardSchema) }) } }, description: 'Boards, in display order' },
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/v1/households/{hid}/boards',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema }),
    body: { content: { 'application/json': { schema: CreateBoardSchema } } },
  },
  responses: {
    201: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'Created' },
    400: { description: 'Unknown board type' },
  },
});

const patchRoute = createRoute({
  method: 'patch',
  path: '/v1/households/{hid}/boards/{bid}',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({ hid: IdSchema, bid: IdSchema }),
    body: { content: { 'application/json': { schema: UpdateBoardSchema } } },
  },
  responses: {
    200: { content: { 'application/json': { schema: z.object({ board: BoardSchema }) } }, description: 'Updated' },
    404: { description: 'Not found' },
  },
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/v1/households/{hid}/boards/{bid}',
  security: [{ Bearer: [] }],
  request: { params: z.object({ hid: IdSchema, bid: IdSchema }) },
  responses: { 204: { description: 'Deleted' }, 404: { description: 'Not found' } },
});

export function registerBoardRoutes(app: OpenAPIHono<AuthedEnv>, db: BoardDb): void {
  app.openapi(listRoute, async (c) => {
    const { hid } = c.req.valid('param');
    return c.json({ boards: await db.listBoards(hid) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { hid } = c.req.valid('param');
    const body = c.req.valid('json');
    const board = await db.createBoard({ householdId: hid, type: body.type, title: body.title });
    return c.json({ board }, 201);
  });

  app.openapi(patchRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const board = await db.renameBoard(hid, bid, title);
    if (board === null) throw new ApiError(404, 'not_found', 'Not found');
    return c.json({ board }, 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { hid, bid } = c.req.valid('param');
    const deleted = await db.deleteBoard(hid, bid);
    if (!deleted) throw new ApiError(404, 'not_found', 'Not found');
    return c.body(null, 204);
  });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/invites.ts api/src/routes/boards.ts
git commit -m "feat(api): invite and generic board routes"
```

---

### Task 13: `api` — app assembly, Lambda handler, dev server

**Files:**
- Create: `api/src/app.ts`, `api/src/lambda.ts`, `api/src/dev-server.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–12.
- Produces: `createApp(deps?: AppDeps): OpenAPIHono<AuthedEnv>`, `handler` (Lambda entry). **This is the task where `cdk synth` first succeeds end to end.**

- [ ] **Step 1: `api/src/app.ts`**

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { type AuthedEnv, cognitoVerifier, createAuthMiddleware, type TokenVerifier } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { requireMembership } from './middleware/household.js';
import { type MeDb, defaultMeDb, registerMeRoutes } from './routes/me.js';
import { type HouseholdDb, defaultHouseholdDb, registerHouseholdRoutes } from './routes/households.js';
import { type InviteDb, defaultInviteDb, registerInviteRoutes } from './routes/invites.js';
import { type MemberDb, defaultMemberDb, registerMemberRoutes } from './routes/members.js';
import { type BoardDb, defaultBoardDb, registerBoardRoutes } from './routes/boards.js';

export interface AppDeps {
  /** Injected in local/manual testing; production builds the Cognito verifier lazily. */
  verify?: TokenVerifier;
  meDb?: MeDb;
  householdDb?: HouseholdDb;
  inviteDb?: InviteDb;
  memberDb?: MemberDb;
  boardDb?: BoardDb;
}

export function createApp(deps: AppDeps = {}): OpenAPIHono<AuthedEnv> {
  const app = new OpenAPIHono<AuthedEnv>({
    // @hono/zod-openapi validates request bodies/params BEFORE the handler
    // runs, so a Zod failure never reaches errorHandler's ZodError branch —
    // this hook is where it is caught instead, kept in the same shape.
    defaultHook: (result, c) => {
      if (!result.success) {
        console.error('validation error', result.error.issues);
        return c.json({ error: { code: 'validation_error', message: 'Invalid request' } }, 400);
      }
    },
  });

  app.use('*', cors({
    origin: (origin) => process.env.WEB_ORIGIN ?? origin,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
  }));

  app.get('/health', (c) => c.json({ status: 'ok' }));

  const verify = deps.verify ?? cognitoVerifier();
  const requireAuth = createAuthMiddleware(verify);

  // NOTE: `.use()` is plain Hono, so its path uses Hono's `:param` syntax —
  // `createRoute({ path })` inside the route modules above uses OpenAPI's
  // `{param}` syntax instead. They are not interchangeable.
  app.use('/v1/me', requireAuth);
  app.use('/v1/me/*', requireAuth);
  app.use('/v1/households', requireAuth);
  app.use('/v1/households/:hid', requireAuth, requireMembership());
  app.use('/v1/households/:hid/*', requireAuth, requireMembership());

  registerMeRoutes(app, deps.meDb ?? defaultMeDb);
  registerHouseholdRoutes(app, deps.householdDb ?? defaultHouseholdDb);
  registerInviteRoutes(app, deps.inviteDb ?? defaultInviteDb);
  registerMemberRoutes(app, deps.memberDb ?? defaultMemberDb);
  registerBoardRoutes(app, deps.boardDb ?? defaultBoardDb);

  // The API-first contract (spec's Goals): a machine-readable document a
  // future native client can generate against without touching this repo.
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'household-manager API', version: '1.0.0' },
  });

  app.notFound(notFound);
  app.onError(errorHandler);

  return app;
}
```

- [ ] **Step 2: `api/src/lambda.ts`**

```ts
import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';

export const handler = handle(createApp());
```

- [ ] **Step 3: `api/src/dev-server.ts`**

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

/**
 * Runs the same Hono app the Lambda runs, on a local port, against the REAL
 * Cognito pool and DynamoDB table — so local behaviour matches deployed
 * behaviour exactly.
 */
const port = Number(process.env.PORT ?? 8787);

const required = ['TABLE_NAME', 'USER_POOL_ID', 'USER_POOL_CLIENT_ID'] as const;
const missing = required.filter((k) => (process.env[k] ?? '') === '');

if (missing.length > 0) {
  console.error(
    `Missing ${missing.join(', ')}.\nRun \`npm run dev:env\` first — it reads the values from CloudFormation and writes .env.local.`,
  );
  process.exit(1);
}

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`api    http://localhost:${info.port}`);
});
```

- [ ] **Step 4: Add `@hono/node-server` build dep check and verify the whole API typechecks**

```bash
npx tsc -p api/tsconfig.json --noEmit
```
Expected: passes cleanly.

- [ ] **Step 5: Verify `cdk synth` now succeeds end to end**

```bash
cd infrastructure && npx cdk synth --quiet
```
Expected: exits 0. This is the real gate Task 6 deferred — if this fails, the error is almost certainly in how `NodejsFunction` resolves `api/src/lambda.ts`'s dependencies (esbuild bundling), not in application logic already verified by `tsc`.

- [ ] **Step 6: Commit**

```bash
git add api/src/app.ts api/src/lambda.ts api/src/dev-server.ts
git commit -m "feat(api): assemble the app, Lambda handler, and dev server"
```

---

### Task 14: `app` — scaffold, config, auth

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/index.html`, `app/.env.example`
- Create: `app/src/config.ts`, `app/src/auth/oidc.ts`, `app/src/auth/AuthProvider.tsx`, `app/src/components/RequireAuth.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getConfig()`, `userManager`, `AuthProvider`/`useAuth()` (exposing `bearerToken`, not `accessToken`), `RequireAuth`.

- [ ] **Step 1: `app/package.json`**

```json
{
  "name": "@hhm/app",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@hhm/shared": "*",
    "@tanstack/react-query": "^5.101.4",
    "oidc-client-ts": "^3.5.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router": "^8.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.4",
    "vite": "^8.1.5"
  }
}
```

- [ ] **Step 2: `app/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true,
    "composite": false,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: `app/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
});
```

- [ ] **Step 4: `app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>household-manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `app/.env.example`**

```
VITE_API_URL=
VITE_COGNITO_DOMAIN=
VITE_USER_POOL_CLIENT_ID=
```

- [ ] **Step 6: `app/src/config.ts`**

```ts
export interface AppConfig {
  apiUrl: string;
  cognitoDomain: string;
  userPoolClientId: string;
  redirectUri: string;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. It is injected at build time from CloudFormation outputs; for local dev copy app/.env.example to app/.env.local and fill it in.`,
    );
  }
  return value;
}

export function loadConfig(origin: string): AppConfig {
  const env = import.meta.env;
  return {
    apiUrl: required('VITE_API_URL', env.VITE_API_URL).replace(/\/$/, ''),
    cognitoDomain: required('VITE_COGNITO_DOMAIN', env.VITE_COGNITO_DOMAIN).replace(/\/$/, ''),
    userPoolClientId: required('VITE_USER_POOL_CLIENT_ID', env.VITE_USER_POOL_CLIENT_ID),
    redirectUri: `${origin}/callback`,
  };
}

let cached: AppConfig | null = null;

/** Resolved lazily — a module-level call would run under vitest's node environment, where `window` does not exist. */
export function getConfig(): AppConfig {
  cached ??= loadConfig(window.location.origin);
  return cached;
}
```

- [ ] **Step 7: `app/src/auth/oidc.ts`**

```ts
import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { getConfig } from '../config.js';

const config = getConfig();

export const userManager = new UserManager({
  authority: config.cognitoDomain,
  // Cognito does not serve OIDC discovery at the Hosted UI domain, so the
  // endpoints are declared explicitly.
  metadata: {
    issuer: config.cognitoDomain,
    authorization_endpoint: `${config.cognitoDomain}/oauth2/authorize`,
    token_endpoint: `${config.cognitoDomain}/oauth2/token`,
    userinfo_endpoint: `${config.cognitoDomain}/oauth2/userInfo`,
    end_session_endpoint: `${config.cognitoDomain}/logout`,
  },
  client_id: config.userPoolClientId,
  redirect_uri: config.redirectUri,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid email profile',
  userStore: new WebStorageStateStore({ store: window.localStorage }),
});
```

- [ ] **Step 8: `app/src/auth/AuthProvider.tsx`** — exposes `bearerToken` (the ID token), not `accessToken`; see the comment in `api/src/auth.ts` (Task 7) for why

```tsx
import type { User } from 'oidc-client-ts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { userManager } from './oidc.js';

type Status = 'loading' | 'signed-in' | 'signed-out';

interface AuthValue {
  user: User | null;
  /** The ID token, sent as the API's bearer token — see api/src/auth.ts. */
  bearerToken: string | null;
  status: Status;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let cancelled = false;

    function applyUser(found: User | null) {
      if (cancelled) return;
      const signedIn = found !== null && !found.expired;
      setUser(signedIn ? found : null);
      setStatus(signedIn ? 'signed-in' : 'signed-out');
    }

    function onUserLoaded(loadedUser: User) {
      applyUser(loadedUser);
    }
    function onUserUnloaded() {
      applyUser(null);
    }
    function onSilentRenewError(err: Error) {
      console.error('silent token renewal failed', err);
      applyUser(null);
    }

    userManager.events.addUserLoaded(onUserLoaded);
    userManager.events.addUserUnloaded(onUserUnloaded);
    userManager.events.addSilentRenewError(onSilentRenewError);

    userManager
      .getUser()
      .then(applyUser)
      .catch(() => {
        if (!cancelled) setStatus('signed-out');
      });

    return () => {
      cancelled = true;
      userManager.events.removeUserLoaded(onUserLoaded);
      userManager.events.removeUserUnloaded(onUserUnloaded);
      userManager.events.removeSilentRenewError(onSilentRenewError);
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      bearerToken: user?.id_token ?? null,
      status,
      signIn: () => userManager.signinRedirect(),
      signOut: () => userManager.signoutRedirect(),
    }),
    [user, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 9: `app/src/components/RequireAuth.tsx`**

```tsx
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider.js';

/** Holds a route until the session is known — see Poster Walls Editor's identical component for why. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, signIn } = useAuth();

  if (status === 'loading') {
    return <p className="notice">Restoring your session…</p>;
  }

  if (status === 'signed-out') {
    return (
      <div className="gate">
        <h1>Sign in to continue</h1>
        <button type="button" className="btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 10: Install and verify**

```bash
npm install
npx tsc -p app/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 11: Commit**

```bash
git add app/package.json app/tsconfig.json app/vite.config.ts app/index.html app/.env.example app/src/config.ts app/src/auth app/src/components/RequireAuth.tsx package-lock.json
git commit -m "feat(app): scaffold, config, and ID-token auth"
```

---

### Task 15: `app` — API client and data hooks

**Files:**
- Create: `app/src/api/client.ts`, `app/src/api/queries.ts`

**Interfaces:**
- Consumes: `getConfig`, `useAuth` (Task 14).
- Produces: `apiFetch<T>()`, `ApiError`; `useMe`, `useSetLastHousehold`, `useHouseholds`, `useCreateHousehold`, `useDeleteHousehold`, `useBoards`, `useCreateBoard`.

- [ ] **Step 1: `app/src/api/client.ts`** — identical shape to Poster Walls Editor's, parameter renamed to `bearerToken` for clarity

```ts
import { getConfig } from '../config.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

export async function apiFetch<T>(path: string, bearerToken: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getConfig().apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${bearerToken}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });

  if (!res.ok) {
    let code = 'request_failed';
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as ErrorBody;
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // keep the defaults
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 2: `app/src/api/queries.ts`**

```ts
import type { Board, CreateHousehold, Household, MeResponse } from '@hhm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider.js';
import { apiFetch } from './client.js';

/** The bearer token, or null while the session is still being restored. Never throws — see Poster Walls Editor's identical pattern. */
function useToken(): string | null {
  return useAuth().bearerToken;
}

function required(token: string | null): string {
  if (token === null) throw new Error('Not signed in');
  return token;
}

export const queryKeys = {
  me: ['me'] as const,
  households: ['households'] as const,
  boards: (householdId: string) => ['households', householdId, 'boards'] as const,
};

export function useMe() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.me,
    enabled: token !== null,
    queryFn: () => apiFetch<MeResponse>('/v1/me', token!),
  });
}

export function useSetLastHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (householdId: string) =>
      apiFetch<void>('/v1/me/last-household', required(token), {
        method: 'PUT',
        body: JSON.stringify({ householdId }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useHouseholds() {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.households,
    enabled: token !== null,
    queryFn: () => apiFetch<{ households: Household[] }>('/v1/households', token!),
  });
}

export function useCreateHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHousehold) =>
      apiFetch<{ household: Household }>('/v1/households', required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.households });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useDeleteHousehold() {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (householdId: string) =>
      apiFetch<void>(`/v1/households/${householdId}`, required(token), { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.households });
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useBoards(householdId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: queryKeys.boards(householdId ?? ''),
    enabled: token !== null && householdId !== null,
    queryFn: () => apiFetch<{ boards: Board[] }>(`/v1/households/${householdId}/boards`, token!),
  });
}

export function useCreateBoard(householdId: string) {
  const token = useToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { type: string; title: string }) =>
      apiFetch<{ board: Board }>(`/v1/households/${householdId}/boards`, required(token), {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.boards(householdId) }),
  });
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p app/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add app/src/api
git commit -m "feat(app): API client and household/board data hooks"
```

---

### Task 16: `app` — board registry, switcher, masthead

**Files:**
- Create: `app/src/boards/registry.tsx`
- Create: `app/src/components/HouseholdSwitcher.tsx`, `app/src/components/Masthead.tsx`

**Interfaces:**
- Consumes: `useHouseholds`, `useMe`, `useSetLastHousehold` (Task 15).
- Produces: `BoardTypeUi`, `registerBoardTypeUi`, `boardTypeUi` (the app-side mirror of `@hhm/shared`'s type registry); `HouseholdSwitcher`; `Masthead`.

- [ ] **Step 1: `app/src/boards/registry.tsx`**

```tsx
import type { Board } from '@hhm/shared';
import type { ComponentType } from 'react';

/** The app-side half of the board-type registry (spec §5). `@hhm/shared`'s registry names what a type IS; this one names how it renders. */
export interface BoardTypeUi {
  Card: ComponentType<{ board: Board }>;
  Page: ComponentType<{ board: Board }>;
}

const registry = new Map<string, BoardTypeUi>();

/** Called once per board type's own module — e.g. `boards/tasks/index.tsx` in phase 2. Never called from here. */
export function registerBoardTypeUi(type: string, ui: BoardTypeUi): void {
  registry.set(type, ui);
}

export function boardTypeUi(type: string): BoardTypeUi | undefined {
  return registry.get(type);
}
```

- [ ] **Step 2: `app/src/components/HouseholdSwitcher.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useMe, useHouseholds, useSetLastHousehold } from '../api/queries.js';

interface HouseholdSwitcherProps {
  selectedId: string | null;
  onChange: (householdId: string) => void;
}

/**
 * Defaults to `lastHouseholdId` from the profile, then writes back on
 * change (spec §10). The parent owns `selectedId` so a page reload or a
 * direct link can override the default without this component knowing why.
 */
export function HouseholdSwitcher({ selectedId, onChange }: HouseholdSwitcherProps) {
  const { data: me } = useMe();
  const { data: householdsData, isLoading } = useHouseholds();
  const setLastHousehold = useSetLastHousehold();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || me === undefined) return;
    const fallback = me.lastHouseholdId ?? me.households[0]?.id ?? null;
    if (fallback !== null) onChange(fallback);
    setInitialized(true);
  }, [initialized, me, onChange]);

  if (isLoading) return null;

  const households = householdsData?.households ?? [];
  if (households.length === 0) return null;

  return (
    <select
      className="household-switcher"
      value={selectedId ?? ''}
      onChange={(e) => {
        const id = e.target.value;
        onChange(id);
        setLastHousehold.mutate(id);
      }}
    >
      {households.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: `app/src/components/Masthead.tsx`** — wraps its route content rather than sitting beside it, so `main.tsx` (Task 17) can nest `<Routes>` inside a single top-level component

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.js';
import { HouseholdSwitcher } from './HouseholdSwitcher.js';

interface MastheadProps {
  selectedHouseholdId: string | null;
  onSelectHousehold: (id: string) => void;
  children: ReactNode;
}

export function Masthead({ selectedHouseholdId, onSelectHousehold, children }: MastheadProps) {
  const { status, signOut } = useAuth();

  return (
    <>
      <header className="masthead">
        <Link to="/">household-manager</Link>
        {status === 'signed-in' && (
          <HouseholdSwitcher selectedId={selectedHouseholdId} onChange={onSelectHousehold} />
        )}
        <span className="masthead__spacer" />
        {status === 'signed-in' && (
          <button type="button" className="btn-small" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </header>
      {children}
    </>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc -p app/tsconfig.json --noEmit
```
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add app/src/boards app/src/components/HouseholdSwitcher.tsx app/src/components/Masthead.tsx
git commit -m "feat(app): board-type UI registry, household switcher, masthead"
```

---

### Task 17: `app` — dashboard shell, callback route, entry point, styles

**Files:**
- Create: `app/src/routes/Home.tsx`, `app/src/routes/Callback.tsx`, `app/src/main.tsx`, `app/src/styles.css`

**Interfaces:**
- Consumes: everything from Tasks 14–16.
- Produces: the running app. **This is the first task with a browser-visible result.**

- [ ] **Step 1: `app/src/routes/Callback.tsx`**

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { userManager } from '../auth/oidc.js';

export function Callback() {
  const navigate = useNavigate();

  useEffect(() => {
    userManager
      .signinRedirectCallback()
      .then(() => navigate('/', { replace: true }))
      .catch(() => navigate('/', { replace: true }));
  }, [navigate]);

  return <p className="notice">Signing you in…</p>;
}
```

- [ ] **Step 2: `app/src/routes/Home.tsx`** — the dashboard shell: create-household form when there are none, otherwise the board grid for the switcher's current selection

```tsx
import { useState } from 'react';
import { boardTypeUi } from '../boards/registry.js';
import { useAuth } from '../auth/AuthProvider.js';
import { useBoards, useCreateHousehold, useHouseholds, useMe } from '../api/queries.js';

function CreateHouseholdForm() {
  const [name, setName] = useState('');
  const createHousehold = useCreateHousehold();

  return (
    <form
      className="create-household"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() === '') return;
        createHousehold.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
      }}
    >
      <h1>Start a household</h1>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Bridewells" />
      <button type="submit" className="btn-primary" disabled={createHousehold.isPending}>
        Create
      </button>
    </form>
  );
}

function BoardGrid({ householdId }: { householdId: string }) {
  const { data, isLoading } = useBoards(householdId);

  if (isLoading) return <p className="notice">Loading…</p>;

  const boards = data?.boards ?? [];

  if (boards.length === 0) {
    return (
      <div className="empty">
        No boards yet. Board types register themselves — none are available
        until a feature (like Tasks) adds one.
      </div>
    );
  }

  return (
    <div className="cardgrid">
      {boards.map((board) => {
        const ui = boardTypeUi(board.type);
        // A board can exist whose type module never loaded client-side —
        // stale data, or a type removed after boards using it were created.
        // Rendering nothing here would look like a bug; naming it does not.
        if (ui === undefined) {
          return (
            <div key={board.id} className="card card--unknown">
              {board.title} — unknown board type "{board.type}"
            </div>
          );
        }
        return <ui.Card key={board.id} board={board} />;
      })}
    </div>
  );
}

export function Home() {
  const { status, signIn } = useAuth();
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);
  const { data: me } = useMe();
  const { data: householdsData, isLoading: householdsLoading } = useHouseholds();

  if (status === 'loading') return <p className="notice">Loading…</p>;

  if (status === 'signed-out') {
    return (
      <div className="page gate">
        <h1>Household management, shared.</h1>
        <button type="button" className="btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
      </div>
    );
  }

  if (householdsLoading || me === undefined) return <p className="notice">Loading…</p>;

  const households = householdsData?.households ?? [];
  const activeId = selectedHouseholdId ?? me.lastHouseholdId ?? households[0]?.id ?? null;

  if (households.length === 0) {
    return (
      <div className="page">
        <CreateHouseholdForm />
      </div>
    );
  }

  return (
    <div className="page">
      {activeId !== null && <BoardGrid householdId={activeId} />}
      {selectedHouseholdId === null && activeId !== null && (
        // Keeps the masthead's switcher in sync on first render, without a
        // second effect duplicating HouseholdSwitcher's own default logic.
        <span style={{ display: 'none' }} ref={() => setSelectedHouseholdId(activeId)} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: `app/src/main.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider.js';
import { Masthead } from './components/Masthead.js';
import { Callback } from './routes/Callback.js';
import { Home } from './routes/Home.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function App() {
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string | null>(null);

  return (
    <Masthead selectedHouseholdId={selectedHouseholdId} onSelectHousehold={setSelectedHouseholdId}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/callback" element={<Callback />} />
      </Routes>
    </Masthead>
  );
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 4: `app/src/styles.css`** — minimal, mobile-first, functional. Visual polish is explicitly deferred (spec §10 — the `frontend-design` skill applies at that point, not here); this is enough to use and read comfortably on a phone.

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: #1a1a1a;
  background: #fafafa;
}

.masthead {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 52px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  position: sticky;
  top: 0;
}

.masthead a {
  font-weight: 600;
  text-decoration: none;
  color: inherit;
}

.masthead__spacer {
  flex: 1;
}

.household-switcher {
  font-size: 15px;
  padding: 6px 8px;
  max-width: 45vw;
}

.page {
  padding: 16px;
  max-width: 720px;
  margin: 0 auto;
}

.gate {
  text-align: center;
  padding: 48px 16px;
}

.notice {
  padding: 16px;
  text-align: center;
  color: #666;
}

.empty {
  padding: 24px 16px;
  text-align: center;
  color: #666;
  border: 1px dashed #ccc;
  border-radius: 8px;
}

.cardgrid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 600px) {
  .cardgrid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.card {
  padding: 16px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.card--unknown {
  border-style: dashed;
  color: #999;
}

.create-household {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

.create-household input {
  font-size: 16px;
  padding: 10px 12px;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.btn-primary,
.btn-small {
  font-size: 15px;
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
}

.btn-small {
  padding: 6px 12px;
  font-size: 13px;
}
```

- [ ] **Step 5: Verify the whole app typechecks and builds**

```bash
npx tsc -p app/tsconfig.json --noEmit
npm run build --workspace @hhm/app
```
Expected: both exit 0.

- [ ] **Step 6: Manual smoke test against real AWS**

This requires Phase 0 complete and at least one manual `cdk deploy` of `HouseholdManager` (Task 18 covers CI; this is a local check before that exists). If a deploy has not happened yet, skip this step and note it as outstanding — do not fabricate a passing result.

```bash
npm run dev:env    # requires the stack already deployed once, see Task 18
npm run dev
```
Open `http://localhost:5173`, sign in, create a household, confirm the empty-boards message appears.

- [ ] **Step 7: Commit**

```bash
git add app/src/routes app/src/main.tsx app/src/styles.css app/src/components/Masthead.tsx
git commit -m "feat(app): dashboard shell, OIDC callback, entry point, styles"
```

---

### Task 18: CI, deploy workflow, first deploy

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: everything.
- Produces: a working CI gate and an automated deploy pipeline; ends with the first live deploy.

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npx cdk synth --quiet
        working-directory: infrastructure
```

- [ ] **Step 2: `.github/workflows/deploy.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npx cdk synth --quiet
        working-directory: infrastructure

  deploy:
    needs: verify
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Deploy infrastructure
        run: npx cdk deploy HouseholdManager --require-approval never
        working-directory: infrastructure

      - name: Read stack outputs
        id: outputs
        run: |
          read_output() {
            aws cloudformation describe-stacks --stack-name HouseholdManager \
              --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
          }
          {
            echo "api_url=$(read_output ApiUrl)"
            echo "cognito_domain=$(read_output CognitoDomain)"
            echo "client_id=$(read_output UserPoolClientId)"
            echo "web_bucket=$(read_output WebBucketName)"
            echo "distribution_id=$(read_output DistributionId)"
            echo "web_url=$(read_output WebUrl)"
          } >> "$GITHUB_OUTPUT"

      - name: Build SPA
        run: npm run build --workspace @hhm/app
        env:
          VITE_API_URL: ${{ steps.outputs.outputs.api_url }}
          VITE_COGNITO_DOMAIN: ${{ steps.outputs.outputs.cognito_domain }}
          VITE_USER_POOL_CLIENT_ID: ${{ steps.outputs.outputs.client_id }}

      - name: Publish
        run: |
          aws s3 sync app/dist "s3://${{ steps.outputs.outputs.web_bucket }}" --delete
          aws cloudfront create-invalidation \
            --distribution-id "${{ steps.outputs.outputs.distribution_id }}" \
            --paths '/*'

      - name: Summary
        run: echo "Deployed ${{ steps.outputs.outputs.web_url }}" >> "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 3: Commit the workflows**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "ci: verify and deploy workflows"
```

- [ ] **Step 4: OPERATOR — deploy the bootstrap stack from a local admin identity**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/household-manager/infrastructure"
npx cdk deploy HouseholdManagerBootstrap --require-approval never
```

Read the role ARN from the output and set it as a repository secret:
```bash
gh secret set AWS_DEPLOY_ROLE_ARN --repo CrispyCabot/household-manager --body "<DeployRoleArn output>"
gh variable set AWS_REGION --repo CrispyCabot/household-manager --body "us-east-1"
```

- [ ] **Step 5: OPERATOR — push to `main` and let Actions deploy phase 1 (CloudFront-only URL)**

```bash
git push origin main
gh run watch
```

At this point `useCustomDomain: false`, so the app is reachable at the `WebUrl` output — a `*.cloudfront.net` URL. Confirm sign-in and household creation work there before proceeding to DNS.

- [ ] **Step 6: OPERATOR — delegate the domain**

Read the nameservers:
```bash
aws cloudformation describe-stacks --stack-name HouseholdManager \
  --query "Stacks[0].Outputs[?OutputKey=='ZoneNameServers'].OutputValue" --output text
```
Add these as four `NS` records for host `household-manager` at the registrar for `chrisbridewell.dev` (spec §11). Wait for propagation (`dig NS household-manager.chrisbridewell.dev` resolving to the same four values from an external resolver is the confirmation).

- [ ] **Step 7: OPERATOR — flip to the custom domain**

In `infrastructure/bin/app.ts`, change `useCustomDomain: false` to `useCustomDomain: true`, commit, push, and let Actions redeploy. This is the deploy that issues the ACM certificate and adds the CloudFront/API Gateway aliases — it can take several minutes for DNS validation.

```bash
git add infrastructure/bin/app.ts
git commit -m "feat(infra): switch on the custom domain"
git push origin main
gh run watch
```

Confirm the app loads at `https://household-manager.chrisbridewell.dev` and sign-in still works.

---

## Rollback

Every task through Task 17 only touches this repository's working tree — reverting is a normal `git revert`. Task 18's deploys are additive (new stacks, new DNS records under a zone this stack owns); nothing here touches PosterWalls or CoreInfra. If a deploy fails partway, `cdk deploy` is safe to re-run — CloudFormation resumes or rolls back the specific failed stack, and no other app is affected.
