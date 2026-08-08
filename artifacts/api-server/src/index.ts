import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./lib/seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Seed the database before accepting traffic so the initial map is available
// on first deploy. The seed is idempotent — it does nothing if a row already exists.
// If the seed or database is unavailable, exit non-zero so the process supervisor
// can restart the server rather than serving traffic without storage.
seedDatabase()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Database initialisation failed — refusing to start");
    process.exit(1);
  });
