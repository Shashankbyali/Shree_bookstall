import { redirect } from "next/navigation";
import { OwnerDashboard } from "@/components/OwnerDashboard";
import { isOwnerAuthenticated } from "@/lib/auth";

export default async function DashboardPage() {
  if (!(await isOwnerAuthenticated())) {
    redirect("/login");
  }

  return <OwnerDashboard />;
}
