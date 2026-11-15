import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PayoutView } from "./view";

export const metadata: Metadata = { title: "Cash out (simulated)" };

export default async function Page({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(transferId)) notFound();
  return <PayoutView transferId={transferId} />;
}
