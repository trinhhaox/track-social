/**
 * Runs `worker` over `items` with at most `limit` in flight. Per-item failures are
 * collected instead of aborting the rest, so one broken post never blocks the others.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<{ failed: number; firstError: string | null }> {
  let next = 0;
  let failed = 0;
  let firstError: string | null = null;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        await worker(item);
      } catch (error) {
        failed++;
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return { failed, firstError };
}
