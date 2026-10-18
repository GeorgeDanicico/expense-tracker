import "server-only";

import sharp from "sharp";

import { DomainError } from "@/lib/errors";

/** Width and height of every stored avatar, in pixels. Shown at up to 64 px, so this covers 3× screens with room to spare. */
export const AVATAR_SIZE = 256;
/** The largest upload accepted, in bytes. Phone photos are 2–4 MB. */
export const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Refuse images over this many pixels before decoding them, so a small file can't expand into gigabytes. */
export const AVATAR_MAX_INPUT_PIXELS = 40_000_000;

export type AvatarUploadType = "image/jpeg" | "image/png";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image type the bytes start with, or `null` when they aren't a JPEG or a PNG. Never trusts names or headers. */
export function sniffImageType(bytes: Uint8Array): AvatarUploadType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "image/png";
  }
  return null;
}

const UNREADABLE = "That image couldn't be read. Try another JPG or PNG.";

/**
 * Re-encodes an uploaded JPG or PNG as the stored avatar: turned upright from its EXIF orientation,
 * cropped to a centred square, `AVATAR_SIZE` px, WebP quality 80. sharp writes no metadata unless
 * asked, so EXIF (including GPS), ICC and XMP data are all dropped. Only the first frame of an
 * animated PNG is kept. Throws a 422 `DomainError` for anything it can't decode as a JPEG or PNG.
 */
export async function toAvatarWebp(input: Uint8Array): Promise<Buffer> {
  if (!sniffImageType(input)) throw new DomainError(UNREADABLE, 422);

  try {
    const image = sharp(input, { failOn: "error", limitInputPixels: AVATAR_MAX_INPUT_PIXELS, pages: 1 });
    const { format } = await image.metadata();
    if (format !== "jpeg" && format !== "png") throw new DomainError(UNREADABLE, 422);

    return await image
      .rotate() // no argument: apply the EXIF orientation, then forget it
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    // sharp's messages describe the file's internals; keep them out of responses.
    throw new DomainError(UNREADABLE, 422);
  }
}
