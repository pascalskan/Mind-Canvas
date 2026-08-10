# Local development

Runs the whole stack on this machine — web, mobile, API and a real Postgres — so
changes are exercised without pushing to Replit or republishing.

## Setup (once)

```bash
docker --version          # Docker Desktop must be installed and running
pnpm install
cp .env.example .env      # then set LOCAL_LAN_IP if a phone will be used
```

## Daily use

```bash
pnpm dev                  # database + API + web
pnpm dev:mobile           # database + API + web + Expo
```

| | URL |
|---|---|
| Web | http://localhost:22107 |
| API (same-origin, via proxy) | http://localhost:22107/api/map |
| API (direct) | http://localhost:8080/api/map |
| Health | http://localhost:8080/api/healthz |
| Postgres | `localhost:5432` — `mindcanvas` / `mindcanvas` / db `mindcanvas` |

`Ctrl+C` stops everything. The Postgres container keeps running (`pnpm db:down`
to stop it); the map survives restarts.

### Flags

```bash
pnpm dev --mobile         # include Expo
pnpm dev --only=api       # just the API server
pnpm dev --only=web       # just the web app
pnpm dev --no-db          # Postgres is already running elsewhere
pnpm dev --no-push        # skip the Drizzle schema push
```

### Database

```bash
pnpm db:up                # start Postgres
pnpm db:down              # stop it (data kept)
pnpm db:reset             # destroy the volume and start clean
pnpm db:push              # apply schema changes after editing lib/db/src/schema
```

Inspect or edit the map directly:

```bash
docker exec -it mind-canvas-db psql -U mindcanvas -d mindcanvas
```

```sql
select jsonb_array_length(data->'bubbles') as bubbles, updated_at from mind_canvas_map;
delete from mind_canvas_map where id = 1;   -- API reseeds on next restart
```

## How this mirrors production

| | Production (Replit) | Local |
|---|---|---|
| Web | static build at `/` | Vite dev server on `:22107` |
| API | `:8080`, path-routed to `/api` | `:8080`, Vite proxies `/api` |
| Web → API | same-origin `/api/map` | **same-origin** `/api/map` |
| Database | managed Postgres | Postgres 16 in Docker |
| Mobile → API | `https://$EXPO_PUBLIC_DOMAIN/api/map` | `http://<LAN-IP>:8080/api/map` |

The `/api` proxy matters: the web client's `SYNC_URL = '/api/map'` stays a
same-origin request locally, so no client code branches on environment and the
sync path under test is the one that ships.

The API server runs under `tsx watch` locally (restart on save) instead of the
esbuild bundle used in production. Same source, same Postgres, same seed — only
the startup path differs.

## Mobile

`pnpm dev:mobile` starts Expo and points the app at this machine's API via
`EXPO_PUBLIC_API_URL`. That variable is a local-only override; production still
uses the `EXPO_PUBLIC_DOMAIN` https path, unchanged.

- **Browser** — press `w` in the Expo output. Easiest way to test web↔mobile sync
  without a device: open the web app and the mobile web build side by side.
- **Physical device** — scan the QR with Expo Go. The phone must be on the same
  wifi, and `LOCAL_LAN_IP` in `.env` must be this machine's LAN address
  (currently `192.168.0.134`). Both the bundle and the API are served on it.
- **Android emulator** — set `LOCAL_LAN_IP=10.0.2.2`.
- **iOS simulator** — set `LOCAL_LAN_IP=localhost`.

If a physical device loads the app but shows the "Couldn't reach the server"
toast, Windows Firewall is blocking inbound `8080`. Allow it for private
networks, or confirm with `curl http://<LAN-IP>:8080/api/healthz` from another
device.

## Testing cross-device sync

Saving is **manual**. Editing never touches the network — it only writes a
local draft — and the single route to the shared map is **Settings → Save
canvas**. Each client then checks `/api/map` every 30 s and, when it finds a
save it has not seen, *offers* it: "continue from the recent save" or "continue
from where you are". A remote save is never applied without that choice.

To reproduce end to end, run two clients against the same local API (two
browser windows, or a browser plus a phone):

1. Edit in client A. The Settings button shows an amber dot — unsaved.
2. **Settings → Save canvas** in A. The dot clears and the panel reads
   "All changes saved — last saved just now".
3. Within ~30 s client B raises the prompt. Choosing "continue from the recent
   save" adopts A's map *and* its canvas name; choosing to stay keeps B's work
   and does not re-offer that same save.

Things worth exercising while there:

- **Names** — set a canvas name in A, save, accept in B. B's Settings field
  must show A's name. An unnamed save clears B's name rather than leaving the
  old one over new content.
- **Export / import** — export from either client and import into the other.
  The file carries the canvas name, and importing adopts it. `savedAt` is
  deliberately *not* carried over: a file is not a cloud save, so importing one
  must not suppress a later "new save available" prompt.
- **Failure** — stop the API (`--only=web`) and press Save. The failure is
  explicit and says which kind it was: unreachable, refused, or no server
  configured. Work stays safe locally, and the unsaved dot stays lit.

To watch traffic, the API logs every request.

Automated coverage for all of the above:

```bash
pnpm test                 # every package
```

`artifacts/mind-canvas-mobile/lib/syncContract.test.ts` is the one to know
about — it imports the real web modules, the real mobile modules **and** the
server's validator, and asserts the three agree. Web and mobile share no code,
so a rule proven on one says nothing about the other, and a disagreement
between them is silent: nothing throws, syncing just quietly stops.

## Testing the /api/map auth gate (M10)

`/api/map` is unauthenticated by default (matches production today). To test
the optional bearer-token gate locally, set all three in `.env` to the same
value, then restart `pnpm dev`:

```
MAP_API_TOKEN=dev-test-token
VITE_MAP_API_TOKEN=dev-test-token
EXPO_PUBLIC_MAP_API_TOKEN=dev-test-token
```

With those set: `/api/healthz` stays open, but `/api/map` 401s without a
matching `Authorization: Bearer <token>` header —

```bash
curl http://localhost:8080/api/map                                    # 401
curl -H "Authorization: Bearer dev-test-token" http://localhost:8080/api/map  # 200
```

— and both clients keep working normally, since they read the same value from
`VITE_MAP_API_TOKEN` / `EXPO_PUBLIC_MAP_API_TOKEN`. Set all three back to empty
to return to the default open behavior.

## Troubleshooting

**`Port N is already in use`** — a previous run did not shut down. Find it with
`netstat -ano | findstr :22107` and stop the PID, or change the port in `.env`.

**`Docker is not running`** — start Docker Desktop, or pass `--no-db` if
Postgres is running some other way.

**Web shows the cloud-failed toast** — the API is not up. Check the `api` lines
in the `pnpm dev` output and hit http://localhost:8080/api/healthz.

**Schema push says "No schema files found"** — `lib/db/drizzle.config.ts` must
keep its **relative** schema path; drizzle-kit's glob fails on absolute paths
containing spaces, which this checkout has (`Mind Map - APP`).
