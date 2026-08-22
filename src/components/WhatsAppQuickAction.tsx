"use client";

import { useState } from "react";
import { LoaderCircle, MessageCircle } from "lucide-react";

type WhatsAppPayload = {
  whatsappUrl?: string;
  message?: string;
  phone?: {
    selected?: string;
    source?: "mobilephone" | "phone";
    mobileLikely?: boolean;
    alternate?: string;
  };
  style?: string;
  error?: string;
};

const requestCache = new Map<string, Promise<WhatsAppPayload>>();

function whatsappPayload(contactId: string) {
  const cached = requestCache.get(contactId);
  if (cached) return cached;

  const request = fetch("/api/ai/whatsapp-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId }),
    cache: "no-store",
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({})) as WhatsAppPayload;
    if (!response.ok || !payload.whatsappUrl) {
      throw new Error(payload.error || "Unable to prepare WhatsApp message");
    }
    return payload;
  }).catch((error) => {
    requestCache.delete(contactId);
    throw error;
  });

  requestCache.set(contactId, request);
  return request;
}

export function WhatsAppQuickAction({ contactId }: { contactId: string }) {
  const [loading, setLoading] = useState(false);

  async function openWhatsApp(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.document.title = "Preparing WhatsApp";
      popup.document.body.style.fontFamily = "Arial, sans-serif";
      popup.document.body.style.padding = "24px";
      popup.document.body.textContent = "Preparing your WhatsApp message…";
    }

    try {
      const payload = await whatsappPayload(contactId);
      if (!payload.whatsappUrl) throw new Error("WhatsApp URL was not returned");

      if (popup && !popup.closed) {
        popup.location.replace(payload.whatsappUrl);
      } else {
        window.location.assign(payload.whatsappUrl);
      }
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      window.alert(error instanceof Error ? error.message : "Unable to prepare WhatsApp message");
    } finally {
      setLoading(false);
    }
  }

  function prefetch() {
    if (!loading) void whatsappPayload(contactId).catch(() => undefined);
  }

  return <a
    href="#"
    aria-label="Open WhatsApp with AI message"
    title="Open WhatsApp with a ready message"
    onClick={(event) => void openWhatsApp(event)}
    onMouseEnter={prefetch}
    onFocus={prefetch}
  >
    {loading ? <LoaderCircle className="spin" size={13}/> : <MessageCircle size={13}/>} 
  </a>;
}
