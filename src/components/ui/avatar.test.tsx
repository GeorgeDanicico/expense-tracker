import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui/avatar";
import { ledgerSystem } from "@/components/ui/theme";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

describe("Avatar", () => {
  it("shows the initials, named for screen readers, when there is no picture", () => {
    const html = render(<Avatar name="Ana Pop" color="member.3" />);
    expect(html).toMatch(/role="img"[^>]*aria-label="Ana Pop"|aria-label="Ana Pop"[^>]*role="img"/);
    expect(html).toContain(">AP<");
    expect(html).not.toContain("<img");
  });

  it("uses a single initial for a one-word name", () => {
    expect(render(<Avatar name="Teo" />)).toContain(">T<");
  });

  it("renders the picture with the name as its alt text when there is one", () => {
    const html = render(<Avatar name="Ana Pop" src="/apple-icon.png" />);
    expect(html).toMatch(/<img[^>]*alt="Ana Pop"/);
    expect(html).toMatch(/<img[^>]*src="\/apple-icon.png"/);
  });

  it("falls back to neutral for a colour that isn't a palette slot", () => {
    // Members past the eighth share `fg.subtle`, which has no `.fg` text token.
    expect(render(<Avatar name="Ana Pop" color="fg.subtle" />)).toBe(render(<Avatar name="Ana Pop" />));
    expect(render(<Avatar name="Ana Pop" color="member.3" />)).not.toBe(render(<Avatar name="Ana Pop" />));
  });

  it("treats a null picture as none", () => {
    expect(render(<Avatar name="Ana Pop" src={null} />)).not.toContain("<img");
  });
});
