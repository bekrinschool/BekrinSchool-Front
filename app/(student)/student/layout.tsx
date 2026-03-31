import { Layout } from "@/components/Layout";
import { RoleGuard } from "@/components/RoleGuard";
import { ExamRunProvider } from "@/lib/exam-run-context";

export default function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGuard requiredRole="student">
      <ExamRunProvider>
        <Layout>{children}</Layout>
      </ExamRunProvider>
    </RoleGuard>
  );
}
