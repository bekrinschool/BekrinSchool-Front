import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function HomePage() {
  const cookieStore = await cookies();
  const role = cookieStore.get("userRole")?.value;
  const token = cookieStore.get("accessToken")?.value;

  if (token && role) {
    if (role === "teacher") redirect("/teacher");
    if (role === "student") redirect("/student");
    if (role === "parent") redirect("/parent");
  }
  redirect("/login");
}
