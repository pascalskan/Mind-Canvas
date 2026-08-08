import { pgTable, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const mindCanvasMapTable = pgTable("mind_canvas_map", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type MindCanvasMap = typeof mindCanvasMapTable.$inferSelect;
