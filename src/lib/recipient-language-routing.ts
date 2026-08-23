export type RecipientLocale = "ar-SA" | "ar-GCC" | "en";
export type OutreachProduct = "talentera" | "evalify";
export type SenderBrand = OutreachProduct | "unknown";

export type RecipientLanguageInput = {
  firstName?: string;
  fullName?: string;
  country?: string;
  explicitLanguage?: "ar" | "en" | "";
};

export type RecipientLanguageDecision = {
  locale: RecipientLocale;
  greetingName: string;
  originalFirstName: string;
  confidence: number;
  reason: string;
  translated: boolean;
};

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;
const KSA = /saudi|ksa|kingdom of saudi/i;
const GCC = /saudi|ksa|kingdom of saudi|united arab emirates|\buae\b|dubai|abu dhabi|qatar|kuwait|bahrain|oman/i;

// Conservative deterministic layer. Ambiguous international names such as Adam,
// Sarah, George, Sam and Maya intentionally stay out and can be reviewed by the
// AI recipient-intelligence layer instead of being force-transliterated.
const HIGH_CONFIDENCE_ARABIC_FIRST_NAMES: Record<string, string> = {
  abdallah: "عبدالله", abdullah: "عبدالله", abdulla: "عبدالله",
  abdulaziz: "عبدالعزيز", "abdul-aziz": "عبدالعزيز", abdulrahman: "عبدالرحمن", "abdul-rahman": "عبدالرحمن",
  abdelrahman: "عبدالرحمن", abdurrahman: "عبدالرحمن", abdulmalik: "عبدالملك", abdulmohsen: "عبدالمحسن",
  abdulmohsin: "عبدالمحسن", abdulhadi: "عبدالهادي", abdulmajid: "عبدالمجيد", abdulmajeed: "عبدالمجيد",
  mohammad: "محمد", mohammed: "محمد", muhammad: "محمد", mohamed: "محمد",
  ahmad: "أحمد", ahmed: "أحمد", mahmoud: "محمود", mahmood: "محمود", mostafa: "مصطفى", mustafa: "مصطفى",
  khalid: "خالد", khaled: "خالد", faisal: "فيصل", faysal: "فيصل", fahad: "فهد", nasser: "ناصر", naser: "ناصر",
  saud: "سعود", sultan: "سلطان", turki: "تركي", bader: "بدر", badr: "بدر", majed: "ماجد", majid: "ماجد",
  mansour: "منصور", mansoor: "منصور", hamad: "حمد", hamdan: "حمدان", meshari: "مشاري", mishari: "مشاري",
  moath: "معاذ", muath: "معاذ", muteb: "متعب", moteab: "متعب", nawaf: "نواف", nayef: "نايف", naif: "نايف",
  saleh: "صالح", salman: "سلمان", talal: "طلال", waleed: "وليد", walid: "وليد", yasser: "ياسر", yasir: "ياسر",
  yousef: "يوسف", youssef: "يوسف", yusuf: "يوسف", ibrahim: "إبراهيم", ismail: "إسماعيل", hassan: "حسن",
  hussein: "حسين", hussain: "حسين", osama: "أسامة", ayman: "أيمن", bassam: "بسام", bashar: "بشار",
  marwan: "مروان", tariq: "طارق", tarek: "طارق", ziad: "زياد", rakan: "راكان", rayyan: "ريان", rayan: "ريان",
  maher: "ماهر", tamim: "تميم", tameem: "تميم", hattan: "هتان", hisham: "هشام", hesham: "هشام", ammar: "عمار",
  nabil: "نبيل", nabiel: "نبيل", anas: "أنس", ayoub: "أيوب", ayyoub: "أيوب", saad: "سعد", saeed: "سعيد",
  said: "سعيد", sami: "سامي", sameer: "سمير", samir: "سمير", sohail: "سهيل", suhail: "سهيل", tareq: "طارق",
  wael: "وائل", zakaria: "زكريا", zakariya: "زكريا", zaki: "زكي", omar: "عمر", omer: "عمر",
  amr: "عمرو", ali: "علي", adel: "عادل", adil: "عادل", akram: "أكرم", alaa: "علاء", amer: "عامر", amir: "أمير",
  ashraf: "أشرف", bilal: "بلال", bashir: "بشير", basheer: "بشير", diaa: "ضياء", eyad: "إياد", iyad: "إياد",
  faris: "فارس", fares: "فارس", fadi: "فادي", ghassan: "غسان", haitham: "هيثم", haytham: "هيثم", hany: "هاني",
  harith: "حارث", hazem: "حازم", hosam: "حسام", hossam: "حسام", jawad: "جواد", joud: "جود", kamal: "كمال",
  karim: "كريم", kareem: "كريم", luay: "لؤي", loay: "لؤي", mamdouh: "ممدوح", mohamad: "محمد", mounir: "منير",
  munir: "منير", mustapha: "مصطفى", nader: "نادر", nadir: "نادر", qais: "قيس", qaiss: "قيس", ramzi: "رمزي",
  rami: "رامي", rashid: "راشد", rashed: "راشد", reda: "رضا", ridha: "رضا", saber: "صابر", sabir: "صابر",
  shadi: "شادي", sherif: "شريف", sharif: "شريف", tamer: "تامر", waheed: "وحيد", wahid: "وحيد", zaid: "زيد", zayd: "زيد",
  hessa: "حصة", nouf: "نوف", reem: "ريم", shahad: "شهد", ghada: "غادة", dalal: "دلال", manal: "منال",
  maha: "مها", huda: "هدى", abeer: "عبير", rawan: "روان", maram: "مرام", lamia: "لمياء", lamya: "لمياء",
  nada: "ندى", najla: "نجلاء", najwa: "نجوى", noor: "نور", nour: "نور", rana: "رنا", rania: "رانيا",
  rehab: "رحاب", rihab: "رحاب", salwa: "سلوى", samah: "سماح", shatha: "شذى", shaza: "شذى", wafaa: "وفاء",
  wafa: "وفاء", yasmeen: "ياسمين", yasmin: "ياسمين", zeinab: "زينب", zainab: "زينب",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstToken(value: string) {
  return clean(value).split(/\s+/).filter(Boolean)[0] ?? "";
}

function normalizedLatinName(value: string) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z-]/g, "");
}

function arabicLocale(country: string): RecipientLocale {
  return KSA.test(country) ? "ar-SA" : "ar-GCC";
}

export function isGccCountry(country: string) {
  return GCC.test(clean(country));
}

export function isKsaCountry(country: string) {
  return KSA.test(clean(country));
}

export function decideRecipientLanguage(input: RecipientLanguageInput): RecipientLanguageDecision {
  const country = clean(input.country);
  const firstName = clean(input.firstName) || firstToken(clean(input.fullName));

  if (input.explicitLanguage === "en") return { locale: "en", greetingName: firstName, originalFirstName: firstName, confidence: 1, reason: "Explicit English language signal", translated: false };

  if (input.explicitLanguage === "ar") {
    if (ARABIC_SCRIPT.test(firstName)) return { locale: arabicLocale(country), greetingName: firstName, originalFirstName: firstName, confidence: 1, reason: "Explicit Arabic language signal and Arabic-script first name", translated: false };
    const mapped = HIGH_CONFIDENCE_ARABIC_FIRST_NAMES[normalizedLatinName(firstName)];
    if (mapped) return { locale: arabicLocale(country), greetingName: mapped, originalFirstName: firstName, confidence: 0.99, reason: "Explicit Arabic language signal with high-confidence Arabic first-name mapping", translated: true };
    return { locale: "en", greetingName: firstName, originalFirstName: firstName, confidence: 0.75, reason: "Arabic requested but Latin first name is ambiguous; safe English fallback", translated: false };
  }

  if (!firstName) return { locale: "en", greetingName: "", originalFirstName: "", confidence: 0.95, reason: "Missing first name; safe English fallback without inventing a name", translated: false };
  if (ARABIC_SCRIPT.test(firstName)) return { locale: arabicLocale(country), greetingName: firstName, originalFirstName: firstName, confidence: 1, reason: "Arabic-script first name", translated: false };

  const mapped = HIGH_CONFIDENCE_ARABIC_FIRST_NAMES[normalizedLatinName(firstName)];
  if (mapped && GCC.test(country)) return { locale: arabicLocale(country), greetingName: mapped, originalFirstName: firstName, confidence: 0.97, reason: "GCC location plus high-confidence Arabic first-name mapping", translated: true };

  return {
    locale: "en", greetingName: firstName, originalFirstName: firstName, confidence: 0.95,
    reason: GCC.test(country) ? "GCC location but no reliable Arabic-language name signal; safe English fallback" : "No reliable Arabic-language signal",
    translated: false,
  };
}

export function senderBrand(email: string): SenderBrand {
  const value = clean(email).toLowerCase();
  const domain = value.includes("@") ? value.split("@").pop() ?? "" : value;
  if (/talentera/.test(domain)) return "talentera";
  if (/evalufy|evalify/.test(domain)) return "evalify";
  return "unknown";
}

export function canUseSenderForProduct(email: string, product: OutreachProduct) {
  return senderBrand(email) === product;
}

export function recommendedProduct(input: { explicitProduct?: OutreachProduct | ""; assessmentSignal?: boolean; atsOpportunity?: boolean; }): { product: OutreachProduct; confidence: number; reason: string } {
  if (input.explicitProduct) return { product: input.explicitProduct, confidence: 1, reason: "Explicit product selection" };
  if (input.assessmentSignal) return { product: "evalify", confidence: 0.95, reason: "Verified assessment/screening signal" };
  return { product: "talentera", confidence: input.atsOpportunity ? 0.95 : 0.8, reason: input.atsOpportunity ? "ATS/recruitment workflow opportunity" : "Default product until an Evalify assessment signal is verified" };
}
