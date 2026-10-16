import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";

import { CreateFamilyForm } from "./create-family-form";
import { JoinFamilyForm, joinSummary } from "./join-family-form";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

describe("joinSummary", () => {
  it("names the inviter, the family and the role", () => {
    expect(joinSummary({ familyName: "Popescu", inviterName: "Ana", role: "kid" })).toBe(
      "Ana invited you to join Popescu as a kid.",
    );
  });

  it("falls back to a parent when the inviter is unknown", () => {
    expect(joinSummary({ familyName: "Popescu", inviterName: null, role: "parent" })).toBe(
      "A parent invited you to join Popescu as a parent.",
    );
  });
});

describe("the create and join forms", () => {
  it("asks for a family name", () => {
    const html = render(<CreateFamilyForm />);
    expect(html).toContain("Create a family");
    expect(html).toContain('name="name"');
  });

  it("asks for an invite code and fills in a given one", () => {
    const html = render(<JoinFamilyForm initialCode="ABCD2345" />);
    expect(html).toContain("Join with a code");
    expect(html).toContain('value="ABCD2345"');
  });
});
