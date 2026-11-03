import { exportArchiveStream } from "@/lib/account/export";
import type { ExportSection } from "@/lib/account/data-repository";
import { getBucharestToday } from "@/lib/calendar";
import { dataExportAttempts, TOO_MANY_DATA_EXPORTS } from "@/lib/http/rate-limit";
import { PRIVATE_HEADERS, tooManyRequests, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

export const runtime = "nodejs";

/**
 * "Download my data" (security plan S13): a ZIP of everything the signed-in user owns, streamed as
 * it's read (`exportArchiveStream`). A `POST`, so the request guard (S5) refuses one started by
 * another site, and the page saves the response as a file.
 *
 * Only the caller's own rows: `export_my_data()` filters every section on the caller, so a parent's
 * export never holds their kids' finances, and no other member's details or any secret are in it.
 *
 * The first section is read before the response starts, so a failure there (the database, or S13's
 * migration missing) is an ordinary JSON error. A later failure ends the download with an error
 * instead of a ZIP that looks complete. Every attempt counts toward `DATA_EXPORT_MAX_ATTEMPTS` an
 * hour (429 past it): an export reads every table.
 */
export const POST = withUser(async (_request, user) => {
  const wait = dataExportAttempts.retryAfterSeconds(user.id);
  if (wait > 0) return tooManyRequests(TOO_MANY_DATA_EXPORTS, wait);
  dataExportAttempts.recordAttempt(user.id);

  const { accountData, avatars } = getRepositories();
  const reader = await accountData.openExport();
  const profile = await reader.section("profile");

  const picturePath = await avatars.getPath(user.id);
  const picture = picturePath ? await avatars.read(picturePath) : null;

  const stream = exportArchiveStream({
    readSection: (section: ExportSection) => (section === "profile" ? Promise.resolve(profile) : reader.section(section)),
    picture: picture ? new Uint8Array(picture) : null,
  });

  const day = getBucharestToday();
  return new Response(stream, {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="my-data-${day}.zip"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}, { failure: "Unable to prepare your data. Please try again." });
