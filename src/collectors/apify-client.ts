const APIFY_BASE = "https://api.apify.com/v2";
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);
/** Apify long-polls up to 60 s per request. */
const WAIT_SECONDS = 60;
const MAX_RUN_MINUTES = 60;

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
}

async function apifyFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${APIFY_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout((WAIT_SECONDS + 30) * 1000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Apify ${init?.method ?? "GET"} ${path} lỗi ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/**
 * Starts an Apify actor, waits for it to finish and returns its dataset items.
 * `actorId` uses the "username~actor-name" form, e.g. "apify~facebook-hashtag-scraper".
 */
export async function runActor(token: string, actorId: string, input: unknown): Promise<unknown[]> {
  let { data: run } = await apifyFetch<{ data: ApifyRun }>(
    token,
    `/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=${WAIT_SECONDS}`,
    { method: "POST", body: JSON.stringify(input) },
  );

  const deadline = Date.now() + MAX_RUN_MINUTES * 60_000;
  while (!TERMINAL_STATUSES.has(run.status)) {
    if (Date.now() > deadline) {
      // Abort so the run stops billing; ignore abort failures, the timeout error matters more.
      await apifyFetch(token, `/actor-runs/${run.id}/abort`, { method: "POST" }).catch(() => undefined);
      throw new Error(`Apify run ${run.id} quá ${MAX_RUN_MINUTES} phút, đã huỷ`);
    }
    ({ data: run } = await apifyFetch<{ data: ApifyRun }>(token, `/actor-runs/${run.id}?waitForFinish=${WAIT_SECONDS}`));
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Apify run ${run.id} kết thúc với trạng thái ${run.status}`);

  return apifyFetch<unknown[]>(token, `/datasets/${run.defaultDatasetId}/items?clean=true&format=json`);
}
