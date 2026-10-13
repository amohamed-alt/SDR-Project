"use client";

import { useState } from "react";
import { workspaceWhatsAppFallback } from "@/lib/whatsapp-outreach";
import { LoaderCircle, MessageCircle } from "lucide-react";

type WhatsAppPayload = {
  whatsappUrl?: string;
  whatsappWebUrl?: string;
  whatsappMobileUrl?: string;
  message?: string;
  phone?: {
    selected?: string;
    source?: "whatsapp_number" | "hs_whatsapp_phone_number" | "whatsapp_phone_number" | "mobilephone" | "phone";
    mobileLikely?: boolean;
    alternate?: string;
  };
  style?: string;
  generation?: {
    aiGenerated?: boolean;
    model?: string;
    cached?: boolean;
    languageReason?: string;
  };
  error?: string;
};

const requestCache = new Map<string, Promise<WhatsAppPayload>>();
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
class WhatsAppPreparationError extends Error {
  constructor(message: string, public fallbackAllowed: boolean) { super(message); }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWhatsAppPayload(contactId: string, attempt = 0): Promise<WhatsAppPayload> {
  const response = await fetch("/api/ai/whatsapp-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  let payload: WhatsAppPayload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw) as WhatsAppPayload;
    } catch {
      payload = {};
    }
  }

  if (attempt === 0 && RETRYABLE_STATUS.has(response.status)) {
    await wait(450);
    return requestWhatsAppPayload(contactId, 1);
  }

  if (!response.ok || (!payload.whatsappWebUrl && !payload.whatsappUrl)) {
    const fallbackError = `WhatsApp preparation failed (HTTP ${response.status})`;
    throw new WhatsAppPreparationError(payload.error || fallbackError, RETRYABLE_STATUS.has(response.status) && !/DEMO_MODE/.test(payload.error || ""));
  }

  return payload;
}

function whatsappPayload(contactId: string) {
  const cached = requestCache.get(contactId);
  if (cached) return cached;

  const request = requestWhatsAppPayload(contactId).catch((error) => {
    requestCache.delete(contactId);
    throw error;
  });

  requestCache.set(contactId, request);
  return request;
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function destinationUrl(payload: WhatsAppPayload) {
  if (isMobileDevice()) {
    return payload.whatsappMobileUrl || payload.whatsappWebUrl || payload.whatsappUrl || "";
  }
  return payload.whatsappWebUrl || payload.whatsappUrl || payload.whatsappMobileUrl || "";
}

export function WhatsAppQuickAction({ contactId, fallbackContact }: {
  contactId: string;
  fallbackContact?: { phone: string; country?: string; name?: string; company?: string; title?: string };
}) {
  const [loading, setLoading] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  async function openWhatsApp(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.title = "Opening WhatsApp";
      popup.document.body.style.fontFamily = "Arial, sans-serif";
      popup.document.body.style.padding = "24px";
      popup.document.body.textContent = "Preparing your WhatsApp message…";
    }

    try {
      const payload = await whatsappPayload(contactId);
      const destination = destinationUrl(payload);
      if (!destination) throw new Error("WhatsApp URL was not returned");

      if (popup && !popup.closed) {
        popup.location.replace(destination);
      } else {
        window.location.assign(destination);
      }
    } catch (error) {
      const temporaryFailure = error instanceof WhatsAppPreparationError ? error.fallbackAllowed
        : error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
      const fallback = temporaryFailure && fallbackContact ? workspaceWhatsAppFallback(fallbackContact) : null;
      if (fallback) {
        setUsedFallback(true);
        const destination = destinationUrl(fallback);
        if (popup && !popup.closed) popup.location.replace(destination);
        else window.location.assign(destination);
      } else {
        if (popup && !popup.closed) popup.close();
        window.alert(error instanceof Error ? error.message : "Unable to prepare WhatsApp message");
      }
    } finally {
      setLoading(false);
    }
  }

  return <a
    href="#"
    aria-label="Open WhatsApp with AI message"
    title={usedFallback ? "Prepared from loaded contact details while the message service was unavailable" : "Open WhatsApp with a ready message"}
    onClick={(event) => void openWhatsApp(event)}
  >
    {loading ? <LoaderCircle className="spin" size={13}/> : <MessageCircle size={13}/>} 
  </a>;
}
