"use client";

import { Box, Checkbox, Stack, Text } from "@chakra-ui/react";

import {
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  SUBTYPE_LABELS,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/types";

/** Category/subtype checklist for an expense tab. Parent categories include all subtypes. */
export function ExpenseTabCategoryFields({
  categories,
  subtypes,
  onToggleCategory,
  onToggleSubtype,
  error,
}: {
  categories: ExpenseCategory[];
  subtypes: ExpenseSubtype[];
  onToggleCategory: (category: ExpenseCategory, checked: boolean) => void;
  onToggleSubtype: (subtype: ExpenseSubtype, checked: boolean) => void;
  error?: string;
}) {
  return (
    <Box>
      <Text textStyle="label">Included categories</Text>
      <Text textStyle="caption" mt="1">
        Selecting a parent category includes all of its subtypes. To include only particular subtypes, leave the parent unchecked and choose those subtypes below.
      </Text>
      <Stack
        mt="2"
        gap="0"
        borderWidth="1px"
        borderColor="border"
        borderRadius="control"
        divideY="1px"
        divideColor="border"
      >
        {EXPENSE_CATEGORIES.map((category) => {
          const categorySubtypes = EXPENSE_SUBTYPES.filter(
            (subtype) => SUBTYPE_CATEGORIES[subtype] === category,
          );
          const parentSelected = categories.includes(category);
          return (
            <Stack key={category} gap="1.5" px="3" py="2">
              <Checkbox.Root
                size="sm"
                checked={parentSelected}
                onCheckedChange={(details) => onToggleCategory(category, details.checked === true)}
              >
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label fontWeight="medium">
                  {CATEGORY_LABELS[category]}{categorySubtypes.length ? " — includes all subtypes" : ""}
                </Checkbox.Label>
              </Checkbox.Root>
              {categorySubtypes.length ? (
                <Stack ps="6" gap="1.5" aria-label={`${CATEGORY_LABELS[category]} subtypes`}>
                  {categorySubtypes.map((subtype) => (
                    <Checkbox.Root
                      key={subtype}
                      size="sm"
                      checked={parentSelected || subtypes.includes(subtype)}
                      disabled={parentSelected}
                      onCheckedChange={(details) => onToggleSubtype(subtype, details.checked === true)}
                    >
                      <Checkbox.HiddenInput />
                      <Checkbox.Control />
                      <Checkbox.Label>{SUBTYPE_LABELS[subtype]}</Checkbox.Label>
                    </Checkbox.Root>
                  ))}
                  {parentSelected ? (
                    <Text textStyle="caption">
                      Clear {CATEGORY_LABELS[category]} to choose individual subtypes.
                    </Text>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          );
        })}
      </Stack>
      {error ? (
        <Text role="alert" textStyle="caption" color="fg.error" mt="2">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}
