import "server-only";

/**
 * Whether the family module is on. Reads `FAMILY_ENABLED` on every call, so
 * the flag follows the runtime environment (and tests can stub it).
 */
export function isFamilyEnabled(): boolean {
  return process.env.FAMILY_ENABLED === "true";
}
