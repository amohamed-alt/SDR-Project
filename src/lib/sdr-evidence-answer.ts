import type { DashboardData } from "./types.ts";
import type { DecisionInsights } from "./decision-insights.ts";

/** Useful without a model, explicitly labelled; never impersonates an LLM. */
export function sdrEvidenceAnswer(question: string, data: DashboardData, insights: DecisionInsights) {
  const arabic = /[\u0600-\u06ff]/.test(question);
  const market = insights.bestMarket;
  const icp = insights.bestIcp;
  const marketText = market
    ? arabic ? `السوق الأبرز في العينة الحالية: ${market.name}، فيه ${market.meetings} عميل مرتبط باجتماع من ${market.contacts} (${market.meetingReach}%). دي إشارة لاختبار الاستهداف وليست ضمانًا للنتيجة.` : `${market.name} leads the eligible observed sample: ${market.meetings} contacts with meetings out of ${market.contacts} (${market.meetingReach}%). Test this segment before expanding targeting.`
    : arabic ? "البيانات الحالية لا تكفي لاختيار سوق فائز. زوّد حجم العينة وراجع تسجيل الدولة قبل تغيير الاستهداف." : "No market has enough observed evidence for a winning-market recommendation. Grow the sample and check country coverage before changing targeting.";
  const icpText = icp
    ? arabic ? `أبرز شريحة قابلة للقياس: ${icp.name}، ${icp.meetings} عميل مرتبط باجتماع من ${icp.contacts}.` : `Leading measurable ICP: ${icp.name}, with ${icp.meetings} contacts with meetings out of ${icp.contacts}.`
    : arabic ? `لا توجد شريحة ICP مؤكدة في العينة: حقل Persona موجود لـ${insights.quality.personaKnown} وICP tier لـ${insights.quality.tierKnown} من ${insights.quality.total} عميل.` : `No ICP is established in this sample. Persona is populated for ${insights.quality.personaKnown} and ICP tier for ${insights.quality.tierKnown} of ${insights.quality.total} contacts.`;
  const actionText = arabic
    ? `راجع متابعة ${data.intelligence.meetingsWithoutFollowUp.count} اجتماع، ثم ${data.intelligence.contactsWithConnectedCallsWithoutMeeting.count} عميل تم الاتصال به دون اجتماع، و${data.intelligence.staleDeals.count} صفقة راكدة. افتح السجلات أدناه قبل اتخاذ إجراء.`
    : `Review ${data.intelligence.meetingsWithoutFollowUp.count} meeting follow-up gaps, ${data.intelligence.contactsWithConnectedCallsWithoutMeeting.count} connected contacts without meetings, and ${data.intelligence.staleDeals.count} stale deals. Open the evidence below before acting.`;
  const isIcp = /icp|persona|ideal customer|شريح|عميل مثالي/i.test(question);
  const isMarket = /market|سوق|أسواق|اسواق/i.test(question);
  const isAction = /priorit|today|next action|أولو|اولوي|اليوم|خطوة/i.test(question);
  const answer = isIcp ? icpText : isMarket ? marketText : isAction ? actionText : `${marketText}\n\n${icpText}\n\n${actionText}`;
  return { answer, evidence: isIcp ? ["icps", "quality"] : isMarket ? ["markets", "quality"] : isAction ? ["priorities"] : ["markets", "icps", "quality", "priorities"], model: "Calculated evidence", mode: "evidence" as const, cached: false, citations: [] };
}
