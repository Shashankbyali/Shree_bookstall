import { redirect } from "next/navigation";
import { isOwnerAuthenticated } from "@/lib/auth";
import { OwnerDashboard } from "@/components/OwnerDashboard";

export default async function DashboardPage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login");
  }

  return <OwnerDashboard />;
}
