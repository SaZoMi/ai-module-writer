/**
 * Poll a condition function until it returns a truthy value or the timeout expires.
 *
 * @param condition - Async (or sync) function that returns a value. A truthy value ends the poll.
 * @param options.timeout - Maximum wait time in milliseconds (default: 30000)
 * @param options.interval - Interval between checks in milliseconds (default: 100)
 * @returns The truthy value returned by condition, or throws on timeout.
 */
export async function pollUntil<T>(
  condition: () => T | Promise<T>,
  { timeout = 30000, interval = 100 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const result = await condition();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil timed out after ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
