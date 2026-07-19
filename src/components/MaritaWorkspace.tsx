"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Clock3, ExternalLink,
  Mail, MapPin, Phone, Sparkles, Target, UserRound, Video,
} from "lucide-react";
import type { Drilldown } from "@/components/DrilldownDrawer";
import type { ActivityRow, ContactRow, DashboardData } from "@/lib/types";

type QueueMode = "tasks" | "leads" | "meetings";
type CalendarStatus = { configured: boolean; connected: boolean; email?: string; connectedAt?: string; error?: string };
type BookingResult = {
  calendarUrl: string;
  meetLink?: string;
  hubspotContactUrl: string;
  salesOwner: { name: string; email: string };
  contact: { name: string; email: string };
};

function localDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value));
}

function shortTime(value: string, timezone: string) {
  if (!value) return "No time";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function shortDate(value: string, timezone: string) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, weekday: "short", day: "2-digit", month: "short",
  }).format(new Date(value));
}

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function HubSpotButton({ href, label = "Open" }: { href: string; label?: string }) {
  return <a className="workspace-record-action" href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={12}/></a>;
}

export function MaritaWorkspace({ data, onOpen }: { data: DashboardData; onOpen: (drilldown: Drilldown) => void }) {
  const [queueMode, setQueueMode] = useState<QueueMode>("tasks");
  const [selectedContactId, setSelectedContactId] = useState(data.priorityContacts[0]?.id ?? "");
  const [selectedSalesOwnerId, setSelectedSalesOwnerId] = useState(
    data.filterOptions.owners.find((owner) => owner.id !== data.meta.ownerId)?.id ?? "",
  );
  const [subject, setSubject] = useState("Talentera discovery call");
  const [meetingDate, setMeetingDate] = useState(tomorrowDate);
  const [meetingTime, setMeetingTime] = useState("10:00");
  const [duration, setDuration] = useState("30");
  const [meetingType, setMeetingType] = useState("google-meet");
  const [agenda, setAgenda] = useState("Introduction, current recruitment workflow, priorities, and next steps.");
  const [preview, setPreview] = useState(false);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [calendarError, setCalendarError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);

  const today = localDay(new Date().toISOString(), data.meta.timezone);
  const tasks = useMemo(
    () => data.recentActivities.filter((row) => row.type === "Task" && row.isOpen),
    [data.recentActivities],
  );
  const dueToday = tasks.filter((row) => row.dueBucket === "Due today");
  const highPriorityTasks = tasks.filter((row) => row.isHighPriority);
  const untouchedLeads = data.priorityContacts.filter((row) => !row.lastContacted);
  const meetings = data.recentActivities
    .filter((row) => row.type === "Meeting" && row.isOpen)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  const meetingsToday = meetings.filter((row) => localDay(row.occurredAt, data.meta.timezone) === today);
  const generatedAt = new Date(data.meta.generatedAt).getTime();
  const upcomingMeetings = meetings.filter((row) => new Date(row.occurredAt).getTime() >= generatedAt);
  const selectedContact = data.priorityContacts.find((row) => row.id === selectedContactId) ?? data.priorityContacts[0];
  const salesOwners = data.filterOptions.owners.filter((owner) => owner.id !== data.meta.ownerId);
  const selectedSalesOwner = salesOwners.find((owner) => owner.id === selectedSalesOwnerId) ?? salesOwners[0];

  async function loadCalendarStatus() {
    try {
      const response = await fetch("/api/google/status", { cache: "no-store" });
      const payload = await response.json() as CalendarStatus;
      if (!response.ok) throw new Error(payload.error || "Unable to load Google Calendar status");
      setCalendarStatus(payload);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "Unable to load Google Calendar status");
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadCalendarStatus(); }, []);

  async function disconnectCalendar() {
    if (!window.confirm("Disconnect Marita's Google Calendar from this dashboard?")) return;
    setCalendarError("");
    const response = await fetch("/api/google/status", { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setCalendarError(payload.error || "Unable to disconnect Google Calendar");
      return;
    }
    setCalendarStatus({ configured: true, connected: false });
    setPreview(false);
  }

  function openActivities(title: string, description: string, rows: ActivityRow[], url: string) {
    onOpen({ kind: "activities", title, description, rows, hubspotUrl: url });
  }

  function openContacts(title: string, description: string, rows: ContactRow[]) {
    onOpen({ kind: "contacts", title, description, rows, hubspotUrl: data.meta.hubspotUrls.contacts });
  }

  function submitPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError("");
    setBookingResult(null);
    setPreview(true);
  }

  async function sendMeeting() {
    if (!calendarStatus?.connected || !selectedContact || !selectedSalesOwner) return;
    const confirmation = window.confirm(
      `Send a real calendar invitation to ${selectedSalesOwner.email || selectedSalesOwner.name} and ${selectedContact.email || selectedContact.name}?`,
    );
    if (!confirmation) return;
    setSending(true);
    setSendError("");
    setBookingResult(null);
    try {
      const response = await fetch("/api/google/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          contactId: selectedContact.id,
          salesOwnerId: selectedSalesOwner.id,
          title: subject,
          date: meetingDate,
          time: meetingTime,
          durationMinutes: Number(duration),
          meetingType,
          agenda,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to create the meeting");
      setBookingResult(payload as BookingResult);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Unable to create the meeting");
    } finally {
      setSending(false);
    }
  }

  return <div className="marita-workspace">
    <section className="workspace-hero">
      <div><span className="workspace-eyebrow"><Sparkles size={13}/>MARITA WORKSPACE</span><h2>Good morning, Marita</h2><p>Your live execution queue, lead shortcuts, and meeting preparation in one place.</p></div>
      <div className={"calendar-connection" + (calendarStatus?.connected ? " connected" : "")}><span><i/>MARITA · GOOGLE CALENDAR</span><strong>{calendarStatus?.connected ? "Connected" : calendarStatus ? calendarStatus.configured ? "Ready to connect" : "Server setup missing" : "Checking connection…"}</strong><small>{calendarStatus?.connected ? calendarStatus.email : calendarError || "Marita organizes · Sales rep + lead receive the invite"}</small><div className="calendar-connection-actions">{calendarStatus?.configured && !calendarStatus.connected && <a href="/api/google/connect">Connect calendar</a>}{calendarStatus?.connected && <button type="button" onClick={() => void disconnectCalendar()}>Disconnect</button>}</div></div>
    </section>

    <div className="workspace-stat-grid">
      <WorkspaceStat icon={CalendarDays} label="Tasks due today" value={dueToday.length} helper="Open execution queue" tone="green" onClick={() => openActivities("Tasks due today", "Open tasks due today for Marita.", dueToday, data.meta.hubspotUrls.tasks)}/>
      <WorkspaceStat icon={AlertTriangle} label="High-priority tasks" value={highPriorityTasks.length} helper="Needs attention" tone="purple" onClick={() => openActivities("High-priority tasks", "Open tasks marked High priority.", highPriorityTasks, data.meta.hubspotUrls.tasks)}/>
      <WorkspaceStat icon={Target} label="Untouched leads" value={untouchedLeads.length} helper="Ready for first touch" tone="amber" onClick={() => openContacts("Untouched leads", "Contacts with no logged Last Contacted value.", untouchedLeads)}/>
      <WorkspaceStat icon={Video} label="Meetings today" value={meetingsToday.length} helper={upcomingMeetings.length + " upcoming"} tone="blue" onClick={() => openActivities("Meetings today", "Scheduled meetings starting today.", meetingsToday, data.meta.hubspotUrls.meetings)}/>
    </div>

    <div className="workspace-main-grid">
      <section className="workspace-card queue-card">
        <div className="workspace-card-heading"><div><span>MY DAY</span><h3>Execution queue</h3><p>Work the next best item without leaving the dashboard.</p></div><Clock3 size={20}/></div>
        <div className="queue-tabs">
          <button className={queueMode === "tasks" ? "active" : ""} onClick={() => setQueueMode("tasks")}>Tasks <b>{dueToday.length}</b></button>
          <button className={queueMode === "leads" ? "active" : ""} onClick={() => setQueueMode("leads")}>Leads <b>{Math.min(untouchedLeads.length, 99)}</b></button>
          <button className={queueMode === "meetings" ? "active" : ""} onClick={() => setQueueMode("meetings")}>Meetings <b>{upcomingMeetings.length}</b></button>
        </div>
        <div className="workspace-queue-list">
          {queueMode === "tasks" && dueToday.slice(0, 7).map((row) => <TaskQueueItem key={row.id} row={row} timezone={data.meta.timezone}/>)}
          {queueMode === "leads" && untouchedLeads.slice(0, 7).map((row) => <LeadQueueItem key={row.id} row={row}/>)}
          {queueMode === "meetings" && upcomingMeetings.slice(0, 7).map((row) => <MeetingQueueItem key={row.id} row={row} timezone={data.meta.timezone}/>)}
          {queueMode === "tasks" && !dueToday.length && <QueueEmpty label="No tasks due today" helper="You are clear for today’s task queue."/>}
          {queueMode === "leads" && !untouchedLeads.length && <QueueEmpty label="No untouched leads" helper="Every lead has a logged touch."/>}
          {queueMode === "meetings" && !upcomingMeetings.length && <QueueEmpty label="No upcoming meetings" helper="Use the composer to prepare a new meeting."/>}
        </div>
        <button className="queue-view-all" onClick={() => {
          if (queueMode === "tasks") openActivities("Tasks due today", "All open tasks due today.", dueToday, data.meta.hubspotUrls.tasks);
          if (queueMode === "leads") openContacts("Untouched leads", "All contacts without Last Contacted.", untouchedLeads);
          if (queueMode === "meetings") openActivities("Upcoming meetings", "All upcoming scheduled meetings.", upcomingMeetings, data.meta.hubspotUrls.meetings);
        }}>View full list<ChevronRight size={14}/></button>
      </section>

      <section className="workspace-card meeting-composer">
        <div className="workspace-card-heading"><div><span>MEETING COMPOSER</span><h3>Book a Google Meet for Sales</h3><p>Marita organizes the event, while the selected Sales Rep owns the HubSpot meeting and receives the invite with the lead.</p></div><Video size={20}/></div>
        <form onSubmit={submitPreview}>
          <label><span>Sales Rep · Meeting owner</span><select value={selectedSalesOwner?.id ?? ""} onChange={(event) => { setSelectedSalesOwnerId(event.target.value); setPreview(false); }} disabled={!salesOwners.length}>{salesOwners.length ? salesOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.email ? " · " + owner.email : ""}</option>) : <option value="">No Sales Rep owner available</option>}</select></label>
          <div className="meeting-host"><div className="meeting-avatar host"><UserRound size={15}/></div><div><strong>{selectedSalesOwner?.name ?? "Select a Sales Rep"}</strong><span>{selectedSalesOwner?.email || "HubSpot owner email is missing"}</span></div><em>Host · HubSpot owner</em></div>
          <label><span>Contact</span><select value={selectedContactId} onChange={(event) => { setSelectedContactId(event.target.value); setPreview(false); }}>{data.priorityContacts.map((row) => <option key={row.id} value={row.id}>{row.name}{row.company ? " · " + row.company : ""}</option>)}</select></label>
          <div className="meeting-guest"><div className="meeting-avatar">{selectedContact?.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase() || "?"}</div><div><strong>{selectedContact?.name ?? "Select a contact"}</strong><span>{selectedContact?.email || "No email address in HubSpot"}</span></div>{selectedContact && <HubSpotButton href={selectedContact.url} label="Profile"/>}</div>
          <label><span>Meeting title</span><input value={subject} onChange={(event) => { setSubject(event.target.value); setPreview(false); }}/></label>
          <div className="meeting-form-row"><label><span>Date</span><input type="date" value={meetingDate} onChange={(event) => { setMeetingDate(event.target.value); setPreview(false); }}/></label><label><span>Time</span><input type="time" value={meetingTime} onChange={(event) => { setMeetingTime(event.target.value); setPreview(false); }}/></label><label><span>Duration</span><select value={duration} onChange={(event) => { setDuration(event.target.value); setPreview(false); }}><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></label></div>
          <label><span>Location</span><select value={meetingType} onChange={(event) => { setMeetingType(event.target.value); setPreview(false); }}><option value="google-meet">Google Meet</option><option value="no-video">Calendar invitation without video</option></select></label>
          <label><span>Agenda</span><textarea rows={3} value={agenda} onChange={(event) => { setAgenda(event.target.value); setPreview(false); }}/></label>
          <button className="meeting-preview-button" type="submit"><Sparkles size={15}/>Preview invitation</button>
        </form>
        {preview && <div className="meeting-preview">
          <div className="meeting-preview-title"><CheckCircle2 size={17}/><div><strong>Invitation preview ready</strong><span>No calendar event or HubSpot meeting has been created.</span></div></div>
          <dl><div><dt>Organizer</dt><dd>Marita Chedid · {calendarStatus?.email || "Google Calendar"}</dd></div><div><dt>Sales host</dt><dd>{selectedSalesOwner?.name || "Missing Sales Rep"} · invitation recipient · HubSpot meeting owner</dd></div><div><dt>Lead guest</dt><dd>{selectedContact?.name || "—"} · {selectedContact?.email || "Missing email"}</dd></div><div><dt>When</dt><dd>{meetingDate} at {meetingTime} · {duration} minutes</dd></div><div><dt>Location</dt><dd>{meetingType === "google-meet" ? "A unique Google Meet link will be included in both invitations" : "Calendar invitation without a video link"}</dd></div><div><dt>After send</dt><dd>Google invites Sales + Lead; HubSpot logs the meeting under {selectedSalesOwner?.name || "the selected Sales Rep"} and associates it with the contact.</dd></div></dl>
          {calendarStatus?.connected ? <button className="meeting-send-button" type="button" onClick={() => void sendMeeting()} disabled={sending || !selectedContact?.email || !selectedSalesOwner?.email}>{sending ? "Creating meeting and sending invitations…" : <><Video size={14}/>Confirm & send invitations</>}</button> : <a className="meeting-connect-button" href="/api/google/connect"><Video size={14}/>Connect Marita Calendar first</a>}
          {sendError && <div className="meeting-send-message error"><AlertTriangle size={14}/><span><strong>Meeting not created</strong>{sendError}</span></div>}
          {bookingResult && <div className="meeting-send-message success"><CheckCircle2 size={15}/><span><strong>Meeting created and invitations sent</strong>{bookingResult.salesOwner.name} and {bookingResult.contact.name} were invited.</span><div><a href={bookingResult.meetLink || bookingResult.calendarUrl} target="_blank" rel="noreferrer">Open Google Meet<ExternalLink size={11}/></a><a href={bookingResult.hubspotContactUrl} target="_blank" rel="noreferrer">Open HubSpot timeline<ExternalLink size={11}/></a></div></div>}
        </div>}
      </section>
    </div>

    <section className="workspace-card priority-workspace">
      <div className="workspace-card-heading"><div><span>PRIORITY LEADS</span><h3>Best next conversations</h3><p>High-scoring contacts with direct call, email, and HubSpot shortcuts.</p></div><UserRound size={20}/></div>
      <div className="priority-workspace-grid">{data.priorityContacts.slice(0, 8).map((row) => <PriorityLeadCard key={row.id} row={row}/>)}</div>
    </section>
  </div>;
}

function WorkspaceStat({ icon: Icon, label, value, helper, tone, onClick }: { icon: typeof CalendarDays; label: string; value: number; helper: string; tone: string; onClick: () => void }) {
  return <button className={"workspace-stat tone-" + tone} onClick={onClick}><span><Icon size={17}/>{label}</span><strong>{value}</strong><small>{helper}<ChevronRight size={12}/></small></button>;
}

function TaskQueueItem({ row, timezone }: { row: ActivityRow; timezone: string }) {
  return <article className="queue-item"><div className={"queue-icon " + (row.isHighPriority ? "urgent" : "")}><CheckCircle2 size={16}/></div><div className="queue-item-main"><strong>{row.subject}</strong><span>{row.relatedContactName ? row.relatedContactName + " · " : ""}{row.detail} · Due {shortTime(row.dueAt, timezone)}</span></div><span className={"queue-status " + (row.isHighPriority ? "high" : "")}>{row.isHighPriority ? "High" : row.status}</span><HubSpotButton href={row.url} label={row.relatedContactUrl ? "Timeline" : "Tasks"}/></article>;
}

function LeadQueueItem({ row }: { row: ContactRow }) {
  return <article className="queue-item"><div className="queue-avatar">{row.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</div><div className="queue-item-main"><strong>{row.name}</strong><span>{row.title || "No title"} · {row.company || "No company"}</span></div><span className="queue-status score-pill">{row.priorityScore}</span><div className="queue-quick-actions">{row.phone && <a href={"tel:" + row.phone} aria-label="Call"><Phone size={13}/></a>}{row.email && <a href={"mailto:" + row.email} aria-label="Email"><Mail size={13}/></a>}<HubSpotButton href={row.url} label="Lead"/></div></article>;
}

function MeetingQueueItem({ row, timezone }: { row: ActivityRow; timezone: string }) {
  return <article className="queue-item"><div className="queue-icon meeting"><Video size={16}/></div><div className="queue-item-main"><strong>{row.subject}</strong><span>{row.relatedContactName ? row.relatedContactName + " · " : ""}{shortDate(row.occurredAt, timezone)} · {shortTime(row.occurredAt, timezone)} · {row.assignedTo}</span></div><span className="queue-status scheduled">{row.status}</span><HubSpotButton href={row.url} label={row.relatedContactUrl ? "Timeline" : "Meetings"}/></article>;
}

function QueueEmpty({ label, helper }: { label: string; helper: string }) {
  return <div className="workspace-empty"><CheckCircle2 size={25}/><strong>{label}</strong><span>{helper}</span></div>;
}

function PriorityLeadCard({ row }: { row: ContactRow }) {
  return <article className="priority-lead-card"><div className="priority-lead-top"><div className="queue-avatar">{row.name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</div><span className={"score " + (row.priorityScore >= 85 ? "high" : row.priorityScore >= 65 ? "medium" : "low")}>{row.priorityScore}</span></div><strong>{row.name}</strong><p>{row.title || "No job title"}</p><div className="priority-lead-meta"><span><Target size={12}/>{row.company || "No company"}</span><span><MapPin size={12}/>{row.country || "No country"}</span></div><div className="priority-lead-tags"><i>{row.tier}</i><i>{row.contactPriority}</i></div><div className="priority-lead-actions">{row.phone && <a href={"tel:" + row.phone}><Phone size={13}/>Call</a>}{row.email && <a href={"mailto:" + row.email}><Mail size={13}/>Email</a>}<a href={row.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/>HubSpot</a></div></article>;
}
