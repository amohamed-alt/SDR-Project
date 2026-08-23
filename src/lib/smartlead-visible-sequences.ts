import type { OutreachProduct, RecipientLocale } from "@/lib/recipient-language-routing";

export type OutreachLane = "talentera_ar" | "talentera_en" | "evalufy_ar" | "evalufy_en";

export type VisibleSequenceTouch = {
  step: 1 | 2 | 3;
  delayDays: number;
  subject: string;
  body: string;
  framework: "AIDA" | "PAS" | "Breakup";
};

export type VisibleSequenceLane = {
  lane: OutreachLane;
  product: OutreachProduct;
  language: "ar" | "en";
  campaignName: string;
  label: string;
  touches: VisibleSequenceTouch[];
};

const TALENTERA_AR: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "ترتيب رحلة التوظيف",
    body: `هلا {{first_name}},

{{opening_line}}

مع {{industry_pain}} عادة التحدي مو في خطوة واحدة، بل في انتقال المرشح بين الفرز والمقابلات والموافقات والعروض.

Talentera تجمع الرحلة في مسار واحد وتخفف المتابعة اليدوية على فريق التوظيف.

هل يناسبكم أشارككم الفكرة بشكل مختصر؟`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "نقطة عن عملية التوظيف",
    body: `هلا {{first_name}},

أرجع لكم بنقطة واحدة: لما تكون خطوات التوظيف موزعة، غالبا الوقت يروح في المتابعة بين المراحل أكثر من الخطوة نفسها.

Talentera تربط صفحة الوظائف والفرز والمقابلات والموافقات والعروض في workflow أوضح.

هل يستاهل نرتب 10 دقايق ونشوف إذا يناسبكم؟`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "أقفل الموضوع؟",
    body: `هلا {{first_name}},

ما ودي أكثر عليكم.

إذا تطوير رحلة التوظيف مو ضمن الأولويات حاليا، أقفل الموضوع من جهتي.

وإذا مناسب نناقشه، ردوا بكلمة "مناسب" وأنا أرتب معكم الخطوة التالية.`,
  },
];

const TALENTERA_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Your recruitment workflow",
    body: `Hi {{first_name}},

{{opening_line}}

With {{industry_pain}}, the friction is often moving candidates between screening, interviews, approvals and offers.

Talentera brings that journey into one recruitment workflow and reduces manual follow-up for the hiring team.

Worth sharing the idea briefly?`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "One point on hiring flow",
    body: `Hi {{first_name}},

One reason I followed up: when recruitment steps sit across different tools or handoffs, recruiter time often goes into moving candidates between stages.

Talentera connects the career site, screening, interviews, approvals and offers in one flow.

Worth a 10-minute look?`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "Close the loop?",
    body: `Hi {{first_name}},

I do not want to keep chasing you.

If improving the recruitment workflow is not a priority right now, I will close the loop on my side.

If it is relevant, reply "yes" and I will send the next step.`,
  },
];

const EVALUFY_AR: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "الفرز قبل المقابلات",
    body: `هلا {{first_name}},

{{opening_line}}

بما أن عندكم نظام توظيف قائم، غالبا الفرصة تكون في {{industry_pain}} قبل ما يوصل المرشح للمقابلة.

Evalufy تضيف assessments وscreening فوق الـATS الحالي بدون ما تحتاجون تغيرونه.

هل يناسبكم أشارككم كيف تركب على الـworkflow الحالي؟`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "وقت المقابلات",
    body: `هلا {{first_name}},

الفكرة ببساطة: التقييم والفرز يصير قبل المقابلات، فيوصل للفريق عدد أنسب للمراجعة بدل ما يستهلك وقت المقابلات من البداية.

Evalufy تخلي الـATS الحالي كما هو وتضيف طبقة تقييم مستقلة.

هل نرتب 10 دقايق ونشوف إذا تناسبكم؟`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "أقفل الموضوع؟",
    body: `هلا {{first_name}},

ما ودي أكثر عليكم.

إذا تطوير مرحلة الفرز والتقييم مو ضمن الأولويات حاليا، أقفل الموضوع من جهتي.

وإذا مناسب نناقشه، ردوا بكلمة "مناسب" وأنا أرتب معكم الخطوة التالية.`,
  },
];

const EVALUFY_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Screening before interviews",
    body: `Hi {{first_name}},

{{opening_line}}

Since you already have a recruitment system, the opportunity is often in {{industry_pain}} before candidates reach interviews.

Evalufy adds assessments and screening on top of the existing ATS without replacing it.

Worth sharing how it fits the current workflow?`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "Interview time",
    body: `Hi {{first_name}},

The simple idea is to move assessment and screening before interviews, so recruiter and hiring-manager time is used on a better-qualified shortlist.

Evalufy keeps the current ATS in place and adds a separate assessment layer.

Worth a 10-minute look?`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "Close the loop?",
    body: `Hi {{first_name}},

I do not want to keep chasing you.

If improving screening and assessment is not a priority right now, I will close the loop on my side.

If it is relevant, reply "yes" and I will send the next step.`,
  },
];

export const VISIBLE_SEQUENCE_LANES: Record<OutreachLane, VisibleSequenceLane> = {
  talentera_ar: {
    lane: "talentera_ar",
    product: "talentera",
    language: "ar",
    campaignName: "Talentera | Marita SDR | Arabic KSA-GCC | V1",
    label: "Talentera Arabic",
    touches: TALENTERA_AR,
  },
  talentera_en: {
    lane: "talentera_en",
    product: "talentera",
    language: "en",
    campaignName: "Talentera | Marita SDR | English | V1",
    label: "Talentera English",
    touches: TALENTERA_EN,
  },
  evalufy_ar: {
    lane: "evalufy_ar",
    product: "evalify",
    language: "ar",
    campaignName: "Evalufy | Marita SDR | Arabic KSA-GCC | V1",
    label: "Evalufy Arabic",
    touches: EVALUFY_AR,
  },
  evalufy_en: {
    lane: "evalufy_en",
    product: "evalify",
    language: "en",
    campaignName: "Evalufy | Marita SDR | English | V1",
    label: "Evalufy English",
    touches: EVALUFY_EN,
  },
};

export function laneFor(product: OutreachProduct, locale: RecipientLocale): OutreachLane {
  const language = locale === "en" ? "en" : "ar";
  return `${product}_${language}` as OutreachLane;
}

export function smartleadSequencePayload(lane: OutreachLane) {
  return {
    sequences: VISIBLE_SEQUENCE_LANES[lane].touches.map((touch) => ({
      seq_number: touch.step,
      subject: touch.subject,
      email_body: touch.body,
      seq_delay_details: { delay_in_days: touch.delayDays },
    })),
  };
}
