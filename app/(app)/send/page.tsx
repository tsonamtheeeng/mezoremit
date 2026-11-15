import type { Metadata } from "next";
import { SendPage } from "./send-page";

export const metadata: Metadata = { title: "Send money" };

export default async function Page({ searchParams }: { searchParams: Promise<{ resume?: string }> }) {
  const { resume } = await searchParams;
  return <SendPage resumeId={typeof resume === "string" && /^[0-9a-f-]{36}$/i.test(resume) ? resume : null} />;
}
