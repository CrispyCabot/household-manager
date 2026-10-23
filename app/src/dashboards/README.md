# Custom dashboards

Bespoke looks for specific wall dashboards, kept completely apart from the
rest of the app. A device without an entry here looks exactly like the stock
dashboard.

## How it works

- [`index.ts`](index.ts) maps a device id to a folder here. The folder is
  loaded only on that device, as its own code-split chunk (JS and CSS).
- While it's on screen, `<html>` gets `data-dashboard="<slug>"`. Every rule
  in the folder's stylesheet starts with `html[data-dashboard='<slug>']`, so
  it can't affect any other page or device.
- An optional `Backdrop` component is drawn behind the dashboard's content
  (animated backgrounds, decorations). It must stay `pointer-events: none`,
  so it never blocks a tap.

The only hook into app code is `useCustomDashboard` plus rendering the
`Backdrop`, in `routes/Dashboard.tsx`.

## Adding one

1. Find the device id: Settings → Devices, or the `DEVICE#<id>` record in
   DynamoDB.
2. Create `app/src/dashboards/<slug>/index.tsx` that imports its own
   stylesheet and default-exports `{ slug, Backdrop? }`.
3. Add `'<device id>': () => import('./<slug>/index.js')` to
   `CUSTOM_DASHBOARDS` in `index.ts`.

## Rules

- Scope every selector under `html[data-dashboard='<slug>']`, and prefix
  backdrop class names with something unique (Kitchen Wall uses `kw-`).
- Style what the app already renders; don't change shared components to
  suit one dashboard.
- Colors come from the device's theme (Settings → Devices → Theme) where
  possible. The folder adds effects on top.
- Keep it light: the Kitchen Wall runs on a Raspberry Pi 3, where Chromium
  has no GPU acceleration and draws every animated frame in software.
  Nothing large should move continuously; a drifting full-screen background
  alone pinned a CPU core and made the whole screen lag. Keep continuous
  motion to small elements, animate only `transform` and `opacity`, skip
  `backdrop-filter` and `filter: blur`, honor `prefers-reduced-motion`, and
  check `top` on the Pi after any change.

## Dashboards

| Folder | Device | Look |
| --- | --- | --- |
| [`kitchen-wall/`](kitchen-wall/) | Kitchen Wall (`7d9eec8e-…`) | Night forest: sage and maroon aurora, fireflies, fern silhouettes, glass cards, glowing maroon alerts. |
