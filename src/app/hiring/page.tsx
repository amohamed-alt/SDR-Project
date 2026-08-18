"use client";

import { useRouter } from "next/navigation";
import { HiringIntelligence } from "@/components/HiringIntelligence";

export default function HiringPage() {
  const router = useRouter();
  return <HiringIntelligence onBack={() => router.push("/prospecting")} />;
}
