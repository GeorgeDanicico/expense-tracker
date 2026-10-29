import { describe, expect, it } from "vitest";

import { decodeStatementText } from "@/lib/imports/decode";

const utf16le = (text: string, bom = true) =>
  new Uint8Array([...(bom ? [0xff, 0xfe] : []), ...Buffer.from(text, "utf16le")]);
const utf16be = (text: string) =>
  new Uint8Array([0xfe, 0xff, ...Buffer.from(text, "utf16le").swap16()]);

describe("decodeStatementText", () => {
  it("decodes UTF-8", () => {
    expect(decodeStatementText(Buffer.from("Café Müller; 4,50 €", "utf8"))).toBe("Café Müller; 4,50 €");
  });

  it("removes a UTF-8 byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("Date;Amount", "utf8")]);
    expect(decodeStatementText(bytes)).toBe("Date;Amount");
  });

  it("decodes UTF-16 little endian when the byte order mark says so", () => {
    expect(decodeStatementText(utf16le("Café;-4,50\r\n"))).toBe("Café;-4,50\r\n");
  });

  it("decodes UTF-16 big endian when the byte order mark says so", () => {
    expect(decodeStatementText(utf16be("Café;-4,50"))).toBe("Café;-4,50");
  });

  it("only treats UTF-16 as such with a byte order mark", () => {
    const bytes = utf16le("ab", false);
    expect(decodeStatementText(bytes)).not.toBe("ab");
  });

  it("falls back to windows-1250 when the bytes aren't valid UTF-8", () => {
    // "Piaţa Băcănia Ţării": ţ is 0xFE, ă is 0xE3, Ţ is 0xDE in windows-1250.
    const bytes = new Uint8Array([
      ...Buffer.from("Pia"), 0xfe, ...Buffer.from("a B"), 0xe3, ...Buffer.from("c"), 0xe3,
      ...Buffer.from("nia "), 0xde, 0xe3, ...Buffer.from("rii"),
    ]);
    expect(decodeStatementText(bytes)).toBe("Piaţa Băcănia Ţării");
  });

  it("returns an empty text for no bytes", () => {
    expect(decodeStatementText(new Uint8Array())).toBe("");
  });

  it("decodes plain ASCII as it is", () => {
    expect(decodeStatementText(Buffer.from("2026-09-01,Shop,-4.50"))).toBe("2026-09-01,Shop,-4.50");
  });
});
