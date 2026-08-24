"use client";

import { useRouter } from "next/navigation";
import { NetNewAccounts } from "@/components/NetNewAccounts";

export default function NetNewAccountsPage() {
  const router = useRouter();
  return <NetNewAccounts onBack={() => router.push("/?view=net-new")}/>;
}
