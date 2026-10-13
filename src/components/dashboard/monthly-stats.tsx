import { Amount } from "@/components/ui/amount";
import { Stat, StatGroup } from "@/components/ui/stat";

/** Month total (hero) plus transaction count, average and largest expense. */
export function MonthlyStats({
  analytics,
  currency,
}: {
  analytics: { total: number; count: number; average: number; largest: number };
  currency: string;
}) {
  return (
    <StatGroup>
      <Stat size="hero" label="Total" value={<Amount value={analytics.total} currency={currency} size="hero" />} />
      <Stat size="sm" label="Transactions" value={String(analytics.count)} />
      <Stat size="sm" label="Average expense" value={<Amount value={analytics.average} currency={currency} />} />
      <Stat size="sm" label="Largest expense" value={<Amount value={analytics.largest} currency={currency} />} />
    </StatGroup>
  );
}
