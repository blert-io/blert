export type CamelToSnakeCaseString<S extends string> =
  S extends `${infer T}${infer U}`
    ? `${T extends Capitalize<T> ? '_' : ''}${Lowercase<T>}${CamelToSnakeCaseString<U>}`
    : S;

export type CamelToSnakeCase<T> = T extends object
  ? {
      [K in keyof T as CamelToSnakeCaseString<K & string>]: CamelToSnakeCase<
        T[K]
      >;
    }
  : T;

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function camelToSnakeObject<T>(object: T): CamelToSnakeCase<T> {
  return Object.fromEntries(
    Object.entries(object as {}).map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = camelToSnakeObject(value);
      }
      return [camelToSnake(key), value];
    }),
  ) as CamelToSnakeCase<T>;
}
