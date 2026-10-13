import { Alert } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Compact 13px alert for form errors, notices and warnings. */
export function InlineAlert({
  status = "info",
  title,
  children,
  action,
}: {
  status?: "info" | "warning" | "success" | "error" | "neutral";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Alert.Root status={status} alignItems="flex-start">
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        {children ? <Alert.Description>{children}</Alert.Description> : null}
      </Alert.Content>
      {action}
    </Alert.Root>
  );
}
