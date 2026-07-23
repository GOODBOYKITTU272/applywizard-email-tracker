import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import { OperationsShellClient } from "@/components/operations/operations-shell-client";

export default async function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireOperationsAccess();

  return (
    <OperationsShellClient userName={session.user.email} userRole={session.user.role}>
      {children}
    </OperationsShellClient>
  );
}
