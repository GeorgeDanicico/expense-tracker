import { Field, Text, type FieldRootProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

import type { WithoutStyleOverrides } from "@/components/ui/types";

/** Label + control + hint/error, with the shared "(optional)" marker. */
export function FormField({
  label,
  optional = false,
  error,
  hint,
  children,
  ...props
}: WithoutStyleOverrides<Omit<FieldRootProps, "invalid" | "children">> & {
  label: ReactNode;
  optional?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Field.Root invalid={Boolean(error)} {...props}>
      <Field.Label>
        {label}
        {optional ? (
          <Text as="span" color="fg.muted" fontWeight="normal" aria-hidden="true">
            (optional)
          </Text>
        ) : null}
      </Field.Label>
      {children}
      {hint && !error ? <Field.HelperText>{hint}</Field.HelperText> : null}
      <Field.ErrorText>{error}</Field.ErrorText>
    </Field.Root>
  );
}
