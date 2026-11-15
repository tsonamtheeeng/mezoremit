import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TransferPage } from "./transfer-page";

export const metadata: Metadata = { title: "Track transfer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <TransferPage id={id} />;
}
