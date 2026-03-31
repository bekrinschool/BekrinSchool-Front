import { Layout } from "@/components/Layout";
import { RoleGuard } from "@/components/RoleGuard";

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard requiredRole="parent">
      <Layout>{children}</Layout>
    </RoleGuard>
  );
}
