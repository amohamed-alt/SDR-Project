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

كنت حابة أسألك عن نقطة صغيرة. مع {{industry_pain}} غالبا المشكلة مو في خطوة واحدة، قد ما هي في تنقل المرشح بين المراحل وكثرة المتابعة على الفريق.

Talentera تجمع الفرز والمقابلات والموافقات والعروض في مسار واحد وتخفف الشغل اليدوي.

إذا هذا قريب من اللي عندكم، يناسبك أوريك الفكرة في 10 دقايق؟`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "بس أوضح قصدي",
    body: `هلا {{first_name}},

حبيت أرجع لك لأن الفكرة مو إنكم تغيرون كل شيء عندكم.

المقصود إن فريق التوظيف يكون عنده flow أوضح من أول التقديم لحد العرض، بدل المتابعة بين أكثر من خطوة ومكان.

إذا تشوفونها قريبة من احتياج عندكم، نرتب 10 دقايق؟`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "أقفلها من جهتي؟",
    body: `هلا {{first_name}},

ما ودي أزعجك بكثرة المتابعة.

إذا الموضوع مو ضمن الأولويات حاليا أقفله من جهتي.

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

I wanted to ask you something small. With {{industry_pain}}, the friction is often not one step but the handoffs between screening, interviews, approvals and offers.

Talentera brings that journey into one recruitment flow and reduces manual follow-up for the team.

If that sounds close to what you deal with, worth a 10-minute look?`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "Just to clarify",
    body: `Hi {{first_name}},

I wanted to clarify one thing: the idea is not to make you change everything you already use.

It is about giving the recruitment team a cleaner flow from application through screening, interviews, approvals and offers.

If that is relevant on your side, worth 10 minutes?`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "Should I close this?",
    body: `Hi {{first_name}},

I do not want to keep filling your inbox.

If this is not a priority right now, I will close it on my side.

If it is worth a quick look, reply "yes" and I will arrange it with you.`,
  },
];

const EVALUFY_AR: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "سؤال سريع عن المقابلات",
    body: `هلا {{first_name}},

{{opening_line}}

كنت حابة أسألك عن نقطة قبل المقابلات. بما إن عندكم نظام توظيف قائم، الفرصة غالبا تكون في {{industry_pain}} قبل ما يستهلك الفريق وقته في المقابلات.

Evalufy تضيف assessments وscreening فوق الـATS الحالي بدون ما تحتاجون تغيرونه.

إذا الفكرة تهمكم، يناسبك أوريكها في 10 دقايق؟`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "قصدي قبل المقابلة",
    body: `هلا {{first_name}},

بس أوضح قصدي: الـATS يفضل مثل ما هو، وEvalufy تضيف طبقة تقييم وفرز قبل المقابلات.

الفكرة إن وقت الفريق يروح على shortlist أنسب بدل ما يبدأ التقييم داخل المقابلة نفسها.

إذا هذا تحدي عندكم، نرتب 10 دقايق؟`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "أقفلها من جهتي؟",
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
    subject: "Quick question on interviews",
    body: `Hi {{first_name}},

{{opening_line}}

I wanted to ask about one step before interviews. Since you already have a recruitment system, the opportunity is often in {{industry_pain}} before interview time is used.

Evalufy adds assessments and screening on top of the current ATS without replacing it.

If that is relevant, worth a 10-minute look?`,
  },
  {
    step: 2,
    delayDays: 3,
    framework: "PAS",
    subject: "What I meant",
    body: `Hi {{first_name}},

Just to clarify: your ATS stays where it is. Evalufy adds an assessment and screening layer before interviews.

The idea is simply to spend recruiter and hiring-manager time on a stronger shortlist.

If that is a problem you are trying to improve, worth 10 minutes?`,
  },
  {
    step: 3,
    delayDays: 4,
    framework: "Breakup",
    subject: "Should I close this?",
    body: `Hi {{first_name}},

I do not want to keep filling your inbox.

If screening and assessment are not a priority right now, I will close this on my side.

If it is worth a quick look, reply "yes" and I will arrange it with you.`,
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
