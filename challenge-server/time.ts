/** @returns The current UTC date at midnight.  */
export function startOfDateUtc(): Date {
  const date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

/**
 * Executes `operation` and records how long it took to execute.
 *
 * @param operation The operation to execute.
 * @param consumer A function to call with the duration of the operation in
 *   milliseconds.
 * @returns The result of the operation.
 */
export async function timeOperation<T>(
  operation: () => T | Promise<T>,
  consumer: (durationMs: number) => void,
): Promise<T> {
  const start = process.hrtime.bigint();

  try {
    const result = await operation();
    return result;
  } finally {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    consumer(durationMs);
  }
}
