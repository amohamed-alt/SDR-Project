import { Linkedin } from "lucide-react";
import { safeLinkedInProfileUrl } from "@/lib/linkedin-profile";
import styles from "./LinkedInQuickAction.module.css";

export function LinkedInQuickAction({ url, contactName, compact = false }: {
  url?: string;
  contactName?: string;
  compact?: boolean;
}) {
  const profile = safeLinkedInProfileUrl(url);
  const label = `Open ${contactName ? `${contactName}’s ` : ""}LinkedIn profile to message or connect`;
  const className = `${styles.action} ${compact ? styles.compact : ""}`;
  if (!profile) return <span className={`${className} ${styles.unavailable}`} role="img" aria-label="LinkedIn profile unavailable" title="No valid LinkedIn profile saved for this contact">
    <Linkedin size={13} aria-hidden="true"/>{!compact && <span>LinkedIn unavailable</span>}
  </span>;
  // Message/Connect availability depends on the signed-in account and relationship.
  // A profile URL alone cannot safely identify a direct message recipient.
  return <a className={className} href={profile} target="_blank" rel="noopener noreferrer" aria-label={label} title={`${label}. Choose Message or Connect on LinkedIn.`}>
    <Linkedin size={13} aria-hidden="true"/>{!compact && <span>LinkedIn</span>}
  </a>;
}
