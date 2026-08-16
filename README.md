# household-manager

Shared household management, API first. A household is the core unit: it holds
**boards** (shopping lists, shared notes, recurring tasks), and it can be shared
with other people who all get full access.

Lives at <https://household-manager.chrisbridewell.dev>.

## Status

Design phase. See
[the design doc](docs/superpowers/specs/2026-08-16-household-manager-design.md).

## Layout

| Path              | What it is                                            |
| ----------------- | ----------------------------------------------------- |
| `api/`            | Hono API — runs on Lambda, and locally as a dev server |
| `app/`            | React + Vite SPA, mobile first                         |
| `packages/shared/`| Zod schemas, derived types, DynamoDB key helpers       |
| `infrastructure/` | AWS CDK — bootstrap and main stacks                    |

The API is the product; the SPA is its first client. Request and response
schemas are defined once in `packages/shared` and published as an OpenAPI
document, so native mobile clients can generate against the same contract.

## Stack

React 19 · Hono · TypeScript · DynamoDB · Lambda · Cognito · SES · CDK
