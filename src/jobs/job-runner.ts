import type { DatabaseSync } from "node:sqlite";
import { queryAll } from "../db/posts-repository.ts";

export interface JobRun {
  id: number;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error";
  detail: string | null;
}

/**
 * Runs named jobs one at a time and logs each run to `job_runs`. Serialising all jobs
 * avoids overlapping Apify spend and concurrent writes to the same posts.
 */
export class JobRunner {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Set<string>();

  constructor(private readonly db: DatabaseSync) {}

  isPending(job: string): boolean {
    return this.pending.has(job);
  }

  /** Queues a job; a job already queued or running is not queued twice. Returns false if skipped. */
  enqueue(job: string, task: () => Promise<string>): boolean {
    if (this.pending.has(job)) return false;
    this.pending.add(job);
    this.queue = this.queue
      .then(() => this.execute(job, task))
      // execute() handles task errors; this catches failures of the job_runs bookkeeping
      // itself so the queue never stays rejected and the process never sees an unhandled rejection.
      .catch((error: unknown) => console.error(`[job:${job}] lỗi ghi nhật ký:`, error))
      .finally(() => this.pending.delete(job));
    return true;
  }

  private async execute(job: string, task: () => Promise<string>): Promise<void> {
    const started = this.db
      .prepare("INSERT INTO job_runs (job, started_at, status) VALUES (?, ?, 'running')")
      .run(job, new Date().toISOString());
    const runId = Number(started.lastInsertRowid);
    const finish = (status: "ok" | "error", detail: string): void => {
      this.db
        .prepare("UPDATE job_runs SET finished_at = ?, status = ?, detail = ? WHERE id = ?")
        .run(new Date().toISOString(), status, detail.slice(0, 2000), runId);
    };
    try {
      finish("ok", await task());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[job:${job}] thất bại:`, message);
      finish("error", message);
    }
  }

  lastSuccessAt(job: string): string | null {
    const row = queryAll<{ finished_at: string }>(
      this.db,
      "SELECT finished_at FROM job_runs WHERE job = ? AND status = 'ok' ORDER BY id DESC LIMIT 1",
      job,
    )[0];
    return row?.finished_at ?? null;
  }

  recentRuns(limit = 15): JobRun[] {
    return queryAll<JobRun>(this.db, "SELECT * FROM job_runs ORDER BY id DESC LIMIT ?", limit);
  }
}
