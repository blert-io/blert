type Primitive = string | number | boolean | bigint | symbol | null | undefined;

export type CamelToSnakeCaseString<S extends string> =
  S extends `${infer T}${infer U}`
    ? `${T extends Capitalize<T> ? '_' : ''}${Lowercase<T>}${CamelToSnakeCaseString<U>}`
    : S;

export type CamelToSnakeCase<T> = T extends
  | Primitive
  | Date
  | ((...args: unknown[]) => unknown)
  ? T
  : T extends readonly (infer U)[]
    ? readonly CamelToSnakeCase<U>[]
    : T extends object
      ? {
          [K in keyof T as CamelToSnakeCaseString<
            K & string
          >]: CamelToSnakeCase<T[K]>;
        }
      : T;

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function camelToSnakeObject<T>(object: T): CamelToSnakeCase<T> {
  return Object.fromEntries(
    Object.entries(object as Record<string, unknown>).map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = camelToSnakeObject(value);
      }
      return [camelToSnake(key), value];
    }),
  ) as CamelToSnakeCase<T>;
}

export type SnakeToCamelCaseString<S extends string> =
  S extends `${infer T}_${infer U}`
    ? `${T}${Capitalize<SnakeToCamelCaseString<U>>}`
    : S;

export type SnakeToCamelCase<T> = T extends
  | Primitive
  | Date
  | ((...args: unknown[]) => unknown)
  ? T
  : T extends readonly (infer U)[]
    ? readonly SnakeToCamelCase<U>[]
    : T extends object
      ? {
          [K in keyof T as SnakeToCamelCaseString<
            K & string
          >]: SnakeToCamelCase<T[K]>;
        }
      : T;

export function snakeToCamel(str: string): string {
  return str.replace(/_[a-z]/g, (substring) => substring[1].toUpperCase());
}

export function snakeToCamelObject<T>(object: T): SnakeToCamelCase<T> {
  return Object.fromEntries(
    Object.entries(object as Record<string, unknown>).map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = snakeToCamelObject(value);
      }
      return [snakeToCamel(key), value];
    }),
  ) as SnakeToCamelCase<T>;
}
