#!/usr/bin/env node
/**
 * Builds the web app into the Android app, then:
 *   apk     builds a debug APK
 *   run     installs and starts it on a phone connected over USB
 *   studio  opens the project in Android Studio
 *
 * Usage: npm run android:apk | android:run | android:studio
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const androidDir = join(appDir, 'android');
const envFile = join(appDir, '.env.android.local');
const windows = process.platform === 'win32';

const action = process.argv[2];
if (!['apk', 'run', 'studio'].includes(action)) {
  console.error('Usage: node scripts/android.mjs <apk|run|studio>');
  process.exit(1);
}

const required = ['VITE_API_URL', 'VITE_COGNITO_DOMAIN', 'VITE_USER_POOL_CLIENT_ID'];
const fileText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const missing = required.filter((name) => !process.env[name] && !new RegExp(`^${name}=.+`, 'm').test(fileText));
if (missing.length > 0) {
  console.error(`Missing ${missing.join(', ')}. Run \`npm run dev:env\` (needs \`aws login\`) to write app/.env.android.local.`);
  process.exit(1);
}

const pushEnabled = existsSync(join(androidDir, 'app', 'google-services.json'));
if (!pushEnabled) console.warn('No app/android/app/google-services.json, so this build has phone notifications turned off.');
const env = { ...process.env, VITE_PUSH_ENABLED: pushEnabled ? 'true' : '' };

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: windows });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['vite', 'build', '--mode', 'android'], appDir);
run('npx', ['cap', 'sync', 'android'], appDir);

if (action === 'apk') {
  run(windows ? 'gradlew.bat' : './gradlew', ['assembleDebug'], androidDir);
  console.log(`\nAPK: ${join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`);
} else if (action === 'run') {
  run('npx', ['cap', 'run', 'android'], appDir);
} else {
  run('npx', ['cap', 'open', 'android'], appDir);
}
