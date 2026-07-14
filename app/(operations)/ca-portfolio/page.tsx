import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import CAPortfolioClient from "./ca-portfolio-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CAPortfolioPage() {
  await requireDashboardSession();

  return <CAPortfolioClient />;
}
