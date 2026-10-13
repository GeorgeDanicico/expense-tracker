import { Button } from "@chakra-ui/react";
import Link from "next/link";

/** Ghost xs link for card headers ("View all →"). */
export function CardLink({ href, children }: { href: string; children: string }) {
  return (
    <Button asChild size="xs" variant="ghost" color="fg.muted">
      <Link href={href}>{children} →</Link>
    </Button>
  );
}
