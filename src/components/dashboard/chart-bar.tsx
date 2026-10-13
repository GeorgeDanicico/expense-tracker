import { Box } from "@chakra-ui/react";

/** 6px horizontal bar on a `chart.track` background. */
export function ChartBar({ share }: { share: number }) {
  return (
    <Box height="1.5" bg="chart.track" borderRadius="full" overflow="hidden" aria-hidden="true">
      <Box height="full" width={`${Math.max(0, Math.min(100, share))}%`} bg="chart.bar" borderRadius="full" />
    </Box>
  );
}
