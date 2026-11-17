# Analytics

The website and the Android app both report to Google Analytics through
Firebase, using the same code in `app/src/analytics.ts`. On Android it goes
through the native Firebase SDK (the `@capacitor-firebase/analytics` plugin);
on the web it loads the Firebase JS SDK on demand. Both land in one GA4
property, so you can compare them side by side (the `platform` dimension is
`ANDROID` or `WEB`).

Nothing personal is sent: no user id, email, names, task titles or item text.
Ad features are off (no advertising id, no ad personalization). Anyone can turn
it off per browser or phone under **Settings → Usage stats**.

## One-time setup

1. **Turn on Analytics in Firebase.** [Firebase console](https://console.firebase.google.com)
   → your project → ⚙ **Project settings → Integrations → Google Analytics →
   Enable**. Create a new GA4 property (or link one you have).
2. **Android.** Download `google-services.json` again (**Project settings →
   General → Your apps → Android**) and update the `GOOGLE_SERVICES_JSON` repo
   secret and your local `app/android/app/google-services.json` if it changed.
   Any build with that file has analytics on; builds without it have it off.
3. **Website.** In **Project settings → General → Your apps**, click **Add app
   → Web** (no hosting needed). From its config, add these under the repo's
   **Settings → Secrets and variables → Actions → Variables** (variables, not
   secrets; they ship inside the site anyway):

   | Repo variable              | Firebase config field |
   | -------------------------- | --------------------- |
   | `FIREBASE_WEB_API_KEY`     | `apiKey`              |
   | `FIREBASE_PROJECT_ID`      | `projectId`           |
   | `FIREBASE_WEB_APP_ID`      | `appId`               |
   | `FIREBASE_MEASUREMENT_ID`  | `measurementId`       |

   The next deploy turns it on. Until all four exist, the site has analytics off.
4. **In Google Analytics** ([analytics.google.com](https://analytics.google.com)):
   - **Admin → Data streams →** the web stream **→ Enhanced measurement →
     Page views → Show advanced settings**: turn off **Page changes based on
     browser history events**. The app logs its own screen views, so leaving it
     on double-counts.
   - **Admin → Custom definitions → Create custom dimension** (event scope)
     for `board_type` and `repeats`, so they show up in reports.

## Where to look

- **Realtime** (GA → Reports → Realtime, or Firebase → Analytics → Realtime):
  what's happening in the last 30 minutes. Best first check after a deploy.
- **Pages and screens** (GA → Reports → Engagement): which screens get used.
  Switch the table's dimension to **Page title and screen name** to see the
  web and Android numbers for each screen together.
- **Events** (GA → Reports → Engagement → Events): counts for each event below.
  Click one to break it down by `board_type` or `repeats`.
- **Explore** (GA → Explore): build your own tables, e.g. events by platform.

Standard reports lag by up to a day; Realtime and DebugView are instant.

## Checking events with DebugView

DebugView shows each event from a device the moment it's sent.
Open it at GA → **Admin → DebugView** (or Firebase → Analytics → DebugView).

- **Android:** with the phone plugged in over USB, run
  ```sh
  adb shell setprop debug.firebase.analytics.app com.chrisbridewell.householdmanager
  ```
  then force-close and reopen the app. Turn it off with
  ```sh
  adb shell setprop debug.firebase.analytics.app .none.
  ```
- **Web:** install the Google Analytics Debugger Chrome extension, switch it on,
  and reload the site.

Tap around and you should see `screen_view` (Android) or `page_view` (web)
plus the events below appear.

## Events

| Event                    | When it fires                              | Params                          |
| ------------------------ | ------------------------------------------ | ------------------------------- |
| `screen_view` / `page_view` | A screen opens (Android / web)          | screen name (see below)         |
| `board_opened`           | A board's page opens                       | `board_type`                    |
| `board_created`          | A new board is made                        | `board_type`                    |
| `task_created`           | A task is added                            | `repeats`: `yes` / `no`         |
| `task_completed`         | A task is marked done                      | `repeats`: `yes` / `no`         |
| `checklist_item_added`   | An item is added to a checklist            | none                            |
| `checklist_item_checked` | A checklist item is ticked (not unticked)  | none                            |

Screen names: `home`, `board`, `task`, `settings`, `privacy`, `wall_dashboard`.
On the web each one is a page view whose title and path are the screen name
(`/board`, `/settings`), so real URLs with household and board ids never reach
Analytics.
Firebase also logs its own automatic events, like `first_visit`/`first_open`,
`session_start` and `user_engagement`.

`board_type` is the board's kind (`tasks`, `checklist`, `text`, `link`,
`calendar`), never its name.

## Adding an event

1. Add it to `AnalyticsEvents` in `app/src/analytics.ts` with its params.
   Event and param names are `snake_case`, up to 40 characters. Params should be
   a few fixed values (a type, yes/no, a count), never anything a person typed
   or an id.
2. Call `logEvent('your_event', { ... })` where the action succeeds, usually
   the mutation's `onSuccess` in `app/src/api/queries.ts`. That one call covers
   both the website and the Android app.
3. To see a new param in reports, add it as a custom dimension in GA (setup
   step 4).
4. Check it in DebugView, then add a row to the table above.

For a new screen, add its route pattern and name to `SCREENS` in
`app/src/components/ScreenTracking.tsx`.
