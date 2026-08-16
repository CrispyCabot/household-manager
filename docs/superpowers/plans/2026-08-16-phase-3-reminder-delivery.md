# Phase 3 — Reminder Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver email digests for everything currently nagging, on an hourly schedule, without paging every household member for every task individually.

**Architecture:** An SES domain identity, verified via the hosted zone household-manager already owns (zero manual DNS). An EventBridge rule fires an hourly Lambda that queries GSI1 for tasks due now, groups them by household, and sends one digest per member — then pushes each reported task's `notifyAfter` forward 24h using the same `snoozeTask` the API already exposes.

**Tech Stack:** Amazon SES (v2 API), EventBridge, Lambda, the same DynamoDB table as Phases 1–2.

**Spec:** `docs/superpowers/specs/2026-08-16-household-manager-design.md` §8

## Global Constraints

- **Prerequisite:** Phase 1's custom-domain switch (Phase 1 Task 18, Step 7) must already be live. SES's DKIM records, like the ACM certificate before them, cannot validate until the zone resolves — so this phase's infrastructure is gated behind the same `certificate !== undefined` condition as the domain/API aliases, and cannot be usefully deployed before that.
- **No test cases** — per `PRACTICES.md`.
- **Correction to the design spec:** the spec originally stated the AWS account already had SES production access. That was wrong — a re-check on 2026-08-16 found `ProductionAccessEnabled: false`; the account is **sandboxed**, meaning SES will only send to addresses that are themselves individually verified until AWS approves a production-access request. See the spec's own correction note in §8, and Task 3 below for the request and an interim workaround.

---

### Task 1: `infrastructure` — SES identity and the reminder Lambda

**Files:**
- Create: `infrastructure/lib/constructs/ses.ts`, `infrastructure/lib/constructs/reminder.ts`
- Modify: `infrastructure/lib/main-stack.ts`

**Interfaces:**
- Consumes: `DataConstruct.table`, the `zone` and `certificate` already built in `main-stack.ts` (Phase 1 Task 6).
- Produces: `SesConstruct.identity: ses.EmailIdentity`; the `ReminderConstruct` (Lambda + hourly `events.Rule`, no exported members needed by anything else).

- [ ] **Step 1: `infrastructure/lib/constructs/ses.ts`**

```ts
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface SesConstructProps {
  readonly zone: route53.IHostedZone;
}

/**
 * A domain identity, not a single-address one — any address at this domain
 * (`reminders@`, later others) is covered by one verification. Verifying
 * against the zone this stack already owns (`Identity.publicHostedZone`,
 * not `Identity.domain`) is what makes DKIM's CNAME records get created
 * automatically rather than needing to be copied in by hand.
 */
export class SesConstruct extends Construct {
  readonly identity: ses.EmailIdentity;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);

    this.identity = new ses.EmailIdentity(this, 'Identity', {
      identity: ses.Identity.publicHostedZone(props.zone),
    });
  }
}
```

- [ ] **Step 2: `infrastructure/lib/constructs/reminder.ts`**

```ts
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as ses from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface ReminderConstructProps {
  readonly table: dynamodb.TableV2;
  readonly emailIdentity: ses.EmailIdentity;
  readonly domainName: string;
}

export class ReminderConstruct extends Construct {
  constructor(scope: Construct, id: string, props: ReminderConstructProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, 'FnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'Fn', {
      entry: fileURLToPath(new URL('../../../api/src/reminder.ts', import.meta.url)),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(2),
      logGroup,
      environment: {
        TABLE_NAME: props.table.tableName,
        WEB_DOMAIN: props.domainName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: { minify: true, sourceMap: true },
    });

    props.table.grantReadWriteData(fn);

    // TableV2's grant methods already widen to the table's GSIs, so this
    // covers the GSI1 query the Lambda runs — no separate index grant.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [props.emailIdentity.emailIdentityArn],
      }),
    );

    new events.Rule(this, 'HourlyTrigger', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
```

- [ ] **Step 3: Wire into `infrastructure/lib/main-stack.ts`**

Add the imports:

```ts
import { ReminderConstruct } from './constructs/reminder.js';
import { SesConstruct } from './constructs/ses.js';
```

Immediately after the existing `if (api.domain !== undefined) { ... }` block (the one that adds the Route 53 A/AAAA/API aliases), add:

```ts
    // Gated with the custom domain for the same reason the certificate is:
    // DKIM's CNAME records cannot validate until the zone resolves.
    if (certificate !== undefined) {
      const ses = new SesConstruct(this, 'Ses', { zone });
      new ReminderConstruct(this, 'Reminder', {
        table: data.table,
        emailIdentity: ses.identity,
        domainName: DOMAIN_NAME,
      });
      new CfnOutput(this, 'ReminderFromAddress', { value: `reminders@${DOMAIN_NAME}` });
    }
```

- [ ] **Step 4: Verify**

`api/src/reminder.ts` does not exist until Task 2, so `cdk synth` will fail at bundling the same way Phase 1 Task 6 did before its Lambda entry existed — expected, not a defect. Confirm no other error:

```bash
cd infrastructure && npx cdk synth --quiet
```
Expected: fails only on the missing `api/src/reminder.ts`.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/lib/constructs/ses.ts infrastructure/lib/constructs/reminder.ts infrastructure/lib/main-stack.ts
git commit -m "feat(infra): SES domain identity and the hourly reminder Lambda"
```

---

### Task 2: `api` — the reminder Lambda handler

**Files:**
- Create: `api/src/reminder.ts`
- Modify: `api/src/db/tasks.ts`

**Interfaces:**
- Consumes: `DUE_PARTITION`, `GSI1` (`@hhm/shared`, Phase 1 Task 2); `listMembers` (Phase 1 Task 8); `snoozeTask` (Phase 2 Task 2, now exported for reuse).
- Produces: `handler` (the Lambda entry `infrastructure/lib/constructs/reminder.ts` points at).

- [ ] **Step 1: Export `taskSk` from `api/src/db/tasks.ts`** so nothing outside this file re-derives the item key format

Change `function taskSk(` to `export function taskSk(` — the single-line change, no other edits to that file.

- [ ] **Step 2: `api/src/reminder.ts`**

```ts
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DUE_PARTITION, GSI1 } from '@hhm/shared';
import type { Task } from '@hhm/shared';
import { docClient, tableName } from './db/client.js';
import { listMembers } from './db/households.js';
import { snoozeTask } from './db/tasks.js';

const sesClient = new SESv2Client({});

function fromEmail(): string {
  const domain = process.env.WEB_DOMAIN;
  if (domain === undefined || domain === '') throw new Error('WEB_DOMAIN is not set');
  return `reminders@${domain}`;
}

/** Everything past its nag-start, anywhere in the account. Sparse by construction — see Phase 2's design note on GSI1. */
async function dueTasks(nowIso: string): Promise<Task[]> {
  const result = await docClient().send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK <= :now',
      ExpressionAttributeValues: { ':pk': DUE_PARTITION, ':now': nowIso },
    }),
  );
  return (result.Items ?? []).map((i) => ({
    id: String(i.id),
    householdId: String(i.householdId),
    boardId: String(i.boardId),
    title: String(i.title),
    description: String(i.description ?? ''),
    dueAt: String(i.dueAt),
    recurrence: (i.recurrence as Task['recurrence']) ?? null,
    leadTimeDays: Number(i.leadTimeDays ?? 0),
    notify: (i.notify as Task['notify']) ?? { inApp: true, email: true },
    status: i.status === 'completed' ? 'completed' : 'active',
    snoozedUntil: (i.snoozedUntil as string | null | undefined) ?? null,
    dismissed: Boolean(i.dismissed),
    notifyAfter: (i.notifyAfter as string | null | undefined) ?? null,
    lastCompletedAt: (i.lastCompletedAt as string | null | undefined) ?? null,
    lastCompletedBy: (i.lastCompletedBy as string | null | undefined) ?? null,
    createdBy: String(i.createdBy),
    createdAt: String(i.createdAt),
    updatedAt: String(i.updatedAt),
    version: Number(i.version),
  }));
}

function digestBody(tasks: Task[]): string {
  const lines = tasks.map((t) => `- ${t.title} (due ${new Date(t.dueAt).toLocaleDateString()})`);
  return `The following tasks need attention:\n\n${lines.join('\n')}\n\nOpen household-manager to mark them done, snooze, or dismiss.`;
}

async function sendDigest(toEmail: string, tasks: Task[]): Promise<void> {
  const count = tasks.length;
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail(),
      Destination: { ToAddresses: [toEmail] },
      Content: {
        Simple: {
          Subject: { Data: `${count} task${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention` },
          Body: { Text: { Data: digestBody(tasks) } },
        },
      },
    }),
  );
}

/**
 * Runs hourly (see infrastructure/lib/constructs/reminder.ts). Groups due
 * tasks by household and sends one digest per member — several overdue
 * chores are one email, not five (spec §8).
 *
 * There is no per-member email preference in this app (Phases 1–2 never
 * added one to Profile); the gate is the TASK-level `notify.email` flag
 * instead, and every member of the household receives it. Adding a
 * per-member override is a small, self-contained follow-up if it turns out
 * to matter — it does not change anything built here.
 */
export async function handler(): Promise<void> {
  const now = new Date().toISOString();
  const tasks = (await dueTasks(now)).filter((t) => t.notify.email && t.status === 'active');

  const byHousehold = new Map<string, Task[]>();
  for (const task of tasks) {
    const list = byHousehold.get(task.householdId) ?? [];
    list.push(task);
    byHousehold.set(task.householdId, list);
  }

  for (const [householdId, householdTasks] of byHousehold) {
    const members = await listMembers(householdId);
    for (const member of members) {
      try {
        await sendDigest(member.email, householdTasks);
      } catch (err) {
        // A sandboxed SES account rejects unverified recipients — log and
        // keep going rather than losing every other household's reminders
        // over one failure. See Phase 3 plan Task 3 for lifting this.
        console.error(`failed to send digest to ${member.email}`, err);
      }
    }
  }

  // Reuses the exact write the API's own snooze endpoint performs — the
  // system is, functionally, giving each reported task a 24h snooze on the
  // household's behalf, so it does not re-page every hour indefinitely.
  for (const task of tasks) {
    await snoozeTask(task.householdId, task.boardId, task.id, 24);
  }
}
```

- [ ] **Step 3: Add `@aws-sdk/client-sesv2` to `api/package.json`**

```json
    "@aws-sdk/client-sesv2": "^3.1095.0",
```
(alongside the existing `@aws-sdk/client-dynamodb` line, keeping the same version as the other `@aws-sdk/*` packages already pinned there).

- [ ] **Step 4: Install and verify**

```bash
npm install
npx tsc -p api/tsconfig.json --noEmit
cd infrastructure && npx cdk synth --quiet
```
Expected: all three exit 0 — this is the point `cdk synth` succeeds end to end for this phase.

- [ ] **Step 5: Commit**

```bash
git add api/src/reminder.ts api/src/db/tasks.ts api/package.json package-lock.json
git commit -m "feat(api): hourly reminder Lambda — GSI1 sweep, per-household digests"
```

---

### Task 3: Operator — SES production access and first deploy

**Files:** none — AWS account and deploy steps only.

- [ ] **Step 1: OPERATOR — verify your own address as an interim SES identity**

SES production access takes AWS human review (Step 2). Verifying your own address lets the feature be tested end to end while that request is pending, since a sandboxed account can send to any address that is itself verified — regardless of the sending domain's own verification status.

```bash
aws sesv2 create-email-identity --email-identity cbridewell5@gmail.com
```
Click the verification link AWS emails to that address.

- [ ] **Step 2: OPERATOR — request SES production access**

This is a manual request with human review — typically resolved within a day, sometimes faster, occasionally longer. Submit it now so it is not the last thing blocking real delivery. The exact CLI flags below are worth double-checking before running (`aws sesv2 put-account-details help`), since parameter names occasionally shift between CLI versions:

```bash
aws sesv2 put-account-details \
  --mail-type TRANSACTIONAL \
  --website-url https://household-manager.chrisbridewell.dev \
  --use-case-description "Household task reminder emails for a personal multi-user household app. Low volume, transactional reminders only, sent to members who joined a household inside the app." \
  --production-access-enabled
```
If any flag is rejected, the AWS Console path (SES → Account dashboard → "Request production access") asks for the same information interactively and is a safe fallback.

- [ ] **Step 3: OPERATOR — deploy**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/household-manager"
git push origin main
gh run watch
```

- [ ] **Step 4: OPERATOR — confirm the SES identity verifies**

DKIM validation over DNS can take a few minutes:

```bash
aws sesv2 get-email-identity --email-identity household-manager.chrisbridewell.dev \
  --query '{Verified:VerifiedForSendingStatus,DkimStatus:DkimAttributes.Status}'
```
Expected, once propagation completes: `Verified: true`, `DkimStatus: "SUCCESS"`.

- [ ] **Step 5: End-to-end smoke test**

Using the account whose email was verified in Step 1: create a household, add a Tasks board, create a task due today. Within the hour, confirm a digest email arrives. To avoid waiting up to an hour, invoke the Lambda directly:

```bash
aws lambda invoke --function-name $(aws lambda list-functions \
  --query "Functions[?contains(FunctionName,'Reminder')].FunctionName" --output text) \
  --payload '{}' /tmp/reminder-output.json
cat /tmp/reminder-output.json
```

- [ ] **Step 6: Once production access is approved, re-test with a second, unverified household member's email**

Confirms the sandbox restriction was really what was gating delivery, not something else. No code change is needed for this — approval alone lifts the restriction.

---

## Rollback

Task 1 and 2 are additive — reverting either is a normal `git revert` and removes the Lambda/rule/identity on the next deploy, with no effect on Phases 1–2. If SES production access is denied or delayed indefinitely, the app still functions fully via the in-app alert banner (Phase 2); email is additive, not load-bearing for the core "keep nagging until it's done" behavior.
