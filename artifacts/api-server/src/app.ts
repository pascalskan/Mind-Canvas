import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Default 100kb is far below what a real map needs: the web client only warns
// the user at 4MB (80% of its 5MB *compressed* localStorage estimate — see
// STORAGE_QUOTA_BYTES/STORAGE_WARN_RATIO in mind-canvas/src/persistence.ts),
// and the PUT body here is uncompressed JSON, larger still for the same map.
// Anything between 100kb and that point 413'd silently, permanently breaking
// cloud sync while local saves kept succeeding. 20mb leaves real headroom
// above the uncompressed size of a map at the web warning threshold.
const JSON_BODY_LIMIT = "20mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

app.use("/api", router);

// Body-parser failures (malformed JSON, a non-object JSON body, a payload over
// JSON_BODY_LIMIT) are thrown by express.json BEFORE any route runs, and
// express's default handler answers them with an HTML error page. Both clients
// call res.json() on a failed save to find out what went wrong, so an HTML body
// turned "your JSON was bad" into an unexplained parse error on the client.
// Normalise those to the same JSON error shape every route already returns.
//
// Declared after the router so it only catches what the routes did not handle.
app.use(
  (
    err: Error & { status?: number; statusCode?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (res.headersSent) {
      next(err);
      return;
    }
    if (status === 413) {
      res.status(413).json({ ok: false, error: `request body exceeds ${JSON_BODY_LIMIT}` });
      return;
    }
    if (status === 400 && err.type !== undefined) {
      res.status(400).json({ ok: false, error: "request body is not valid JSON" });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(status).json({ ok: false, error: "internal server error" });
  },
);

export default app;
