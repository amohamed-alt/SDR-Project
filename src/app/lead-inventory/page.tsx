"use client";
import { useRouter } from "next/navigation";
import { NetNewAccounts } from "@/components/NetNewAccounts";
export default function LeadInventoryPage() {
  const router = useRouter();
  return <NetNewAccounts inventory onBack={() => router.push("/")}/>;
}
