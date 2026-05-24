export function ensure(
  condition: unknown,
  message = "Expected condition to be true"
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/* Assert that a value is not null, and inform the type checker. */
export function ensureNotNull<T>(
  value: T,
  message = "Expected value to be non-null"
): asserts value is NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
}

export function unimplemented() {
  throw new Error("Unimplemented.");
}

export function isElemRendered(elem: Element): boolean {
  return elem.getClientRects().length > 0;
}
