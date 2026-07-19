import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_STORE_PATH = process.env.GOOGLE_TOKEN_STORE_PATH ?? "/app/data/google-calendar.json";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  expectedEmail: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleUserInfo {
  email: string;
  verified_email?: boolean;
}

interface StoredConnection {
  email: string;
  encryptedRefreshToken: string;
  connectedAt: string;
  updatedAt: string;
}

interface TokenStore {
  version: 1;
  connection?: StoredConnection;
}

export interface CalendarConnectionStatus {
  configured: boolean;
  connected: boolean;
  email?: string;
  connectedAt?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  htmlLink: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
    createRequest?: { status?: { statusCode?: string } };
  };
}

export interface CalendarDraftInput {
  requestId: string;
  title: string;
  description: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  hubspotContactId: string;
  hubspotOwnerId: string;
  createGoogleMeet: boolean;
}

export class GoogleCalendarError extends Error {
  constructor(message: string, public readonly status = 500, public readonly details = "") {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleCalendarError(`${name} is not configured`, 503);
  return value;
}

function config(): GoogleConfig {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: required("GOOGLE_REDIRECT_URI"),
    expectedEmail: process.env.MARITA_GOOGLE_EMAIL?.trim().toLowerCase() ?? "",
  };
}

function encryptionKey() {
  const raw = required("GOOGLE_TOKEN_ENCRYPTION_KEY");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new GoogleCalendarError("GOOGLE_TOKEN_ENCRYPTION_KEY must contain 32 bytes", 503);
  return key;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((item) => item.toString("base64url")).join(".");
}

function decrypt(value: string) {
  const [ivRaw, tagRaw, ciphertextRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new GoogleCalendarError("Stored Google credential is invalid", 503);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function readStore(): Promise<TokenStore> {
  try {
    const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ TOKEN_STORE_PATH, "utf8")) as Partial<TokenStore>;
    if (parsed.version !== 1) throw new Error("Unsupported credential store version");
    return parsed as TokenStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw new GoogleCalendarError("Unable to read the encrypted Google credential store", 503, error instanceof Error ? error.message : "Unknown error");
  }
}

let writeQueue = Promise.resolve();

function writeStore(store: TokenStore) {
  const action = async () => {
    await mkdir(/* turbopackIgnore: true */ dirname(TOKEN_STORE_PATH), { recursive: true });
    const temporaryPath = `${TOKEN_STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/* turbopackIgnore: true */ temporaryPath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(/* turbopackIgnore: true */ temporaryPath, /* turbopackIgnore: true */ TOKEN_STORE_PATH);
  };
  writeQueue = writeQueue.then(action, action);
  return writeQueue;
}

export function isGoogleCalendarConfigured() {
  try {
    config();
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export async function calendarConnectionStatus(): Promise<CalendarConnectionStatus> {
  if (!isGoogleCalendarConfigured()) return { configured: false, connected: false };
  const store = await readStore();
  return store.connection
    ? { configured: true, connected: true, email: store.connection.email, connectedAt: store.connection.connectedAt }
    : { configured: true, connected: false };
}

export function googleAuthorizationUrl(state: string) {
  const settings = config();
  const query = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (settings.expectedEmail) query.set("login_hint", settings.expectedEmail);
  return `${GOOGLE_AUTH_URL}?${query.toString()}`;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as GoogleTokenResponse & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new GoogleCalendarError("Google authorization failed", 502, payload.error_description || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

export async function connectGoogleCalendar(code: string) {
  const settings = config();
  const tokens = await tokenRequest(new URLSearchParams({
    code,
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    redirect_uri: settings.redirectUri,
    grant_type: "authorization_code",
  }));
  const userResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  });
  const user = await userResponse.json().catch(() => ({})) as Partial<GoogleUserInfo>;
  if (!userResponse.ok || !user.email || user.verified_email === false) {
    throw new GoogleCalendarError("Unable to verify the connected Google account", 502);
  }
  const email = user.email.toLowerCase();
  if (settings.expectedEmail && email !== settings.expectedEmail) {
    throw new GoogleCalendarError(`Connect the configured Marita account (${settings.expectedEmail})`, 403);
  }
  const current = await readStore();
  const refreshToken = tokens.refresh_token ?? (current.connection ? decrypt(current.connection.encryptedRefreshToken) : "");
  if (!refreshToken) {
    throw new GoogleCalendarError("Google did not return offline access. Revoke the app permission, then connect again.", 409);
  }
  const now = new Date().toISOString();
  await writeStore({
    version: 1,
    connection: {
      email,
      encryptedRefreshToken: encrypt(refreshToken),
      connectedAt: current.connection?.connectedAt ?? now,
      updatedAt: now,
    },
  });
  return { email };
}

export async function disconnectGoogleCalendar() {
  await writeQueue;
  try {
    await unlink(/* turbopackIgnore: true */ TOKEN_STORE_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function accessToken() {
  const settings = config();
  const store = await readStore();
  if (!store.connection) throw new GoogleCalendarError("Marita Google Calendar is not connected", 409);
  const tokens = await tokenRequest(new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: decrypt(store.connection.encryptedRefreshToken),
    grant_type: "refresh_token",
  }));
  return tokens.access_token;
}

async function calendarRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? JSON.parse(text) as T & { error?: { message?: string } } : undefined;
  if (!response.ok) {
    const details = payload && typeof payload === "object" && "error" in payload ? payload.error?.message : text;
    throw new GoogleCalendarError("Google Calendar request failed", 502, details || `HTTP ${response.status}`);
  }
  return payload as T;
}

function videoLink(event: GoogleCalendarEvent) {
  return event.hangoutLink
    ?? event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
}

export async function createCalendarDraft(input: CalendarDraftInput) {
  const token = await accessToken();
  const eventId = `sdr${input.requestId.replace(/-/g, "").toLowerCase()}`;
  const resource = {
    id: eventId,
    summary: input.title,
    description: input.description,
    start: { dateTime: input.startDateTime, timeZone: input.timeZone },
    end: { dateTime: input.endDateTime, timeZone: input.timeZone },
    reminders: { useDefault: true },
    extendedProperties: {
      private: {
        sdrProjectRequestId: input.requestId,
        hubspotContactId: input.hubspotContactId,
        hubspotOwnerId: input.hubspotOwnerId,
      },
    },
    ...(input.createGoogleMeet ? {
      conferenceData: {
        createRequest: {
          requestId: input.requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    } : {}),
  };
  let event = await calendarRequest<GoogleCalendarEvent>(
    `/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none`,
    token,
    { method: "POST", body: JSON.stringify(resource) },
  );
  if (input.createGoogleMeet && !videoLink(event)) {
    for (let attempt = 0; attempt < 5 && !videoLink(event); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      event = await calendarRequest<GoogleCalendarEvent>(
        `/calendars/primary/events/${encodeURIComponent(event.id)}?conferenceDataVersion=1`, token,
      );
    }
  }
  if (input.createGoogleMeet && !videoLink(event)) {
    await deleteCalendarEvent(event.id, token).catch(() => undefined);
    throw new GoogleCalendarError("Google Meet link could not be generated", 502);
  }
  return { event, accessToken: token, meetLink: videoLink(event) ?? "" };
}

export async function sendCalendarInvitations(eventId: string, attendees: string[], token: string) {
  const uniqueAttendees = [...new Set(attendees.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!uniqueAttendees.length) throw new GoogleCalendarError("At least one invitation recipient is required", 400);
  return calendarRequest<GoogleCalendarEvent>(
    `/calendars/primary/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`,
    token,
    { method: "PATCH", body: JSON.stringify({ attendees: uniqueAttendees.map((email) => ({ email })) }) },
  );
}

export async function deleteCalendarEvent(eventId: string, token?: string) {
  const activeToken = token ?? await accessToken();
  return calendarRequest<void>(
    `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    activeToken,
    { method: "DELETE" },
  );
}
