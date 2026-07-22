import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { OperationsShellClient } from "@/components/operations/operations-shell-client";

export default async function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireDashboardSession();

  return (
    <OperationsShellClient userName={session.user.email} userRole={session.user.role}>
      {children}
    </OperationsShellClient>
  );
}
