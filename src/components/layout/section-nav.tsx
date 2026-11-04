"use client";

import { Box } from "@chakra-ui/react";
import { useRouter } from "next/navigation";

import { activeItem, activeSection, segmentsFor } from "@/components/layout/nav-items";
import { useAppPathname } from "@/components/layout/use-app-pathname";
import { useNavigation } from "@/components/layout/use-navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PAGE_SPACING } from "@/components/ui/theme/layout";

/**
 * The segmented control at the top of Money and Planning. Each segment is a page at its own URL, so
 * links and bookmarks keep working; a section with one page for this user (Reminders alone without a
 * family) shows nothing.
 */
export function SectionNav() {
  const pathname = useAppPathname();
  const router = useRouter();
  const { sections } = useNavigation();
  const section = activeSection(sections, pathname);
  const segments = section ? segmentsFor(section) : null;
  const current = section ? activeItem(section, pathname) : undefined;
  if (!section || !segments || !current) return null;
  return (
    // Four segments don't fit a 320 px phone: the row scrolls sideways instead of the page.
    <Box mb={PAGE_SPACING.sectionGap} alignSelf={{ md: "flex-start" }} maxW="full" overflowX="auto">
      <SegmentedControl
        aria-label={`${section.label} pages`}
        items={segments}
        value={current.href}
        onValueChange={(href) => router.push(href)}
        fullWidth={{ base: true, md: false }}
      />
    </Box>
  );
}
