import type { Metadata } from "next";
import { ReceivedView } from "./view";

export const metadata: Metadata = { title: "Received money" };
export default function Page() {
  return <ReceivedView />;
}
