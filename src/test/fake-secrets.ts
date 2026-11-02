/**
 * Made-up secrets for redaction tests, each shaped like the real thing. They're built from parts at
 * runtime so the source never holds one whole and the secret scan (gitleaks over the whole history)
 * has nothing to flag.
 */

/** An email address, and its local part (which must not survive on its own either). */
export const FAKE_EMAIL_LOCAL = "maria.private";
export const FAKE_EMAIL = [FAKE_EMAIL_LOCAL, "family-mail.test"].join("@");

/** The parts of a three-part JWT, each of which must not survive. */
export const FAKE_JWT_PARTS = [
  ["eyJ", "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"].join(""),
  ["eyJ", "zdWIiOiI4ZDBmN2MyZSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0"].join(""),
  ["Qm9", "ndXNTaWduYXR1cmVGb3JUZXN0c09ubHlfMDEyMzQ1Njc4OQ"].join(""),
] as const;
export const FAKE_JWT = FAKE_JWT_PARTS.join(".");

/** The random tail of a Supabase secret key, and the key. */
export const FAKE_SB_SECRET_TAIL = ["Zq8", "Lw3Nv5Rt7Yp9Kd2Hf4Jm6Xc1Bs0"].join("");
export const FAKE_SB_SECRET = ["sb", "secret", FAKE_SB_SECRET_TAIL].join("_");

/** Every fake secret. */
export const FAKE_SECRETS = [FAKE_EMAIL, FAKE_JWT, FAKE_SB_SECRET] as const;

/** Substrings no logged line may contain once the fake secrets have been through redaction. */
export const FAKE_SECRET_MARKERS = [
  FAKE_EMAIL_LOCAL,
  "family-mail",
  // The start of each JWT part, so a JWT cut short to fit a field is caught too.
  ...FAKE_JWT_PARTS.map((part) => part.slice(0, 16)),
  "sb_secret",
  FAKE_SB_SECRET_TAIL.slice(0, 12),
] as const;
