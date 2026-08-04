export type MaqsamMatchStatus = "matched" | "unmatched" | "ambiguous";
export type MaqsamNoteStatus = "not_applicable" | "pending" | "synced" | "already_synced" | "failed";

export interface MaqsamTranscriptSegment {
  speaker?: string;
  startTime?: number;
  endTime?: number;
  content?: string;
}

export interface MaqsamCallRecord {
  callKey: string;
  callId?: string | number | null;
  referenceId?: string | number | null;
  agentEmail?: string;
  agentName?: string;
  phone?: string;
  direction?: string;
  state?: string;
  timestamp?: number | null;
  noteTimestamp?: string;
  durationSeconds?: number;
  ringingTimeSeconds?: number;
  holdTimeSeconds?: number;
  waitingTimeSeconds?: number;
  handlingTimeSeconds?: number;
  summary?: string;
  summaryLanguage?: string;
  transcription?: string;
  segments?: MaqsamTranscriptSegment[];
  sentiment?: string;
  tags?: string[];
  matchStatus?: MaqsamMatchStatus;
  hubspotContactId?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactMobilePhone?: string;
  contactMatchScore?: number;
  hubspotNoteStatus?: MaqsamNoteStatus;
  hubspotNoteId?: string | null;
  firstReceivedAt?: string;
  updatedAt?: string;
}

export interface MaqsamCallsResponse {
  meta: {
    generatedAt: string;
    totalStored: number;
    portalId: string;
  };
  calls: MaqsamCallRecord[];
}
