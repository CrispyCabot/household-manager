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
