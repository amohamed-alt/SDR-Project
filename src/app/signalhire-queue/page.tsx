import { SalesNavLiveListener } from "@/components/SalesNavLiveListener";
import { SalesNavPipeline } from "@/components/SalesNavPipeline";

export const dynamic = "force-dynamic";

export default function SignalHireQueuePage() {
  return <>
    <SalesNavLiveListener/>
    <SalesNavPipeline/>
  </>;
}
