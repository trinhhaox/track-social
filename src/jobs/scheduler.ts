import type { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.ts";
import { refreshComments, refreshStaleMetrics, scanSources, scorePostsWithAi } from "./campaign-jobs.ts";
import type { JobRunner } from "./job-runner.ts";

export const JOB_NAMES = ["scan", "refresh", "comments", "ai"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export const JOB_LABELS: Record<JobName, string> = {
  scan: "Quét hashtag & Fanpage",
  refresh: "Làm mới số liệu",
  comments: "Tải bình luận",
  ai: "AI chấm bài",
};

const DAY_MS = 86_400_000;

export function enqueueJob(name: JobName, runner: JobRunner, db: DatabaseSync, config: AppConfig): boolean {
  const tasks: Record<JobName, () => Promise<string>> = {
    scan: () => scanSources(db, config),
    refresh: () => refreshStaleMetrics(db, config),
    comments: () => refreshComments(db, config),
    ai: () => scorePostsWithAi(db, config),
  };
  return runner.enqueue(name, tasks[name]);
}

/** Which jobs should run now: scanning stops after the campaign, metrics keep updating for a grace period. */
export function jobsDueAt(now: number, config: AppConfig): JobName[] {
  const start = new Date(`${config.CAMPAIGN_START}T00:00:00+07:00`).getTime();
  const end = new Date(`${config.CAMPAIGN_END}T23:59:59+07:00`).getTime();
  if (now < start) return [];
  // One extra day so posts published on the last day are still discovered.
  const scanning = now <= end + DAY_MS;
  const refreshing = now <= end + config.REFRESH_GRACE_DAYS * DAY_MS;
  return [...(scanning ? (["scan"] as const) : []), ...(refreshing ? (["refresh", "comments", "ai"] as const) : [])];
}

/** Starts interval timers; returns a function that stops them. */
export function startScheduler(runner: JobRunner, db: DatabaseSync, config: AppConfig): () => void {
  const runDue = (only: JobName[]): void => {
    const due = jobsDueAt(Date.now(), config).filter((j) => only.includes(j));
    due.forEach((job) => enqueueJob(job, runner, db, config));
  };
  // Scan first so the follow-up jobs see the freshly found posts.
  const scanTimer = setInterval(() => runDue(["scan", "comments", "ai"]), config.SCAN_INTERVAL_HOURS * 3_600_000);
  const refreshTimer = setInterval(() => runDue(["refresh", "comments"]), config.REFRESH_INTERVAL_HOURS * 3_600_000);
  // On boot, only catch up on jobs that have not succeeded within their interval, so restarts
  // and deploys do not trigger extra paid scraper runs.
  const intervalHours: Record<JobName, number> = {
    scan: config.SCAN_INTERVAL_HOURS,
    refresh: config.REFRESH_INTERVAL_HOURS,
    comments: config.REFRESH_INTERVAL_HOURS,
    ai: config.SCAN_INTERVAL_HOURS,
  };
  setTimeout(() => {
    const overdue = JOB_NAMES.filter((job) => {
      const last = runner.lastSuccessAt(job);
      return !last || Date.now() - new Date(last).getTime() > intervalHours[job] * 3_600_000;
    });
    runDue(overdue);
  }, 10_000);
  return () => {
    clearInterval(scanTimer);
    clearInterval(refreshTimer);
  };
}
