import { Router, type IRouter } from 'express';
import fs from 'fs';
import path from 'path';

// Store the map in the workspace root so it survives server restarts.
const MAP_FILE = path.resolve('.data', 'mind-canvas-map.json');

function ensureDir() {
  const dir = path.dirname(MAP_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const router: IRouter = Router();

/** GET /api/map — returns { version, bubbles } or null if nothing saved yet. */
router.get('/map', (_req, res) => {
  try {
    if (!fs.existsSync(MAP_FILE)) { res.json(null); return; }
    const raw = fs.readFileSync(MAP_FILE, 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.json(null);
  }
});

/** PUT /api/map — saves { version, bubbles } to disk. */
router.put('/map', (req, res) => {
  try {
    ensureDir();
    fs.writeFileSync(MAP_FILE, JSON.stringify(req.body), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
