/**
 * Recursively transforms a type to represent its JSON-serialized form.
 * Converts Date fields to strings throughout the object tree.
 */
export type ApiResponse<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends Date | undefined
        ? string | undefined
        : T[K] extends object
          ? ApiResponse<T[K]>
          : T[K];
};
