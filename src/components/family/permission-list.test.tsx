import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

import { PermissionList, permissionWords } from "./permission-list";

function render(permissions = DEFAULT_KID_PERMISSIONS) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <PermissionList permissions={permissions} />
    </ChakraProvider>,
  );
}

describe("permissionWords", () => {
  it("says family finance is hidden when off", () => {
    expect(permissionWords("family_finance", "off")).toBe("can't see");
  });

  it("says other modules are off or on", () => {
    expect(permissionWords("investments", "off")).toBe("off");
    expect(permissionWords("expenses", "edit")).toBe("on");
  });

  it("says family finance can be seen at view", () => {
    expect(permissionWords("family_finance", "view")).toBe("can see");
  });
});

describe("PermissionList", () => {
  it("lists every module with its level", () => {
    const html = render();
    expect(html).toContain("Expenses: on");
    expect(html).toContain("Investments: off");
    expect(html).toContain("Net worth: off");
    expect(html).toContain("Family finance: can&#x27;t see");
  });

  it("shows a granted module as on", () => {
    expect(
      render({
        ...DEFAULT_KID_PERMISSIONS,
        net_worth: "edit",
        family_finance: "view",
      }),
    ).toContain("Net worth: on");
  });
});
