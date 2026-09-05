"use client";

import { useRouter } from "next/navigation";
import { BestAccounts } from "@/components/BestAccounts";

export default function BestAccountsPage() {
  const router = useRouter();
  return <BestAccounts onBack={() => router.push("/?view=net-new")}/>;
}
