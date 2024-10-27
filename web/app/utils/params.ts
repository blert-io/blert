export function parseIntParam<Enum>(
  searchParams: URLSearchParams,
  key: string,
): Enum | undefined {
  const value = searchParams.get(key);
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value);
  return Number.isNaN(parsed) ? undefined : (parsed as Enum);
}
