import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAdminToken } from "@/lib/auth";
import DashboardClient from "./dashboard-client";

export default async function AdminDashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_session")?.value;
  const session = token ? verifyAdminToken(token) : null;

  if (!session) {
    redirect("/admin/login");
  }

  return <DashboardClient adminEmail={session.email} />;
}
