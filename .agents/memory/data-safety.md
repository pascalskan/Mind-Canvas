---
name: Data safety patterns
description: How data is protected from loss across the web and mobile apps — startup race, local save, export/import robustness.
---

## Startup race condition (both platforms)

**Rule:** Never let the async cloud GET overwrite state that the user has already mutated in the same session.

**Why:** `fetchFromCloud` is async. The user can interact (add/delete/rename/move) before it resolves. Without protection the cloud response would silently discard those edits.

**How to apply:**
- `editedBeforeCloudRef = useRef(false)` is set to `true` by every user-initiated mutation callback.
- In the cloud bootstrap `.then()`, check this flag first. If true, skip `setBubbles(cloud)` and let the save effect push the user's current state to cloud once the gate (`cloudSyncedRef`) opens.
- The flag is set in: `addBubble`, `deleteBubble`, `renameBubble`, `recolorBubble`, `resizeBubble`, `updateBubblePosition`, `batchUpdatePositions` (mobile); `addBubble`, `deleteBubblesById`, `renameBubble` (web).
- Import (`importMap`) also sets the flag since it replaces the whole bubble array.

## Local save failure (mobile)

**Rule:** `saveBubbles()` returns `Promise<boolean>` — always await it and log a warning on `false`.

**Why:** AsyncStorage can fail if the device storage is full. Previously the return value was ignored so failures were invisible. Cloud is the canonical source (Postgres after Task #54), so local failure is non-fatal, but it should not be silent.

## Export/import field robustness

**Rule:** `isValidBubble` must validate ALL optional fields (`angle`, `radial`, `scale`) with type checks, not just required ones.

**Why:** A file with `"scale": "big"` would pass the old mobile validator and corrupt bubble state silently. The web validator already checked these; mobile now matches.

**How to apply:** In `persistence.ts` on mobile:
```ts
if (o.angle  !== undefined && typeof o.angle  !== 'number') return false;
if (o.radial !== undefined && typeof o.radial !== 'number') return false;
if (o.scale  !== undefined && typeof o.scale  !== 'number') return false;
```

## Import file.text() on web (mobile app running on web)

**Rule:** Wrap `await file.text()` in try/catch inside the `onchange` handler.

**Why:** Without it, a read error is swallowed silently and the user sees no feedback.

## Export format

Both platforms export `{ version: 2, bubbles: BubbleData[] }` as pretty-printed JSON (no LZ-string compression). Both accept `version: 1` and `version: 2` on import. Fields are identical between platforms so cross-platform export/import works.

## Positions on import

Imported `x`, `y` are preserved exactly — no collision resolution is run at import time. `correctGrandchildPositions` only fires on the next `focusedId` change, not immediately after import, so the layout matches what was exported.
