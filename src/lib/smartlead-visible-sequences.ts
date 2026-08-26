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
    subject: "سؤال عن التوظيف يا {{first_name}}",
    body: `هلا {{first_name}},

سؤال سريع: هل يأخذ {{industry_pain}} وقتا كبيرا من الفريق؟

Talentera تجمع رحلة التوظيف من التقديم إلى العرض في مسار واحد، وتقلل المتابعة اليدوية بين فريق التوظيف والمديرين.

هل يناسبك نستعرضها في 10 دقائق؟

ماريتا شديد
Talentera`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `هلا {{first_name}},

أرجع لك بخصوص رسالتي السابقة.

الفكرة ببساطة إن مراحل التوظيف والموافقات تكون واضحة في مكان واحد، بدون تغيير مفاجئ لطريقة عمل الفريق.

هل هذا ضمن الأشياء اللي تبغون تحسنونها حاليا؟

ماريتا شديد
Talentera`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `هلا {{first_name}},

أقفل الموضوع من جهتي حتى ما أكثر عليك الرسائل.

إذا تنظيم رحلة التوظيف صار أولوية، رد بكلمة "مناسب" وأرسل لك موعدا يناسبك.

ماريتا شديد
Talentera`,
  },
];

const TALENTERA_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Hiring process, {{first_name}}",
    body: `Hi {{first_name}},

Quick question: how are you currently handling {{industry_pain}}?

Talentera brings the journey from application to offer into one workflow, reducing manual follow-up between recruiters, hiring managers and approvers.

Would a 10-minute walkthrough be useful?

Marita Chedid
Talentera`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `Hi {{first_name}},

Following up on my earlier note.

The idea is a clearer path from application to offer, without forcing the team to rebuild its current process.

Is that something you are looking to improve this quarter?

Marita Chedid
Talentera`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `Hi {{first_name}},

I'll close the loop here so I don't keep filling your inbox.

If improving the hiring flow becomes a priority, reply "yes" and I'll send over a suitable time.

Marita Chedid
Talentera`,
  },
];

const EVALUFY_AR: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "سؤال عن التوظيف يا {{first_name}}",
    body: `هلا {{first_name}},

سؤال سريع: كيف تتعاملون مع {{industry_pain}} حاليا؟

Evalufy تضيف التقييم والفرز قبل المقابلات بدون تغيير نظام التوظيف الحالي، عشان يتركز وقت الفريق على المرشحين الأنسب.

هل يناسبك نستعرضها في 10 دقائق؟

ماريتا شديد
Evalufy`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `هلا {{first_name}},

أرجع لك بخصوص رسالتي السابقة.

الفكرة ما هي استبدال النظام الحالي. Evalufy تضيف خطوة تقييم موحدة قبل المقابلات، عشان يقابل الفريق قائمة أقوى من المرشحين.

هل هذا ضمن الأشياء اللي تبغون تحسنونها حاليا؟

ماريتا شديد
Evalufy`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `هلا {{first_name}},

أقفل الموضوع من جهتي حتى ما أكثر عليك الرسائل.

إذا التقييم قبل المقابلات صار أولوية، رد بكلمة "مناسب" وأرسل لك موعدا يناسبك.

ماريتا شديد
Evalufy`,
  },
];

const EVALUFY_EN: VisibleSequenceTouch[] = [
  {
    step: 1,
    delayDays: 0,
    framework: "AIDA",
    subject: "Hiring process, {{first_name}}",
    body: `Hi {{first_name}},

Quick question: how are you currently handling {{industry_pain}}?

Evalufy adds assessments and screening before interviews while your current recruitment system stays in place, helping the team focus interview time on stronger candidates.

Would a 10-minute walkthrough be useful?

Marita Chedid
Evalufy`,
  },
  {
    step: 2,
    delayDays: 4,
    framework: "PAS",
    subject: "",
    body: `Hi {{first_name}},

Following up on my earlier note.

The idea is not to replace your recruitment system. Evalufy adds a consistent assessment step before interviews, so recruiters and hiring managers review a stronger shortlist.

Is that worth exploring?

Marita Chedid
Evalufy`,
  },
  {
    step: 3,
    delayDays: 6,
    framework: "Breakup",
    subject: "",
    body: `Hi {{first_name}},

I'll close the loop here so I don't keep filling your inbox.

If pre-interview assessment becomes a priority, reply "yes" and I'll send over a suitable time.

Marita Chedid
Evalufy`,
  },
];

export const VISIBLE_SEQUENCE_LANES: Record<OutreachLane, VisibleSequenceLane> = {
  talentera_ar: { lane: "talentera_ar", product: "talentera", language: "ar", campaignName: "Talentera | Marita SDR | Arabic KSA-GCC | V2", label: "Talentera Arabic", touches: TALENTERA_AR },
  talentera_en: { lane: "talentera_en", product: "talentera", language: "en", campaignName: "Talentera | Marita SDR | English | V2", label: "Talentera English", touches: TALENTERA_EN },
  evalufy_ar: { lane: "evalufy_ar", product: "evalify", language: "ar", campaignName: "Evalufy | Marita SDR | Arabic KSA-GCC | V2", label: "Evalufy Arabic", touches: EVALUFY_AR },
  evalufy_en: { lane: "evalufy_en", product: "evalify", language: "en", campaignName: "Evalufy | Marita SDR | English | V2", label: "Evalufy English", touches: EVALUFY_EN },
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

type SequenceRecord = Record<string, unknown>;

function sequenceObject(value: unknown): SequenceRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SequenceRecord : {};
}

function sequenceRows(value: unknown) {
  if (Array.isArray(value)) return value;
  const root = sequenceObject(value);
  for (const key of ["sequences", "data"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  const data = sequenceObject(root.data);
  return Array.isArray(data.sequences) ? data.sequences as unknown[] : [];
}

export function normalizeSmartleadSequenceText(value: unknown) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function smartleadSequenceSnapshot(value: unknown) {
  return sequenceRows(value).map((row, index) => {
    const item = sequenceObject(row);
    const delay = sequenceObject(item.seq_delay_details || item.delay_details);
    const sequenceNumber = Number(item.seq_number ?? item.sequence_number ?? index + 1);
    return {
      sequenceNumber: Number.isFinite(sequenceNumber) ? sequenceNumber : index + 1,
      subject: normalizeSmartleadSequenceText(item.subject),
      body: normalizeSmartleadSequenceText(item.email_body || item.body),
      delayDays: Number(delay.delay_in_days ?? item.delay_in_days) || 0,
    };
  }).sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

export function smartleadSequenceMatchesLane(lane: OutreachLane, value: unknown) {
  const actual = smartleadSequenceSnapshot(value);
  const expected = VISIBLE_SEQUENCE_LANES[lane].touches.map((touch) => ({
    sequenceNumber: touch.step,
    subject: normalizeSmartleadSequenceText(touch.subject),
    body: normalizeSmartleadSequenceText(touch.body),
    delayDays: touch.delayDays,
  }));
  return actual.length === expected.length
    && actual.every((row, index) => JSON.stringify(row) === JSON.stringify(expected[index]));
}
