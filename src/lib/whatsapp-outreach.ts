export type WhatsAppStyle = "saudi-ar" | "emirati-ar" | "gulf-ar" | "english";
export type WhatsAppPhoneSource = "mobilephone" | "phone";

export type WhatsAppPhoneSelection = {
  phone: string;
  digits: string;
  source: WhatsAppPhoneSource;
  mobileLikely: boolean;
  alternatePhone?: string;
  alternateSource?: WhatsAppPhoneSource;
};

type PhoneCandidate = {
  source: WhatsAppPhoneSource;
  raw: string;
  phone: string;
  digits: string;
  mobileLikely: boolean;
};

const COUNTRY_CODES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /^(saudi arabia|ksa|saudi|sa)$/i, code: "966" },
  { pattern: /^(united arab emirates|uae|emirates|ae)$/i, code: "971" },
  { pattern: /^(qatar|qa)$/i, code: "974" },
  { pattern: /^(kuwait|kw)$/i, code: "965" },
  { pattern: /^(bahrain|bh)$/i, code: "973" },
  { pattern: /^(oman|om)$/i, code: "968" },
  { pattern: /^(egypt|eg)$/i, code: "20" },
  { pattern: /^(jordan|jo)$/i, code: "962" },
  { pattern: /^(lebanon|lb)$/i, code: "961" },
];

function clean(value: unknown, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function humanizeWhatsAppMessage(value: unknown, max = 520) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[—–]/g, " ")
    .replace(/[،,.;؛:!…]/g, " ")
    .replace(/([?؟])\1+/g, "$1")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n")
    .trim()
    .slice(0, max);
}

function countryCode(country: string) {
  const normalized = clean(country, 120);
  return COUNTRY_CODES.find((item) => item.pattern.test(normalized))?.code || "";
}

function internationalDigits(raw: string, country: string) {
  const cleaned = clean(raw, 120)
    .replace(/(?:ext\.?|extension|x)\s*\d+$/i, "")
    .trim();
  if (!cleaned) return "";

  let digits = cleaned.replace(/\D/g, "");
  if (!digits) return "";

  if (cleaned.startsWith("00")) digits = digits.slice(2);
  if (cleaned.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? digits : "";

  const code = countryCode(country);
  if (!code) return "";

  if (digits.startsWith(code)) return digits.length >= 8 && digits.length <= 15 ? digits : "";
  digits = digits.replace(/^0+/, "");
  const combined = `${code}${digits}`;
  return combined.length >= 8 && combined.length <= 15 ? combined : "";
}

function isLikelyMobile(digits: string, country: string) {
  const code = countryCode(country);
  if (!digits || !code || !digits.startsWith(code)) return false;
  const national = digits.slice(code.length);

  if (code === "966") return /^5\d{8}$/.test(national);
  if (code === "971") return /^5\d{8}$/.test(national);
  if (code === "20") return /^1[0125]\d{8}$/.test(national);
  if (code === "974") return /^[3567]\d{7}$/.test(national);
  if (code === "965") return /^[569]\d{7}$/.test(national);
  if (code === "973") return /^[36]\d{7}$/.test(national);
  if (code === "968") return /^[79]\d{7}$/.test(national);
  if (code === "962") return /^7\d{8}$/.test(national);
  if (code === "961") return /^(?:3\d{6}|7[0168]\d{6}|81\d{6})$/.test(national);
  return false;
}

function candidate(source: WhatsAppPhoneSource, raw: string, country: string): PhoneCandidate | null {
  const digits = internationalDigits(raw, country);
  if (!digits) return null;
  return {
    source,
    raw,
    digits,
    phone: `+${digits}`,
    mobileLikely: isLikelyMobile(digits, country),
  };
}

export function selectWhatsAppPhone(input: {
  mobilephone?: string | null;
  phone?: string | null;
  country?: string | null;
}) : WhatsAppPhoneSelection | null {
  const country = clean(input.country, 120);
  const candidates = [
    candidate("mobilephone", clean(input.mobilephone), country),
    candidate("phone", clean(input.phone), country),
  ].filter((item): item is PhoneCandidate => Boolean(item));

  const unique = [...new Map(candidates.map((item) => [item.digits, item])).values()];
  if (!unique.length) return null;

  const selected = unique.find((item) => item.source === "mobilephone" && item.mobileLikely)
    ?? unique.find((item) => item.source === "phone" && item.mobileLikely)
    ?? unique.find((item) => item.source === "mobilephone")
    ?? unique[0];
  const alternate = unique.find((item) => item.digits !== selected.digits);

  return {
    phone: selected.phone,
    digits: selected.digits,
    source: selected.source,
    mobileLikely: selected.mobileLikely,
    ...(alternate ? { alternatePhone: alternate.phone, alternateSource: alternate.source } : {}),
  };
}

export function whatsappStyleForCountry(country: string): WhatsAppStyle {
  const value = clean(country, 120).toLowerCase();
  if (/saudi|ksa|\bsa\b/.test(value)) return "saudi-ar";
  if (/united arab emirates|uae|emirates|\bae\b/.test(value)) return "emirati-ar";
  if (/qatar|kuwait|bahrain|oman/.test(value)) return "gulf-ar";
  return "english";
}

export function whatsappFallbackStyle(input: {
  country?: string | null;
  fullName?: string | null;
  title?: string | null;
}) : WhatsAppStyle {
  const linguisticText = `${clean(input.fullName, 180)} ${clean(input.title, 220)}`;
  const hasArabicScript = /[\u0600-\u06FF]/.test(linguisticText);
  if (!hasArabicScript) return "english";
  return whatsappStyleForCountry(clean(input.country, 120));
}

export function whatsappStyleLabel(style: WhatsAppStyle) {
  if (style === "saudi-ar") return "Saudi professional Arabic";
  if (style === "emirati-ar") return "Emirati professional Arabic";
  if (style === "gulf-ar") return "Gulf professional Arabic";
  return "Professional English";
}

export function isWhatsAppStyle(value: unknown): value is WhatsAppStyle {
  return ["saudi-ar", "emirati-ar", "gulf-ar", "english"].includes(String(value || ""));
}

export function firstName(fullName: string) {
  return clean(fullName, 160).split(" ").filter(Boolean)[0] || "";
}

export function deterministicWhatsAppMessage(input: {
  fullName: string;
  company: string;
  title: string;
  style: WhatsAppStyle;
  verifiedHiring?: { activeJobs: number; newJobs30d: number } | null;
}) {
  const name = firstName(input.fullName);
  const company = clean(input.company, 180);
  const role = clean(input.title, 180);
  const hiring = input.verifiedHiring && input.verifiedHiring.activeJobs > 0
    ? input.verifiedHiring
    : null;

  if (input.style === "saudi-ar") {
    const greeting = name ? `السلام عليكم أستاذ ${name} يعطيك العافية` : "السلام عليكم يعطيك العافية";
    const opener = hiring
      ? `شفت عندكم توظيف شغال هالفترة${company ? ` في ${company}` : ""} وبغيت أعرف هل الفرز والمتابعة مع المتقدمين ياخذ من الفريق وقت كثير؟`
      : role
        ? `بغيت أسألك بحكم شغلك في ${role}${company ? ` في ${company}` : ""} هل الفرز والمتابعة للحين فيها شغل يدوي كثير؟`
        : company
          ? `بغيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة في التوظيف بـ${company}؟`
          : "بغيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة مع المرشحين؟";
    return humanizeWhatsAppMessage(`${greeting}\n${opener}\nأسأل لأن عندنا في Talentera طريقة تختصر هالجزء على فريق التوظيف إذا ودك أرسل لك الفكرة باختصار`);
  }

  if (input.style === "emirati-ar") {
    const greeting = name ? `مرحبا أستاذ ${name} يعطيك العافية` : "مرحبا يعطيك العافية";
    const opener = hiring
      ? `شفت عندكم توظيف شغال هالفترة${company ? ` في ${company}` : ""} وحبيت أعرف هل الفرز والمتابعة ياخذ من الفريق وقت كثير؟`
      : role
        ? `حبيت أسألك بحكم دورك في ${role}${company ? ` في ${company}` : ""} هل عندكم جزء كبير من الفرز والمتابعة للحين يدوي؟`
        : company
          ? `حبيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة في التوظيف في ${company}؟`
          : "حبيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة مع المرشحين؟";
    return humanizeWhatsAppMessage(`${greeting}\n${opener}\nأسأل لأن عندنا في Talentera طريقة تخفف هالجزء على فريق التوظيف إذا مناسب أرسل لك الفكرة بسرعة`);
  }

  if (input.style === "gulf-ar") {
    const greeting = name ? `السلام عليكم أستاذ ${name} يعطيك العافية` : "السلام عليكم يعطيك العافية";
    const opener = hiring
      ? `شفت عندكم نشاط بالتوظيف هالفترة${company ? ` في ${company}` : ""} وحبيت أسأل هل الفرز والمتابعة ياخذ من الفريق وقت كثير؟`
      : role
        ? `حبيت أسألك بحكم دورك في ${role}${company ? ` في ${company}` : ""} هل عندكم جزء كبير من الفرز والمتابعة للحين يدوي؟`
        : company
          ? `حبيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة في التوظيف في ${company}؟`
          : "حبيت أعرف كيف ماشي عندكم موضوع الفرز والمتابعة مع المرشحين؟";
    return humanizeWhatsAppMessage(`${greeting}\n${opener}\nأسأل لأن Talentera تختصر هالجزء على فرق التوظيف إذا مناسب أرسل لك الفكرة باختصار`);
  }

  const greeting = name ? `Hi ${name} quick question` : "Hi quick question";
  const opener = hiring
    ? `I saw ${company || "your team"} is hiring right now is screening and candidate follow-up taking a lot of manual time?`
    : role
      ? `Given your role in ${role}${company ? ` at ${company}` : ""} is screening and candidate follow-up still fairly manual for the team?`
      : company
        ? `How are you handling screening and candidate follow-up at ${company} today still fairly manual?`
        : "Is screening and candidate follow-up still fairly manual for your team?";
  return humanizeWhatsAppMessage(`${greeting}\n${opener}\nAsking because Talentera can take a lot of that admin off the team worth sending you a very quick overview?`);
}

export function buildWhatsAppWebUrl(digits: string, message: string) {
  return `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppMobileUrl(digits: string, message: string) {
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppUrl(digits: string, message: string) {
  return buildWhatsAppWebUrl(digits, message);
}
