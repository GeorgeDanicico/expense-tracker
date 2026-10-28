import { createHash, randomBytes } from "node:crypto";

/**
 * Calendar feed secrets, modelled on the MCP tokens (`@/lib/mcp/tokens`): `sl_cal_` and 43 base64url
 * characters (256 random bits). Only the SHA-256 hash is stored; the secret is shown to its owner
 * once, as part of the feed link. Server only: the client builds the link from the token it's given
 * (`@/lib/family-calendar/feed-link`).
 */
const TOKEN_PREFIX = "sl_cal_";
const TOKEN_PATTERN = /^sl_cal_[A-Za-z0-9_-]{43}$/;
const FEED_FILE_SUFFIX = ".ics";

/** Lowercase hex SHA-256 of the whole token: what `calendar_feeds.token_hash` holds. */
export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new secret from the operating system's secure random generator, with its hash for the database. */
export function generateFeedToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashFeedToken(token) };
}

/**
 * The token in a feed path's last segment (`sl_cal_….ics`), or null when it doesn't have the shape
 * of one of ours, so a stray request never reaches the database. The `.ics` ending is optional.
 */
export function parseFeedToken(segment: string): string | null {
  const token = segment.endsWith(FEED_FILE_SUFFIX) ? segment.slice(0, -FEED_FILE_SUFFIX.length) : segment;
  return TOKEN_PATTERN.test(token) ? token : null;
}
