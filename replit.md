# Mind Canvas

A personal infinite canvas — glass bubbles floating in space, each representing
something occupying mental space in your life. Two clients (a web app and a
React Native app) share one canvas through an API server.

## Run & Operate

- `pnpm dev` — the whole stack locally (Postgres + API + web). See `LOCAL-DEV.md`.
- `pnpm dev:mobile` — the above plus Expo
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm test` — every package's tests (web, mobile, API)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

### Environment

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL` | API server | **yes** | Postgres connection string |
| `MAP_API_TOKEN` | API server | no | Enables the `/api/map` bearer-token gate |
| `VITE_MAP_API_TOKEN` | web build | no | Must match `MAP_API_TOKEN` when set |
| `EXPO_PUBLIC_API_URL` | mobile build | see below | Absolute API base, e.g. `http://192.168.0.5:8080` |
| `EXPO_PUBLIC_DOMAIN` | mobile build | see below | Host for `https://<domain>/api/map` |
| `EXPO_PUBLIC_MAP_API_TOKEN` | mobile build | no | Must match `MAP_API_TOKEN` when set |

**`EXPO_PUBLIC_*` values are baked in at BUILD time.** A native build that
receives neither `EXPO_PUBLIC_API_URL` nor `EXPO_PUBLIC_DOMAIN` has no API to
talk to at all — saving then fails with a `not-configured` error the user can
see, rather than silently doing nothing (which is what it used to do). The
mobile **web** build needs neither: it falls back to its own page origin, since
it is served from the same host as `/api`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: Vite + React 19 + Framer Motion + Tailwind v4
- Mobile: Expo Router + React Native 0.81 + react-native-svg
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Tests: Vitest (web, mobile), `node:test` (API)

## Where things live

| | Path |
|---|---|
| Web canvas + all interaction | `artifacts/mind-canvas/src/components/MindCanvas.tsx` |
| Web state, save + sync | `artifacts/mind-canvas/src/hooks/useBubbleState.ts` |
| Web storage + import/export | `artifacts/mind-canvas/src/persistence.ts` |
| Mobile state, save + sync | `artifacts/mind-canvas-mobile/context/BubbleContext.tsx` |
| Mobile canvas + gestures | `artifacts/mind-canvas-mobile/components/CanvasView.tsx` |
| Mobile layout maths | `artifacts/mind-canvas-mobile/lib/bubbleLayout.ts` |
| Shared map endpoint | `artifacts/api-server/src/routes/map.ts` |
| PUT body validation | `artifacts/api-server/src/lib/mapPayload.ts` |
| DB schema (source of truth) | `lib/db/src/schema` |
| Cross-platform contract test | `artifacts/mind-canvas-mobile/lib/syncContract.test.ts` |

## Architecture decisions

- **Saving is manual.** Editing writes a local draft only; the sole route to the
  shared map is Settings → Save canvas. Auto-push was removed because every edit
  hitting the network made a half-finished canvas on one device overwrite
  finished work on the other.
- **A newer save is offered, never applied.** Each client polls `/api/map` every
  30 s and, on finding a save it has not seen, prompts: continue from the recent
  save, or from where you are. Nothing is replaced without that choice.
- **The clients share no code.** Web and mobile keep separate copies of the
  layout maths, the validators and the save rules, and the server holds a third
  copy of the validation. `syncContract.test.ts` imports all three and asserts
  they agree — divergence here is silent, so it has to be tested explicitly.
- **A child's position is angle + radial, not x/y.** `radial` is a fraction of a
  leash band computed from the parent and sibling count, so the same stored
  value resolves sensibly at any layer size on either platform. Mobile also
  keeps x/y for rendering and re-derives it via `syncPositionsFromAngleRadial`
  whenever it ingests bubbles it did not compute itself.
- **One row, no accounts.** `mind_canvas_map` holds a single global map (id=1).
  `/api/map` is unauthenticated unless `MAP_API_TOKEN` is set, and that token
  ships in both client bundles — it deters a stranger who finds the URL, it is
  not a login system.

## Product

- An infinite, pannable, zoomable canvas of nested bubbles, three layers deep in
  view at a time, with focus-to-zoom navigation and a breadcrumb trail.
- Add, rename, recolour, resize, drag and delete bubbles; edit mode batches
  changes so Cancel genuinely reverts them.
- Name the canvas, save it to the cloud, import/export it as a JSON file, and
  erase it — all from Settings.
- Cross-device continuation: save on one device, get offered it on the other.

## Gotchas

- **`lib/db/drizzle.config.ts` must keep a RELATIVE schema path.** drizzle-kit's
  glob fails on absolute paths containing spaces, and this repo is often checked
  out under one (`Mind Map - APP`), producing a misleading "No schema files
  found".
- **Vitest needs `--pool=threads --no-file-parallelism`** in sandboxed
  environments; the default forks pool times out. Both `test` scripts set it.
- **Never let a non-finite number into a bubble.** `typeof x === 'number'` is not
  enough — NaN and Infinity pass it. A single NaN coordinate propagates into
  layout (React Native throws on NaN layout values) and, because
  `JSON.stringify` turns NaN into `null`, reaches the shared map as a null that
  every client then rejects wholesale, silently killing sync for all devices.
- **The two platforms must agree on `canvasSignature` byte for byte** — it drives
  the unsaved-changes indicator on both.
- **A mobile panel's resting position must never depend on its animation.** RN
  disables `Animated` when "reduce motion" is on, and it does so by *skipping*
  the animation, not by jumping to the end — so a panel that reaches its
  position via a spring simply stays where it started. This shipped: the
  Settings sheet sat 400px down with a sliver showing, and the save prompt sat
  140px above the viewport with its confirm button off-screen. Nothing errored.
  Use `useSlideIn`/`slideOut` from `lib/animation.ts`, which guarantee the end
  state regardless.

## Pointers

- `LOCAL-DEV.md` — running and testing the full stack locally
- See the `pnpm-workspace` skill for workspace structure and package details
