import { app } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db.js";

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`api listening on http://0.0.0.0:${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));