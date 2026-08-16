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
