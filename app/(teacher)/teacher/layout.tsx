import { Layout } from "@/components/Layout";
import { RoleGuard } from "@/components/RoleGuard";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard requiredRole="teacher">
      <Layout>{children}</Layout>
    </RoleGuard>
  );
}
