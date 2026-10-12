import { serve } from "@hono/node-server";
import { abortActiveRuns } from "./collectors/apify-client.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/database.ts";
import { JobRunner } from "./jobs/job-runner.ts";
import { startScheduler } from "./jobs/scheduler.ts";
import { createApp } from "./web/app.tsx";

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH);
const runner = new JobRunner(db);
const stopScheduler = config.SCHEDULER_ENABLED ? startScheduler(runner, db, config) : () => {};

const server = serve({ fetch: createApp(db, config, runner).fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`[server] ${config.CAMPAIGN_NAME} chạy tại http://localhost:${info.port} (admin: /admin)`);
});

/** Docker sends SIGKILL 10 s after SIGTERM; finish well before that. */
const SHUTDOWN_TIMEOUT_MS = 8_000;
let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[server] nhận ${signal}, đang dừng…`);
  stopScheduler();
  // Keep-alive connections can hold server.close() open; exit anyway after the timeout.
  setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS).unref();
  const aborted = await abortActiveRuns();
  if (aborted) console.log(`[server] đã huỷ ${aborted} lượt chạy Apify dở dang`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
