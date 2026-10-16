import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";

import { InviteResult } from "./create-invite-dialog";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

const invite = {
  inviteId: "i",
  code: "ABCD2345",
  url: "https://example.test/join/ABCD2345",
  expiresAt: "2026-10-18T12:00:00Z",
};

describe("InviteResult", () => {
  it("shows the code, the link, two copy buttons and the expiry", () => {
    const html = render(<InviteResult invite={invite} role="kid" />);
    expect(html).toContain("ABCD2345");
    expect(html).toContain("https://example.test/join/ABCD2345");
    expect(html).toContain("Copy invite code");
    expect(html).toContain("Copy invite link");
    expect(html).toContain("Expires");
  });

  it("warns that anyone with the code joins with that role", () => {
    expect(render(<InviteResult invite={invite} role="parent" />)).toContain(
      "Anyone with this code can join as a parent. Share it only with them.",
    );
    expect(render(<InviteResult invite={invite} role="kid" />)).toContain("can join as a kid.");
  });
});
