import { AcquisitionDashboard } from "@/components/AcquisitionDashboard";

type AcquisitionOwnerKey = "marita" | "daniel" | "comparison" | "ursula" | "zein";

function initialOwner(value: string | string[] | undefined): AcquisitionOwnerKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "daniel" || candidate === "comparison" || candidate === "ursula" || candidate === "zein"
    ? candidate
    : "marita";
}

function serializedSearch(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <AcquisitionDashboard initialOwner={initialOwner(params.acq)} initialSearch={serializedSearch(params)}/>;
}
