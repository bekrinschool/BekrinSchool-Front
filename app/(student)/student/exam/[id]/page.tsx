import { redirect } from "next/navigation";

export default function StudentExamRunGuardPage() {
  redirect("/student?msg=exam-finished");
}

