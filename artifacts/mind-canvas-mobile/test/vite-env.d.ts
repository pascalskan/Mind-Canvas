/**
 * `import.meta.env` for the cross-platform contract test.
 *
 * lib/syncContract.test.ts imports the web app's real modules so the two
 * platforms are checked against each other rather than against a copy. Those
 * modules read `import.meta.env.VITE_*`, which Vite types for the web package
 * via `vite/client` — a type this Expo package has no reason to depend on.
 *
 * Declaring the shape here keeps `tsc -p tsconfig.json` happy without adding
 * Vite to a React Native app. Vitest itself needs nothing: it runs through
 * Vite, which supplies the real value at run time.
 */
interface ImportMetaEnv {
  // Matches how the web app actually consumes these: every VITE_* value it
  // reads is treated as an optional string.
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
