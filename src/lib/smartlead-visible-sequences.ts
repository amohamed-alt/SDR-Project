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
    subject: "سؤال سريع يا {{first_name}}",
    body: `هلا {{first_name}},

{{opening_line}}

كنت حابة أسألك عن نقطة في التوظيف عندكم.

مع {{industry_pain}}، اللي يستهلك وقت الفريق غالبا هو متابعة المرشح بين الفرز والمقابلات والموافقات والعرض.

Talentera تجمع رحلة التوظيف في مكان واحد وتخفف المتابعة اليدوية على الفريق.

إذا هذا قريب من اللي عندكم، يناسبك أعرض لك الفكرة في 10 دقايق؟`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `هلا {{first_name}},

بس أوضح قصدي: مو المقصود إنكم تغيرون طريقتكم بالكامل.

الفكرة إن رحلة المرشح تكون أوضح للفريق من أول التقديم لحد العرض، بدل المتابعة بين أكثر من مكان.

إذا هذا شيء تبغون تحسنونه، نرتب 10 دقايق؟`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `هلا {{first_name}},

ما ودي أزعجك بكثرة المتابعة.

إذا تطوير رحلة التوظيف مو ضمن الأولويات حاليا أقفلها من جهتي.

وإذا يستاهل نظرة سريعة، رد بكلمة "مناسب" وأنا أرتبها معك.`,
  },
];

const TALENTERA_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Quick question, {{first_name}}",
    body: `Hi {{first_name}},

{{opening_line}}

I wanted to ask you about one part of the hiring process.

With {{industry_pain}}, a lot of recruiter time can disappear in the handoffs between screening, interviews, approvals and offers.

Talentera brings that journey into one recruitment flow and reduces the manual follow-up around it.

If that sounds relevant, worth a quick 10-minute look?`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `Hi {{first_name}},

Just to clarify: I am not suggesting you change everything you already do.

The idea is simply to give the recruitment team a cleaner path from application through offer, with fewer manual handoffs.

If that is something you are looking to improve, worth 10 minutes?`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `Hi {{first_name}},

I do not want to keep filling your inbox.

If improving the hiring flow is not a priority right now, I will close this on my side.

If it is worth a quick look, reply "yes" and I will arrange it with you.`,
  },
];

const EVALUFY_AR: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "سؤال سريع يا {{first_name}}",
    body: `هلا {{first_name}},

{{opening_line}}

كنت حابة أسألك عن خطوة قبل المقابلات.

بما إن عندكم نظام توظيف قائم، غالبا الفرصة تكون في {{industry_pain}} قبل ما يستهلك الفريق وقته في المقابلات.

Evalufy تضيف التقييم والفرز قبل المقابلات فوق نظام التوظيف الحالي بدون ما تحتاجون تغيرونه.

إذا الفكرة قريبة من احتياجكم، يناسبك أعرضها لك في 10 دقايق؟`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `هلا {{first_name}},

بس أوضح قصدي: نظام التوظيف الحالي يظل مثل ما هو.

Evalufy تضيف طبقة تقييم وفرز قبل المقابلات، بحيث وقت الفريق يروح على قائمة مرشحين أنسب بدل ما يبدأ التقييم داخل المقابلة نفسها.

إذا هذا تحدي عندكم، نرتب 10 دقايق؟`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `هلا {{first_name}},

ما ودي أزعجك بكثرة المتابعة.

إذا الفرز والتقييم مو ضمن الأولويات حاليا أقفل الموضوع من جهتي.

وإذا يستاهل نظرة سريعة، رد بكلمة "مناسب" وأنا أرتبها معك.`,
  },
];

const EVALUFY_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Quick question, {{first_name}}",
    body: `Hi {{first_name}},

{{opening_line}}

I wanted to ask about one step before interviews.

Since you already have a recruitment system in place, the opportunity is often in {{industry_pain}} before interview time is used.

Evalufy adds assessment and screening before interviews without replacing your current recruitment system.

If that sounds relevant, worth a quick 10-minute look?`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `Hi {{first_name}},

Just to clarify: your current recruitment system stays where it is.

Evalufy adds an assessment and screening layer before interviews, so recruiter and hiring-manager time goes to a stronger shortlist.

If that is something you are trying to improve, worth 10 minutes?`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `Hi {{first_name}},

I do not want to keep filling your inbox.

If screening and assessment are not a priority right now, I will close this on my side.

If it is worth a quick look, reply "yes" and I will arrange it with you.`,
  },
];

export const VISIBLE_SEQUENCE_LANES: Record<OutreachLane, VisibleSequenceLane> = {
  talentera_ar: { lane: "talentera_ar", product: "talentera", language: "ar", campaignName: "Talentera | Marita SDR | Arabic KSA-GCC | V1", label: "Talentera Arabic", touches: TALENTERA_AR },
  talentera_en: { lane: "talentera_en", product: "talentera", language: "en", campaignName: "Talentera | Marita SDR | English | V1", label: "Talentera English", touches: TALENTERA_EN },
  evalufy_ar: { lane: "evalufy_ar", product: "evalify", language: "ar", campaignName: "Evalufy | Marita SDR | Arabic KSA-GCC | V1", label: "Evalufy Arabic", touches: EVALUFY_AR },
  evalufy_en: { lane: "evalufy_en", product: "evalify", language: "en", campaignName: "Evalufy | Marita SDR | English | V1", label: "Evalufy English", touches: EVALUFY_EN },
};

export function laneFor(product: OutreachProduct, locale: RecipientLocale): OutreachLane {
  const language = locale === "en" ? "en" : "ar";
  if (product === "evalify") return language === "en" ? "evalufy_en" : "evalufy_ar";
  return language === "en" ? "talentera_en" : "talentera_ar";
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
