import { SalesNavLiveListener } from "@/components/SalesNavLiveListener";
import { SalesNavPipelineV2 } from "@/components/SalesNavPipelineV2";

export const dynamic = "force-dynamic";

export default function SignalHireQueuePage() {
  return <>
    <SalesNavLiveListener/>
    <SalesNavPipelineV2/>
  </>;
}
