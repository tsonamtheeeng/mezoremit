import { notFound } from "next/navigation";
import { ClaimView } from "@/components/claim/claim-view";

export default async function ClaimPage({ params }: { params: Promise<{ transferId: string }> }) {
  const { transferId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(transferId)) notFound();
  return <ClaimView transferId={transferId.toLowerCase()} />;
}
