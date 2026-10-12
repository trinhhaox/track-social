import { serve } from "@hono/node-server";
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

function shutdown(signal: string): void {
  console.log(`[server] nhận ${signal}, đang dừng…`);
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
