"use client";

import { Button, Flex, Stack, Text } from "@chakra-ui/react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  MODULE_KEYS,
  MODULE_LABELS,
  MODULE_LEVELS,
  MODULE_LEVEL_LABELS,
  PERMISSION_PRESET_KEYS,
  PERMISSION_PRESETS,
  type ModuleKey,
  type Permissions,
  type PermissionPreset,
} from "@/lib/permissions";

const PRESET_LABELS: Record<PermissionPreset, string> = { young_kid: "Young kid", teen: "Teen" };

/** The preset whose levels equal `permissions`, or `null` for a custom mix. */
export function matchingPreset(permissions: Permissions): PermissionPreset | null {
  return (
    PERMISSION_PRESET_KEYS.find((key) => MODULE_KEYS.every((module) => PERMISSION_PRESETS[key][module] === permissions[module])) ??
    null
  );
}

/**
 * Presets plus one control per module. Each control lists only the levels its module allows.
 * Controlled: the parent owns `value`. Also used to create invites and kid accounts.
 */
export function PermissionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: Permissions;
  onChange: (next: Permissions) => void;
  disabled?: boolean;
}) {
  const preset = matchingPreset(value);

  return (
    <Stack gap="4">
      <Stack gap="1.5">
        <Text textStyle="label">Start from</Text>
        <Flex gap="2" wrap="wrap">
          {PERMISSION_PRESET_KEYS.map((key) => (
            <Button
              key={key}
              size="sm"
              variant={preset === key ? "solid" : "outline"}
              colorPalette={preset === key ? "brand" : undefined}
              aria-pressed={preset === key}
              disabled={disabled}
              onClick={() => onChange({ ...PERMISSION_PRESETS[key] })}
            >
              {PRESET_LABELS[key]}
            </Button>
          ))}
          {preset === null ? (
            <Text textStyle="caption" alignSelf="center">
              Custom
            </Text>
          ) : null}
        </Flex>
      </Stack>
      <Stack gap="3">
        {MODULE_KEYS.map((module) => (
          <ModuleControl key={module} module={module} value={value} onChange={onChange} disabled={disabled} />
        ))}
      </Stack>
    </Stack>
  );
}

function ModuleControl({
  module,
  value,
  onChange,
  disabled,
}: {
  module: ModuleKey;
  value: Permissions;
  onChange: (next: Permissions) => void;
  disabled: boolean;
}) {
  const labels = MODULE_LEVEL_LABELS[module] as Record<string, string>;
  const items = (MODULE_LEVELS[module] as readonly string[]).map((level) => ({ value: level, label: labels[level] }));

  return (
    <Flex align="center" justify="space-between" gap="3" wrap="wrap">
      <Text textStyle="bodySm" fontWeight="medium">
        {MODULE_LABELS[module]}
      </Text>
      <fieldset disabled={disabled} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <SegmentedControl
          items={items}
          value={value[module]}
          onValueChange={(level) => onChange({ ...value, [module]: level } as Permissions)}
          aria-label={`${MODULE_LABELS[module]} access`}
          name={`permission-${module}`}
        />
      </fieldset>
    </Flex>
  );
}
