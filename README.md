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
| `app/android/`    | Android app: the same SPA wrapped with Capacitor       |
| `packages/shared/`| Zod schemas, derived types, DynamoDB key helpers       |
| `infrastructure/` | AWS CDK — bootstrap and main stacks                    |

The API is the product; the SPA is its first client. Request and response
schemas are defined once in `packages/shared` and published as an OpenAPI
document, so native mobile clients can generate against the same contract.

## Stack

React 19 · Hono · TypeScript · DynamoDB · Lambda · Cognito · SES · CDK

## Android app

The Android app is the web app itself, bundled into a Capacitor shell, so it
has every feature the website has and talks to the same live API. Sign-in
opens in a Chrome tab and returns to the app. Connecting Google Calendar also
opens in Chrome; when it finishes, go back to the app.

### Easiest: download the APK

Every deploy of `main` builds a debug APK. Open the latest **Deploy** run under
the repo's **Actions** tab, download the `household-manager-android` artifact,
unzip it and open `app-debug.apk` on the phone (allow installing unknown apps
for whichever app opens it). Each CI build is signed with a fresh debug key, so
to install a newer one, uninstall the old app first; you'll just sign in again.

### Build it yourself

One-time setup: install [Android Studio](https://developer.android.com/studio)
(it brings the Android SDK and `adb`), and make sure `ANDROID_HOME` points at
the SDK. On the phone, turn on **Developer options → USB debugging**.

```sh
aws login              # if your session has expired
npm run dev:env        # writes app/.env.android.local from the stack outputs
npm run android:run    # build, install and open it on the phone plugged in over USB
npm run android:apk    # or: just build app/android/app/build/outputs/apk/debug/app-debug.apk
npm run android:studio # or: open the project in Android Studio
```

Builds from the same machine reuse its debug key, so they install over each
other without losing the sign-in.

## Claude connector

The API also serves an [MCP](https://modelcontextprotocol.io) server at
`https://api.household-manager.chrisbridewell.dev/mcp`, so Claude can read and
manage the household's boards. To use it, in Claude go to **Settings →
Connectors → Add custom connector**, paste that URL, and sign in with your
household-manager account when Claude asks. Leave the OAuth client fields
blank: Claude registers itself.

Tools: `list_households`, `list_boards`, `list_tasks`, `list_due_tasks`,
`create_task`, `update_task`, `complete_task`, `uncomplete_task`,
`list_checklist_items`, `add_checklist_item`. Each one calls the REST API
in-process as the signed-in member, so permissions, validation, the task
history and Google Calendar sync behave exactly as in the app.

Sign-in is OAuth through the same Cognito pool as the app, via a thin facade
in `api/src/mcp/oauth.ts` (Cognito has no dynamic client registration, and
the API authenticates with ID tokens). The connector has its own public,
PKCE-only Cognito client, `ClaudeConnectorClient` in
`infrastructure/lib/constructs/auth.ts`, which only redirects to Claude's
callback URLs. Nothing about it is secret, so there are no secrets to set.
