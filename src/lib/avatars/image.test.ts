import { crc32 } from "node:zlib";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { AVATAR_MAX_INPUT_PIXELS, AVATAR_SIZE, sniffImageType, toAvatarWebp } from "@/lib/avatars/image";
import { DomainError } from "@/lib/errors";

const UNREADABLE = "That image couldn't be read. Try another JPG or PNG.";

/** A plain test image, made at test time so no binary fixtures are committed. */
const photo = (format: "jpeg" | "png", width = 800, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })[format]().toBuffer();

/**
 * A copy of a PNG whose header declares `width`×`height`. Encoding a real 48-megapixel PNG takes
 * a noticeable fraction of a second; rewriting the IHDR chunk (and its CRC) costs nothing.
 */
function withDeclaredSize(png: Buffer, width: number, height: number) {
  const copy = Buffer.from(png);
  // Signature (8 bytes), then IHDR: length (4), type (4), width (4), height (4), … , CRC after 13 data bytes.
  expect(copy.toString("latin1", 12, 16)).toBe("IHDR");
  copy.writeUInt32BE(width, 16);
  copy.writeUInt32BE(height, 20);
  copy.writeUInt32BE(crc32(copy.subarray(12, 29)), 29);
  return copy;
}

const ascii = (text: string) => new TextEncoder().encode(text);

async function expectUnreadable(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  expect(error).toMatchObject({ status: 422, message: UNREADABLE });
}

describe("sniffImageType", () => {
  it("recognises JPEG and PNG bytes", async () => {
    expect(sniffImageType(await photo("jpeg"))).toBe("image/jpeg");
    expect(sniffImageType(await photo("png"))).toBe("image/png");
  });

  it("returns null for anything else", () => {
    expect(sniffImageType(ascii("GIF89a\x01\x00\x01\x00"))).toBeNull();
    expect(sniffImageType(ascii("RIFF\x24\x00\x00\x00WEBPVP8 "))).toBeNull();
    expect(sniffImageType(ascii("just some text"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("toAvatarWebp", () => {
  it.each(["jpeg", "png"] as const)("turns a %s into a square WebP", async (format) => {
    const out = await toAvatarWebp(await photo(format));

    const metadata = await sharp(out).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(AVATAR_SIZE);
    expect(metadata.height).toBe(AVATAR_SIZE);
  });

  it.each([
    ["a portrait", 600, 800],
    ["a tiny", 32, 32],
  ])("makes %s image the full avatar size", async (_label, width, height) => {
    const out = await toAvatarWebp(await photo("jpeg", width, height));

    const metadata = await sharp(out).metadata();
    expect(metadata.width).toBe(AVATAR_SIZE);
    expect(metadata.height).toBe(AVATAR_SIZE);
  });

  it("drops EXIF data", async () => {
    const input = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#808080" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret" } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await toAvatarWebp(input);

    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  it("applies the EXIF orientation and doesn't keep it", async () => {
    const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#808080" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await toAvatarWebp(input);

    expect((await sharp(out).metadata()).orientation).toBeUndefined();
  });

  it("refuses bytes that start like a JPEG but are cut short", async () => {
    const jpeg = await photo("jpeg");

    await expectUnreadable(toAvatarWebp(jpeg.subarray(0, Math.floor(jpeg.length / 2))));
  });

  it("refuses bytes that aren't a JPEG or a PNG", async () => {
    await expectUnreadable(toAvatarWebp(ascii("GIF89a\x01\x00\x01\x00")));
  });

  it("refuses an image over the pixel limit from its header, before decoding it", async () => {
    const huge = withDeclaredSize(await photo("png", 8, 8), 8000, 6000); // 48 megapixels

    // The reason is the pixel limit, not the (deliberately) mismatched pixel data.
    await expect(
      sharp(huge, { limitInputPixels: AVATAR_MAX_INPUT_PIXELS }).toBuffer(),
    ).rejects.toThrow(/exceeds pixel limit/);
    await expectUnreadable(toAvatarWebp(huge));
  });
});
