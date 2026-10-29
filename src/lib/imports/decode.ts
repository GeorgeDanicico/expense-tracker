import { ImportError } from "@/lib/imports/types";

/**
 * Turns the bytes of a CSV statement into text. The upload guard has already refused binary files,
 * so this only has to pick the encoding:
 * - a UTF-8 byte order mark, or valid UTF-8 without one: UTF-8;
 * - a UTF-16 byte order mark (either byte order): UTF-16;
 * - anything else that isn't valid UTF-8: windows-1250, the single-byte codepage Romanian bank
 *   exports have used. It is only a first guess, to be settled against the real samples at the
 *   plan's checkpoint, and it never fails: every byte maps to some character.
 * The byte order mark is removed. Only `TextDecoder` is used (full-ICU Node has all three).
 */
export function decodeStatementText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decode("utf-16le", bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decode("utf-16be", bytes.subarray(2));
  }

  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return decode("windows-1250", body);
  }
}

function decode(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // The runtime lacks this encoding (a build without full ICU): refuse instead of guessing.
    throw new ImportError("unreadable_statement");
  }
}
