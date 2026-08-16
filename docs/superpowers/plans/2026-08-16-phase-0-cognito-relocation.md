# Phase 0 — Cognito Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the shared Cognito user pool out of the `PosterWalls` stack and into `CoreInfra`, publishing it to all apps via SSM, without permanently breaking login.

**Architecture:** Five ordered deploys across two repositories. The pool and its app client are adopted by `CoreInfra` through CloudFormation resource import (no downtime). The hosted UI domain cannot be imported, so it is deleted and recreated under a neutral prefix — the one step with an outage. SSM parameters become the contract every app reads.

**Tech Stack:** AWS CDK 2.x (TypeScript), CloudFormation resource import, Cognito, SSM Parameter Store, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-16-household-manager-design.md` §2

## Global Constraints

- **This plan spans two repositories.** Tasks 1–2 and 4–5 are in `chrisbridewell-infrastructure`; Task 3 is in `Poster Walls Editor`. Each task states its repo.
- **No test cases** — `PRACTICES.md` forbids them unless explicitly requested. Each task verifies with `npx cdk synth --quiet` and AWS CLI reads.
- **Claude cannot run `cdk deploy`.** Every deploy in this plan is an operator hand-off: present the exact command and stop.
- All resources carry tags `environment=prd` and `project` (`core-infra` / `poster-walls`).
- Exact current values, verified 2026-08-16 — reproduce these precisely:
  - Pool ID: `us-east-1_1w3Dv2paU`
  - App client ID: `5gpb7s7ma6jv08rvag4q5fn6a8` (name `AuthUserPoolWebClient147E4E38-XEbjC2cujL8j`)
  - Hosted domain prefix: `poster-walls-0affce8adf47`
  - Pool config: `UsernameAttributes=[email]`, `AutoVerifiedAttributes=[email]`, password `MinimumLength=12`, `RequireUppercase/Lowercase/Numbers=true`, `RequireSymbols=false`, `TemporaryPasswordValidityDays=7`, recovery `verified_email` priority 1, `MfaConfiguration=OFF`, `DeletionProtection=INACTIVE`
- **Order is not negotiable.** Task 1 must complete before Task 3, or Task 3 permanently deletes the live app client.

---

### Task 1: Retain the app client and hosted domain

**Repo:** `Poster Walls Editor`

**Files:**
- Modify: `infrastructure/lib/constructs/auth.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no code interface. Produces the *precondition* for Task 3 — `DeletionPolicy: Retain` on `AuthUserPoolWebClient147E4E38` and `AuthUserPoolDomain31C6792A`.

**Why this is first:** the deployed template has `DeletionPolicy: None` on both. Removing `AuthConstruct` before this lands deletes the live app client, and a Cognito app client cannot be recreated with the same ID. Every signed-in session dies and the SPA's baked-in client ID becomes invalid.

- [ ] **Step 1: Apply retain policies to the underlying L1 resources**

In `infrastructure/lib/constructs/auth.ts`, after the `addDomain` call, add:

```ts
import { RemovalPolicy } from 'aws-cdk-lib';

// Phase 0 of the Cognito relocation (see household-manager spec §2).
// These two default to DeletionPolicy: None, so removing this construct
// would DELETE the live app client and hosted domain rather than orphan
// them. An app client cannot be recreated with the same ID, so that loss
// is permanent: every existing session dies and the client ID baked into
// the deployed SPA stops working. Retain must be deployed BEFORE the
// construct is removed — CloudFormation reads the policy from the
// currently-deployed template, not the one doing the removing.
const domain = this.userPool.node.tryFindChild('Domain') as cognito.UserPoolDomain;
domain.applyRemovalPolicy(RemovalPolicy.RETAIN);
this.client.applyRemovalPolicy(RemovalPolicy.RETAIN);
```

Capture the domain in a variable instead if `addDomain`'s return value is already assigned — prefer that over `tryFindChild`:

```ts
const domain = this.userPool.addDomain('Domain', {
  cognitoDomain: { domainPrefix: this.domainPrefix },
});
domain.applyRemovalPolicy(RemovalPolicy.RETAIN);
this.client.applyRemovalPolicy(RemovalPolicy.RETAIN);
```

- [ ] **Step 2: Verify the synthesized template carries the policies**

Run:
```bash
cd infrastructure && npx cdk synth PosterWalls --quiet \
  && python -c "
import json
t=json.load(open('cdk.out/PosterWalls.template.json'))
for k,v in t['Resources'].items():
    if 'Cognito' in v['Type']:
        print(k, v['Type'], v.get('DeletionPolicy'))
"
```

Expected — all three now `Retain`:
```
AuthUserPool8115E87F AWS::Cognito::UserPool Retain
AuthUserPoolWebClient147E4E38 AWS::Cognito::UserPoolClient Retain
AuthUserPoolDomain31C6792A AWS::Cognito::UserPoolDomain Retain
```

If any logical ID differs from the above, **stop** — the construct tree has changed since the spec was written and Task 4's import mapping is wrong.

- [ ] **Step 3: Commit**

```bash
git add infrastructure/lib/constructs/auth.ts
git commit -m "chore(auth): retain the app client and hosted domain

Phase 0 of moving the pool to CoreInfra. Both default to
DeletionPolicy: None, so removing AuthConstruct would delete them
outright — and an app client cannot be recreated with the same ID."
```

- [ ] **Step 4: OPERATOR — deploy, and confirm it is a metadata-only change**

Hand off. This deploy changes no resource properties; it only rewrites deletion policies.

```bash
cd "c:/Users/cbrid/OneDrive/Documents/Poster Walls Editor/infrastructure"
npx cdk diff PosterWalls      # expect: no resource changes, policy updates only
npx cdk deploy PosterWalls --require-approval never
```

Then confirm the deployed template took it:
```bash
aws cloudformation get-template --stack-name PosterWalls --query TemplateBody --output json \
  | python -c "
import json,sys
t=json.load(sys.stdin)
if isinstance(t,str): t=json.loads(t)
for k,v in t['Resources'].items():
    if 'Cognito' in v['Type']: print(k, v.get('DeletionPolicy'))
"
```
**Gate:** all three must read `Retain` before Task 3 may proceed.

---

### Task 2: Publish the auth contract as SSM parameters

**Repo:** `chrisbridewell-infrastructure`

**Files:**
- Create: `infrastructure/lib/constructs/auth.ts`
- Modify: `infrastructure/lib/main-stack.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: SSM parameters `/core/auth/user-pool-id` and `/core/auth/hosted-domain`, and the `AuthConstruct` class with public readonly members `userPoolId: string` and `hostedDomain: string`.

**Why literals first:** `CoreInfra` does not own the pool yet — the import happens in Task 4. SSM parameters are just strings, so they can publish the correct values immediately, which is what lets Task 3 detach PosterWalls from its own Auth construct. Task 4 swaps the literals for real resource references.

- [ ] **Step 1: Create the construct**

Create `infrastructure/lib/constructs/auth.ts`:

```ts
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * The account's shared Cognito user pool, published for every app to read.
 *
 * Built in stages (see household-manager spec §2). Right now these are
 * literals describing a pool the PosterWalls stack still owns; Task 4
 * imports the pool here and replaces them with real references. The
 * parameter NAMES are the contract and do not change, so consuming apps
 * are written once and never revisited.
 */
export class AuthConstruct extends Construct {
  readonly userPoolId = 'us-east-1_1w3Dv2paU';
  readonly hostedDomain = 'poster-walls-0affce8adf47';

  constructor(scope: Construct, id: string) {
    super(scope, id);

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/core/auth/user-pool-id',
      stringValue: this.userPoolId,
      description: 'Shared Cognito user pool. Apps add their own client to it.',
    });

    new ssm.StringParameter(this, 'HostedDomainParam', {
      parameterName: '/core/auth/hosted-domain',
      // Prefix only, not the full URL: the region and suffix are knowable,
      // and storing the bare prefix keeps the value stable if the hosted-UI
      // URL format ever changes.
      stringValue: this.hostedDomain,
      description: 'Cognito hosted UI domain prefix.',
    });
  }
}
```

- [ ] **Step 2: Wire it into the stack**

In `infrastructure/lib/main-stack.ts`, add the import and instantiate alongside the budget:

```ts
import { AuthConstruct } from './constructs/auth.js';
```

```ts
const auth = new AuthConstruct(this, 'Auth');

new CfnOutput(this, 'UserPoolId', { value: auth.userPoolId });
new CfnOutput(this, 'CognitoHostedDomain', { value: auth.hostedDomain });
```

- [ ] **Step 3: Verify synth**

Run: `cd infrastructure && npx cdk synth CoreInfra --quiet`
Expected: exits 0. Confirm both parameters appear:
```bash
python -c "
import json
t=json.load(open('cdk.out/CoreInfra.template.json'))
print([v['Properties']['Name'] for v in t['Resources'].values() if v['Type']=='AWS::SSM::Parameter'])
"
```
Expected: `['/core/auth/user-pool-id', '/core/auth/hosted-domain']`

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lib/constructs/auth.ts infrastructure/lib/main-stack.ts
git commit -m "feat(auth): publish the shared user pool via SSM

Literal values for now — the pool still belongs to the PosterWalls
stack until it is imported here. The parameter names are the contract,
so apps can be written against them before the import lands."
```

- [ ] **Step 5: OPERATOR — deploy CoreInfra**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/chrisbridewell-infrastructure/infrastructure"
npx cdk deploy CoreInfra --require-approval never
```

Verify:
```bash
aws ssm get-parameter --name /core/auth/user-pool-id --query Parameter.Value --output text
```
Expected: `us-east-1_1w3Dv2paU`

---

### Task 3: Detach PosterWalls from its Auth construct

**Repo:** `Poster Walls Editor`

**Files:**
- Delete: `infrastructure/lib/constructs/auth.ts`
- Modify: `infrastructure/lib/main-stack.ts`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: SSM parameters from Task 2; the `Retain` policies from Task 1.
- Produces: a `PosterWalls` stack that declares no Cognito resources. The pool, client and domain survive as orphans.

**Precondition — verify before starting:** Task 1's deploy landed and all three Cognito resources read `Retain` in the *deployed* template. Do not take this on faith; run the check from Task 1 Step 4.

**What is unavoidably lost:** the `AuthConstruct` also owned the callback/logout URL list. Once orphaned, no stack manages the client's URLs; they keep their current values. Task 4 restores management when `CoreInfra` adopts the client.

- [ ] **Step 1: Remove the construct from the stack**

In `infrastructure/lib/main-stack.ts`: delete the `AuthConstruct` import and the `const auth = new AuthConstruct(...)` block. Replace the Cognito wiring with SSM reads:

```ts
import * as ssm from 'aws-cdk-lib/aws-ssm';
```

```ts
// The pool is a shared, account-level resource owned by CoreInfra, not by
// this app (household-manager spec §2). valueForStringParameter resolves at
// DEPLOY time, so this stack does not need a context lookup or a synth-time
// AWS call.
const userPoolId = ssm.StringParameter.valueForStringParameter(this, '/core/auth/user-pool-id');
const hostedDomain = ssm.StringParameter.valueForStringParameter(this, '/core/auth/hosted-domain');

api.fn.addEnvironment('USER_POOL_ID', userPoolId);
api.fn.addEnvironment('USER_POOL_CLIENT_ID', '5gpb7s7ma6jv08rvag4q5fn6a8');
```

Delete the `UserPoolId`, `UserPoolClientId` and `CognitoDomain` outputs that referenced `auth.*`, and replace them with:

```ts
new CfnOutput(this, 'UserPoolId', { value: userPoolId });
new CfnOutput(this, 'UserPoolClientId', { value: '5gpb7s7ma6jv08rvag4q5fn6a8' });
new CfnOutput(this, 'CognitoDomain', {
  value: `https://${hostedDomain}.auth.${this.region}.amazoncognito.com`,
});
```

Keeping the output *names* identical is deliberate — `deploy.yml` reads them by name, so the workflow keeps working unchanged in this task.

- [ ] **Step 2: Delete the construct file**

```bash
git rm infrastructure/lib/constructs/auth.ts
```

- [ ] **Step 3: Verify the stack no longer declares Cognito resources**

Run:
```bash
cd infrastructure && npx cdk synth PosterWalls --quiet && python -c "
import json
t=json.load(open('cdk.out/PosterWalls.template.json'))
print([v['Type'] for v in t['Resources'].values() if 'Cognito' in v['Type']] or 'none')
"
```
Expected: `none`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(auth): read the shared pool from SSM

The pool, client and hosted domain are account-level resources moving to
CoreInfra. This stack stops declaring them and reads the contract from
SSM instead; the retained resources are orphaned, not deleted."
```

- [ ] **Step 5: OPERATOR — deploy and confirm login still works**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/Poster Walls Editor/infrastructure"
npx cdk diff PosterWalls      # expect: three Cognito resources REMOVED (orphaned, not destroyed)
npx cdk deploy PosterWalls --require-approval never
```

**Gate — all three must still exist after the deploy:**
```bash
aws cognito-idp describe-user-pool --user-pool-id us-east-1_1w3Dv2paU --query 'UserPool.{Id:Id,Domain:Domain}' --output json
aws cognito-idp describe-user-pool-client --user-pool-id us-east-1_1w3Dv2paU --client-id 5gpb7s7ma6jv08rvag4q5fn6a8 --query 'UserPoolClient.ClientName' --output text
```
Then sign in at <https://poster-editor.chrisbridewell.dev> and confirm it works. If login is broken here, **stop** — do not proceed to Task 4.

---

### Task 4: Adopt the pool and client into CoreInfra

**Repo:** `chrisbridewell-infrastructure`

**Files:**
- Modify: `infrastructure/lib/constructs/auth.ts`
- Create: `infrastructure/import-resources.json`

**Interfaces:**
- Consumes: the orphaned pool and client from Task 3.
- Produces: `AuthConstruct.userPool: cognito.UserPool` (a real, managed resource) and `AuthConstruct.userPoolId` now derived from it.

**Why the domain is absent here:** CloudFormation resource import requires `read` *and* `list` handlers. `AWS::Cognito::UserPoolDomain` has no `list` handler, so it cannot be imported. It is handled in Task 5.

- [ ] **Step 1: Declare the pool and client to match production exactly**

Replace the body of `infrastructure/lib/constructs/auth.ts`. Every property below mirrors the live configuration read on 2026-08-16 — a mismatch here is a silent change to live auth, because import does not diff properties.

```ts
import { RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class AuthConstruct extends Construct {
  readonly userPool: cognito.UserPool;
  readonly hostedDomain = 'poster-walls-0affce8adf47';

  get userPoolId(): string {
    return this.userPool.userPoolId;
  }

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Imported, not created. These properties must match the live pool
    // exactly: `cdk import` adopts the existing resource without diffing
    // its properties, so any difference here is applied as an UPDATE to
    // production auth on the next deploy.
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OFF,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // PosterWalls' client, adopted so its callback URLs are managed again.
    this.userPool.addClient('PosterWallsClient', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ['https://poster-editor.chrisbridewell.dev/callback', 'http://localhost:5173/callback'],
        logoutUrls: ['https://poster-editor.chrisbridewell.dev', 'http://localhost:5173'],
      },
      preventUserExistenceErrors: true,
    }).applyRemovalPolicy(RemovalPolicy.RETAIN);

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/core/auth/user-pool-id',
      stringValue: this.userPoolId,
      description: 'Shared Cognito user pool. Apps add their own client to it.',
    });

    new ssm.StringParameter(this, 'HostedDomainParam', {
      parameterName: '/core/auth/hosted-domain',
      stringValue: this.hostedDomain,
      description: 'Cognito hosted UI domain prefix.',
    });
  }
}
```

- [ ] **Step 2: Confirm the live callback URLs before trusting the list above**

Run:
```bash
aws cognito-idp describe-user-pool-client \
  --user-pool-id us-east-1_1w3Dv2paU --client-id 5gpb7s7ma6jv08rvag4q5fn6a8 \
  --query 'UserPoolClient.{Callbacks:CallbackURLs,Logouts:LogoutURLs,Flows:ExplicitAuthFlows,Scopes:AllowedOAuthScopes}' --output json
```
Edit Step 1's `callbackUrls` / `logoutUrls` to match the output **exactly**, including any CloudFront URL still registered. A dropped callback URL breaks login for anyone mid-session on that origin.

- [ ] **Step 3: Write the import mapping**

Create `infrastructure/import-resources.json`. Keys are CDK logical IDs; read them from the synthesized template rather than guessing:

```bash
cd infrastructure && npx cdk synth CoreInfra --quiet && python -c "
import json
t=json.load(open('cdk.out/CoreInfra.template.json'))
for k,v in t['Resources'].items():
    if 'Cognito' in v['Type']: print(k, v['Type'])
"
```

Then create the file using those exact logical IDs:

```json
{
  "AuthUserPool<SUFFIX>": {
    "UserPoolId": "us-east-1_1w3Dv2paU"
  },
  "AuthPosterWallsClient<SUFFIX>": {
    "UserPoolId": "us-east-1_1w3Dv2paU",
    "ClientId": "5gpb7s7ma6jv08rvag4q5fn6a8"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lib/constructs/auth.ts infrastructure/import-resources.json
git commit -m "feat(auth): adopt the shared user pool into CoreInfra

Declares the pool and PosterWalls' client to match production exactly so
cdk import can adopt them. The hosted domain is not here: it has no list
handler and therefore cannot be imported."
```

- [ ] **Step 5: OPERATOR — import, then verify nothing changed**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/chrisbridewell-infrastructure/infrastructure"
npx cdk import CoreInfra --resource-mapping=import-resources.json
```

Then the critical check — a diff must be **empty**. A non-empty diff means the declaration in Step 1 does not match reality, and deploying it would mutate live auth:

```bash
npx cdk diff CoreInfra
```
**Gate:** if the diff shows any change to the pool or client, fix the declaration to match production and re-diff. Do not deploy a non-empty diff.

Confirm login at <https://poster-editor.chrisbridewell.dev> still works.

---

### Task 5: Recreate the hosted domain under a neutral prefix

**Repo:** `chrisbridewell-infrastructure`, then `Poster Walls Editor`

**Files:**
- Modify: `infrastructure/lib/constructs/auth.ts`
- Modify (Poster Walls): `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the imported pool from Task 4.
- Produces: a hosted domain owned by `CoreInfra` with a neutral prefix; `/core/auth/hosted-domain` updated to it.

**This task has an outage.** A pool holds exactly one domain, so the old one must be deleted before the new one is created. Login is down across every app on this pool for the gap — minutes, but real. Do it deliberately, not incidentally.

- [ ] **Step 1: Delete the orphaned domain**

This is the outage start. Run it when a few minutes of broken login is acceptable:

```bash
aws cognito-idp delete-user-pool-domain \
  --user-pool-id us-east-1_1w3Dv2paU --domain poster-walls-0affce8adf47
```

Confirm it is gone (`Domain` should be absent or empty):
```bash
aws cognito-idp describe-user-pool --user-pool-id us-east-1_1w3Dv2paU --query 'UserPool.Domain' --output text
```

- [ ] **Step 2: Declare the new domain in the construct**

In `infrastructure/lib/constructs/auth.ts`, replace the hard-coded `hostedDomain` literal with a derived, neutral prefix and create the domain:

```ts
import { Fn, RemovalPolicy, Stack } from 'aws-cdk-lib';
```

```ts
  readonly hostedDomain: string;
```

and inside the constructor, after the client:

```ts
    // Cognito domain prefixes are globally unique per region, so they need a
    // unique component — but NOT the account ID, because this prefix appears
    // in a public login URL. Use the trailing group of the stack's UUID:
    // equally unique, reveals nothing.
    //
    // stackId: arn:aws:cloudformation:us-east-1:<acct>:stack/<name>/<uuid>
    const stackUuid = Fn.select(2, Fn.split('/', Stack.of(this).stackId));
    const uniqueSuffix = Fn.select(4, Fn.split('-', stackUuid));
    this.hostedDomain = `chrisbridewell-${uniqueSuffix}`;

    // NOTE: a pool holds only ONE domain, and CloudFormation replaces
    // create-before-delete. Changing this prefix later therefore fails in a
    // single deploy — it must be done as two deploys (remove, then re-add),
    // with login broken in between.
    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: this.hostedDomain },
    });
```

- [ ] **Step 3: Verify synth**

Run: `cd infrastructure && npx cdk synth CoreInfra --quiet`
Expected: exits 0, and the template now contains an `AWS::Cognito::UserPoolDomain`.

- [ ] **Step 4: Commit**

```bash
git add infrastructure/lib/constructs/auth.ts
git commit -m "feat(auth): own the hosted UI domain, on a neutral prefix

The domain cannot be imported, so it is recreated here. Taking a neutral
prefix while it is being recreated anyway retires the poster-walls login
URL that every app on this pool was sharing."
```

- [ ] **Step 5: OPERATOR — deploy, ending the outage**

```bash
cd "c:/Users/cbrid/OneDrive/Documents/chrisbridewell-infrastructure/infrastructure"
npx cdk deploy CoreInfra --require-approval never
```

Read the new prefix — you need it for Step 6:
```bash
aws ssm get-parameter --name /core/auth/hosted-domain --query Parameter.Value --output text
```

- [ ] **Step 6: Point the PosterWalls SPA at the new domain**

In `Poster Walls Editor`, the SPA's `VITE_COGNITO_DOMAIN` comes from the `CognitoDomain` stack output, which Task 3 rebuilt from the SSM parameter — so it already resolves to the new prefix. Trigger a redeploy so the bundle picks it up:

```bash
cd "c:/Users/cbrid/OneDrive/Documents/Poster Walls Editor"
gh workflow run deploy.yml
gh run watch
```

- [ ] **Step 7: Verify end to end**

Sign out fully, then sign in at <https://poster-editor.chrisbridewell.dev>. Confirm the login page URL now shows `chrisbridewell-…`, not `poster-walls-…`.

**Gate:** Phase 0 is complete only when login works on the new domain. household-manager Phase 1 depends on `/core/auth/user-pool-id` resolving and the pool being managed by `CoreInfra`.

---

## Rollback

If Task 4's import fails or diffs dirty, the pool and client are still orphaned and fully functional — no user impact. Delete the failed import's resources from the `CoreInfra` template and retry; nothing needs undoing in PosterWalls.

If Task 5 leaves the pool with no domain, login is down until a domain exists. The fastest recovery is to recreate one by hand at any prefix and update the SSM parameter:

```bash
aws cognito-idp create-user-pool-domain --user-pool-id us-east-1_1w3Dv2paU --domain <prefix>
aws ssm put-parameter --name /core/auth/hosted-domain --value <prefix> --overwrite
```
Then redeploy the PosterWalls SPA. Reconcile CDK ownership afterwards.
