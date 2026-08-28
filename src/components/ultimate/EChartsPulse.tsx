"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";
import type { DailyActivityDatum } from "@/lib/types";

export function EChartsPulse({ data }: { data: DailyActivityDatum[] }) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!nodeRef.current) return;
    const chart = echarts.init(nodeRef.current, undefined, { renderer: "canvas" });
    const recent = data.slice(-21);

    chart.setOption({
      animationDuration: 700,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: 8, right: 10, top: 18, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(7, 28, 23, .96)",
        borderColor: "rgba(139, 232, 188, .18)",
        textStyle: { color: "#e8faf1", fontSize: 11 },
        axisPointer: { type: "line", lineStyle: { color: "rgba(139,232,188,.2)" } },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: recent.map((item) => item.date.slice(5)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "rgba(226,242,233,.48)", fontSize: 9 },
      },
      yAxis: {
        type: "value",
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(255,255,255,.055)" } },
        axisLabel: { color: "rgba(226,242,233,.42)", fontSize: 9 },
      },
      series: [
        {
          name: "Connected",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 3, color: "#4bd59a" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(75,213,154,.30)" },
              { offset: 1, color: "rgba(75,213,154,0)" },
            ]),
          },
          data: recent.map((item) => item.connected),
        },
        {
          name: "Meetings",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: "#8b6cff" },
          data: recent.map((item) => item.meetingsBooked),
        },
      ],
    });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    observer.observe(nodeRef.current);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={nodeRef} className="h-[260px] w-full" aria-label="ECharts connected calls and meetings trend"/>;
}
