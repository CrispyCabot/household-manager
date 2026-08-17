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
  // NS records delegated and confirmed resolving 2026-08-17 (spec §9, §11).
  useCustomDomain: true,
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
