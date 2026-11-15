import type { Metadata } from "next";
import { RecipientsView } from "./view";

export const metadata: Metadata = { title: "Recipients" };
export default function Page() {
  return <RecipientsView />;
}
