import { Stack } from "@chakra-ui/react";

import { ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  type ModuleKey,
  type Permissions,
} from "@/lib/permissions";

/** The level in plain words for the "my permissions" page. */
export function permissionWords(
  module: ModuleKey,
  level: Permissions[ModuleKey],
): string {
  if (level === "off") return module === "family_finance" ? "can't see" : "off";
  return level === "view" ? "can see" : "on";
}

/** Every module with the level `permissions` gives it, such as "Expenses: on". */
export function PermissionList({ permissions }: { permissions: Permissions }) {
  return (
    <Stack as="ul" gap="0" m="0" p="0">
      {MODULE_KEYS.map((module) => {
        const level = permissions[module];
        return (
          <ListRow
            key={module}
            title={`${MODULE_LABELS[module]}: ${permissionWords(module, level)}`}
            trailing={
              <StatusBadge tone={level === "off" ? "neutral" : "positive"}>
                {level === "off" ? "Off" : "Allowed"}
              </StatusBadge>
            }
          />
        );
      })}
    </Stack>
  );
}
