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
