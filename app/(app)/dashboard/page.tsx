import type { Metadata } from "next";
import { DashboardView } from "./view";

export const metadata: Metadata = { title: "Activity" };
export default function Page() {
  return <DashboardView />;
}
