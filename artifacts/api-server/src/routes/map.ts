import { Router, type IRouter } from 'express';
import { db, mindCanvasMapTable } from '@workspace/db';
import { eq } from 'drizzle-orm';

const router: IRouter = Router();

/** GET /api/map — returns { version, bubbles } or null if nothing saved yet. */
router.get('/map', async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(mindCanvasMapTable)
      .where(eq(mindCanvasMapTable.id, 1))
      .limit(1);
    if (rows.length === 0) {
      res.json(null);
      return;
    }
    res.json(rows[0].data);
  } catch (err) {
    console.error('GET /api/map error:', err);
    res.json(null);
  }
});

/** PUT /api/map — saves { version, bubbles } to the database. */
router.put('/map', async (req, res) => {
  try {
    await db
      .insert(mindCanvasMapTable)
      .values({ id: 1, data: req.body })
      .onConflictDoUpdate({
        target: mindCanvasMapTable.id,
        set: { data: req.body, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/map error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
