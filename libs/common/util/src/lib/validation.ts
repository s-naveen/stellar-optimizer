/**
 * Validates a value by checking if it is a valid value
 * @param val - the value to validate
 * @param validKeys - the valid values
 * @returns the valid value, or undefined
 */
export function validateValue<T>(
  val: unknown,
  validKeys: readonly T[]
): T | undefined {
  if (!validKeys.includes(val as T)) return undefined
  return val as T
}
