import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import CAPortfolioClient from "./ca-portfolio-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CAPortfolioPage() {
  await requireOperationsAccess();

  return <CAPortfolioClient />;
}
