import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SESSION_STORE_PATH = process.env.SALESNAV_SESSION_STORE_PATH || "/app/data/salesnav-session.json";
const RUNTIME_ENV_FILE = process.env.SDR_RUNTIME_ENV_FILE || "/run/sdr-env/.env";
const SETUP_KEY_SHA256 = process.env.SALESNAV_SETUP_KEY_SHA256 || "e6f4f40d0cc94fa32f36d0ab0f4a0b07575ff5ce6aca61a960f0bc850dadd2fa";

export const SALESNAV_SETUP_COOKIE = "salesnav_setup";

export type LinkedInSession = {
  liAt: string;
  jsessionId: string;
  updatedAt?: string;
  source?: "stored" | "environment" | "runtime_env";
};

function unquote(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseRuntimeValue(content: string, key: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const index = normalized.indexOf("=");
    if (index < 1 || normalized.slice(0, index).trim() !== key) continue;
    return unquote(normalized.slice(index + 1));
  }
  return "";
}

async function readStoredSession(): Promise<LinkedInSession | null> {
  try {
    const parsed = JSON.parse(await readFile(SESSION_STORE_PATH, "utf8")) as Partial<LinkedInSession>;
    const liAt = String(parsed.liAt || "").trim();
    if (!liAt) return null;
    return {
      liAt,
      jsessionId: String(parsed.jsessionId || "").trim(),
      updatedAt: String(parsed.updatedAt || ""),
      source: "stored",
    };
  } catch {
    return null;
  }
}

export async function getLinkedInSession(): Promise<LinkedInSession> {
  const stored = await readStoredSession();
  if (stored) return stored;

  const envLiAt = String(process.env.LINKEDIN_LI_AT || "").trim();
  if (envLiAt) {
    return {
      liAt: envLiAt,
      jsessionId: String(process.env.LINKEDIN_JSESSIONID || "").trim(),
      source: "environment",
    };
  }

  try {
    const content = await readFile(RUNTIME_ENV_FILE, "utf8");
    const liAt = parseRuntimeValue(content, "LINKEDIN_LI_AT").trim();
    if (liAt) {
      return {
        liAt,
        jsessionId: parseRuntimeValue(content, "LINKEDIN_JSESSIONID").trim(),
        source: "runtime_env",
      };
    }
  } catch {
    // Optional fallback only.
  }

  return { liAt: "", jsessionId: "" };
}

export async function saveLinkedInSession(liAt: string, jsessionId: string) {
  const cleanLiAt = liAt.trim();
  const cleanJsession = jsessionId.trim();
  if (cleanLiAt.length < 40 || cleanLiAt.length > 6000) throw new Error("li_at looks invalid.");
  if (cleanJsession.length > 1000) throw new Error("JSESSIONID is too long.");

  const payload = JSON.stringify({
    liAt: cleanLiAt,
    jsessionId: cleanJsession,
    updatedAt: new Date().toISOString(),
  });
  await mkdir(dirname(SESSION_STORE_PATH), { recursive: true });
  const temp = `${SESSION_STORE_PATH}.tmp`;
  await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, SESSION_STORE_PATH);
  await chmod(SESSION_STORE_PATH, 0o600);
}

export async function clearLinkedInSession() {
  await mkdir(dirname(SESSION_STORE_PATH), { recursive: true });
  const temp = `${SESSION_STORE_PATH}.tmp`;
  await writeFile(temp, JSON.stringify({ liAt: "", jsessionId: "", updatedAt: new Date().toISOString() }), { encoding: "utf8", mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, SESSION_STORE_PATH);
  await chmod(SESSION_STORE_PATH, 0o600);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifySalesNavSetupKey(raw: string) {
  const expected = Buffer.from(SETUP_KEY_SHA256, "hex");
  const actual = sha256(String(raw || ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
