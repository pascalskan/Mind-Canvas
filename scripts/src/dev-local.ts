/**
 * Local development orchestrator.
 *
 * Reproduces the deployed topology on this machine so no change needs a push to
 * Replit to be exercised:
 *
 *   production                              local
 *   ──────────────────────────────────────  ─────────────────────────────────────
 *   https://<domain>/          → web        http://localhost:22107/       → web
 *   https://<domain>/api/*     → api :8080  http://localhost:22107/api/*  → api :8080
 *   managed Postgres                        Postgres in Docker :5432
 *   mobile → https://<domain>/api/map       mobile → http://<LAN-IP>:8080/api/map
 *
 * The `/api` path on the web origin is served by a Vite proxy, so the web app's
 * `SYNC_URL = '/api/map'` is same-origin locally exactly as it is in production
 * — no client code branches on environment.
 *
 * Usage:
 *   pnpm dev                 web + api (+ database)
 *   pnpm dev --mobile        web + api + mobile
 *   pnpm dev --only=api      just the API server
 *   pnpm dev --no-db         assume Postgres is already running
 *   pnpm dev --no-push       skip the schema push
 *
 * Services are started with explicitly-passed environment rather than shell
 * `VAR=x cmd` prefixes, so this works identically on Windows and POSIX.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_WIN = process.platform === 'win32';

// ── Output ────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
} as const;

function log(msg: string) { console.log(`${C.cyan}▸${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}!${C.reset} ${msg}`); }
function fail(msg: string): never {
  console.error(`${C.red}✕ ${msg}${C.reset}`);
  process.exit(1);
}

// ── .env ──────────────────────────────────────────────────────────────────────

/**
 * Minimal dotenv parser — avoids a dependency for ~15 lines of work.
 * Supports `KEY=value`, `#` comments, blank lines, and quoted values.
 */
function loadEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// ── Network helpers ───────────────────────────────────────────────────────────

/** First non-internal IPv4 address, preferring real adapters over virtual ones. */
function detectLanIp(): string | null {
  const candidates: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push({ name, address: a.address });
    }
  }
  if (!candidates.length) return null;
  // Docker/WSL/Hyper-V adapters are not reachable from a phone on the wifi.
  const real = candidates.find(c => !/vethernet|wsl|hyper-v|docker|vmware|virtualbox/i.test(c.name));
  return (real ?? candidates[0]).address;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const done = (inUse: boolean) => { socket.destroy(); resolve(inUse); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    setTimeout(() => done(false), 700);
  });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Process helpers ───────────────────────────────────────────────────────────

/**
 * Absolute path to a workspace-local binary. On Windows the runnable file is
 * the `.CMD` shim, which requires `shell: true` to spawn — hence the quoting
 * in `run`/`start` below (the repo path contains spaces).
 */
function bin(pkgDir: string, name: string): string {
  const p = path.join(ROOT, pkgDir, 'node_modules', '.bin', name);
  return IS_WIN ? `${p}.CMD` : p;
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const line = [cmd, ...args].map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  return spawnSync(line, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdio: 'inherit',
    shell: true,
  });
}

const children: { name: string; proc: ChildProcess }[] = [];

function start(name: string, color: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const line = [cmd, ...args].map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  const proc = spawn(line, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tag = `${color}${name.padEnd(6)}${C.reset} ${C.dim}│${C.reset} `;
  const pipe = (stream: NodeJS.ReadableStream | null) => {
    let buffer = '';
    stream?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const l of lines) console.log(tag + l);
    });
  };
  pipe(proc.stdout);
  pipe(proc.stderr);

  proc.on('exit', code => {
    if (shuttingDown) return;
    console.log(`${tag}${C.red}exited with code ${code}${C.reset}`);
  });

  children.push({ name, proc });
  return proc;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${C.dim}Stopping ${children.length} service(s)…${C.reset}`);
  for (const { proc } of children) {
    if (proc.pid == null || proc.killed) continue;
    // On Windows a shell-spawned child owns a process tree that SIGTERM misses.
    if (IS_WIN) spawnSync(`taskkill /pid ${proc.pid} /T /F`, { shell: true, stdio: 'ignore' });
    else proc.kill('SIGTERM');
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Database ──────────────────────────────────────────────────────────────────

async function ensureDatabase(env: Record<string, string>, dbPort: number) {
  const probe = spawnSync('docker info --format "{{.ServerVersion}}"', { shell: true, stdio: 'pipe' });
  if (probe.status !== 0) {
    fail('Docker is not running. Start Docker Desktop, or pass --no-db if Postgres is already up.');
  }

  log('Starting Postgres container…');
  const up = run('docker', ['compose', 'up', '-d', 'db'], { env });
  if (up.status !== 0) fail('`docker compose up -d db` failed.');

  process.stdout.write(`${C.cyan}▸${C.reset} Waiting for Postgres to accept connections`);
  for (let i = 0; i < 45; i++) {
    const health = spawnSync(
      'docker inspect --format "{{.State.Health.Status}}" mind-canvas-db',
      { shell: true, stdio: 'pipe', encoding: 'utf8' },
    );
    if (health.stdout?.trim() === 'healthy') {
      console.log(` ${C.green}ready${C.reset}`);
      return;
    }
    process.stdout.write('.');
    await sleep(1000);
  }
  console.log();
  fail(`Postgres did not become healthy. Check: docker logs mind-canvas-db`);
}

function pushSchema(env: Record<string, string>) {
  log('Pushing Drizzle schema…');
  const res = run(bin('lib/db', 'drizzle-kit'), ['push', '--config', './drizzle.config.ts'], {
    cwd: path.join(ROOT, 'lib', 'db'),
    env,
  });
  if (res.status !== 0) fail('Schema push failed.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const has = (flag: string) => argv.includes(flag);
  const only = argv.find(a => a.startsWith('--only='))?.split('=')[1];

  const fileEnv = loadEnvFile(path.join(ROOT, '.env'));
  if (!existsSync(path.join(ROOT, '.env'))) {
    warn('No .env found — using defaults. Copy .env.example to .env to customise.');
  }

  const env: Record<string, string> = {
    DATABASE_URL: 'postgresql://mindcanvas:mindcanvas@localhost:5432/mindcanvas',
    DB_PORT: '5432',
    API_PORT: '8080',
    WEB_PORT: '22107',
    MOBILE_PORT: '18991',
    LOCAL_LAN_IP: '',
    MAP_API_TOKEN: '',
    VITE_MAP_API_TOKEN: '',
    EXPO_PUBLIC_MAP_API_TOKEN: '',
    ...fileEnv,
  };

  const apiPort = Number(env.API_PORT);
  const webPort = Number(env.WEB_PORT);
  const mobilePort = Number(env.MOBILE_PORT);
  const dbPort = Number(env.DB_PORT);

  const wantMobile = has('--mobile') || only === 'mobile';
  const wantApi = !only || only === 'api';
  const wantWeb = !only || only === 'web';

  console.log(`\n${C.bold}Mind Canvas — local development${C.reset}\n`);

  // ── Database ────────────────────────────────────────────────────────────────
  if (!has('--no-db')) {
    await ensureDatabase(env, dbPort);
    if (!has('--no-push')) pushSchema(env);
  } else {
    log('Skipping database startup (--no-db).');
  }

  // ── Port conflicts ──────────────────────────────────────────────────────────
  for (const [name, port, wanted] of [
    ['API', apiPort, wantApi],
    ['web', webPort, wantWeb],
    ['mobile', mobilePort, wantMobile],
  ] as const) {
    if (wanted && (await portInUse(port))) {
      fail(`Port ${port} (${name}) is already in use. Stop the other process or change the port in .env.`);
    }
  }

  // ── Mobile target address ───────────────────────────────────────────────────
  const lanIp = env.LOCAL_LAN_IP || detectLanIp();
  const mobileApiUrl = `http://${lanIp ?? 'localhost'}:${apiPort}`;

  // ── Start services ──────────────────────────────────────────────────────────
  if (env.MAP_API_TOKEN && (!env.VITE_MAP_API_TOKEN || !env.EXPO_PUBLIC_MAP_API_TOKEN)) {
    warn('MAP_API_TOKEN is set but VITE_MAP_API_TOKEN and/or EXPO_PUBLIC_MAP_API_TOKEN is not — that client will get 401s from /api/map. All three must match (see .env.example).');
  }

  if (wantApi) {
    // tsx watch restarts on save — no bundle step, unlike the production build.
    start('api', C.magenta, bin('artifacts/api-server', 'tsx'), ['watch', 'src/index.ts'], {
      NODE_ENV: 'development',
      PORT: String(apiPort),
      DATABASE_URL: env.DATABASE_URL,
      MAP_API_TOKEN: env.MAP_API_TOKEN,
    }, path.join(ROOT, 'artifacts', 'api-server'));
  }

  if (wantWeb) {
    start('web', C.blue, bin('artifacts/mind-canvas', 'vite'), ['--host', '0.0.0.0'], {
      PORT: String(webPort),
      BASE_PATH: '/',
      // Consumed by vite.config.ts to point the /api proxy at the local server.
      API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_MAP_API_TOKEN: env.VITE_MAP_API_TOKEN,
    }, path.join(ROOT, 'artifacts', 'mind-canvas'));
  }

  if (wantMobile) {
    if (!lanIp) warn('Could not detect a LAN IP — a physical device will not reach the API.');
    start('mobile', C.green, bin('artifacts/mind-canvas-mobile', 'expo'), ['start', '--port', String(mobilePort)], {
      // Explicit base URL beats the EXPO_PUBLIC_DOMAIN/https path used in production.
      EXPO_PUBLIC_API_URL: mobileApiUrl,
      REACT_NATIVE_PACKAGER_HOSTNAME: lanIp ?? 'localhost',
      EXPO_PUBLIC_MAP_API_TOKEN: env.EXPO_PUBLIC_MAP_API_TOKEN,
    }, path.join(ROOT, 'artifacts', 'mind-canvas-mobile'));
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  await sleep(1500);
  console.log(`\n${C.bold}Running${C.reset}`);
  if (wantWeb) {
    console.log(`  web      ${C.bold}http://localhost:${webPort}${C.reset}`);
    console.log(`  ${C.dim}         /api proxied to the API server (same-origin, as in production)${C.reset}`);
  }
  if (wantApi) {
    console.log(`  api      http://localhost:${apiPort}/api/map`);
    console.log(`  ${C.dim}         health: http://localhost:${apiPort}/api/healthz${C.reset}`);
  }
  if (wantMobile) {
    console.log(`  mobile   Expo on port ${mobilePort} → API at ${C.bold}${mobileApiUrl}${C.reset}`);
    console.log(`  ${C.dim}         press w for browser, or scan the QR code with Expo Go${C.reset}`);
  }
  if (!has('--no-db')) console.log(`  postgres localhost:${dbPort}`);
  console.log(`\n${C.dim}Ctrl+C to stop everything.${C.reset}\n`);
}

main().catch(err => fail(err instanceof Error ? err.message : String(err)));
