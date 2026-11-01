import { checkEnv, formatEnvFailure, optionalFeaturesOff } from "@/lib/env";

/**
 * The web app's start-up check: a missing or invalid required variable prints one message naming
 * it (never a value) and exits with 1; a missing optional one only logs one line saying what is off.
 */
export function checkWebEnvironment() {
  const result = checkEnv("web");
  if (!result.ok) {
    console.error(formatEnvFailure("web", result.problems));
    process.exit(1);
  }

  const off = optionalFeaturesOff();
  if (off.length > 0) console.info(`Optional settings not set, so these are off: ${off.join("; ")}.`);
}
