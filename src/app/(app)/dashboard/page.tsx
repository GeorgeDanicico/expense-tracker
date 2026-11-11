import { HomeScreen } from "@/components/dashboard/home-screen";
import { ServerFallback } from "@/lib/api/server-fallback";
import { loadHomeFallback } from "@/lib/home/load-home";

/**
 * Home, "today". The Summary, Monthly and History dashboards are Money → Insights (`/insights`).
 * A server component since PF6: it starts each block's data here, without waiting for it, and the
 * blocks stream in as it arrives (`loadHomeFallback`; the pattern is in src/lib/server-prefetch.ts).
 */
export default async function DashboardPage() {
  return (
    <ServerFallback fallback={await loadHomeFallback()}>
      <HomeScreen />
    </ServerFallback>
  );
}
