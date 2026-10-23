import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { batchRead, createFollowupTaskOnce, getPropertyDefinitions, readAssociations } from '@/lib/hubspot';
import { loadRmJourney, invalidateRmJourney } from '@/lib/rm-journey';
import { contactDisposition,CONTACT_REVIEW_FIELDS } from '@/lib/rm-review-core';
import { journeyStatus } from '@/lib/rm-journey-status';
import { createJournaledTask, FollowupTaskError } from '@/lib/rm-task-journal';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
import { originMatchesRequestHosts } from '@/lib/request-origin';

export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
const id = z.string().regex(/^\d+$/);
const schema = z.object({ meetingId: id, rmId: id, contactId: id, dealId: z.union([id, z.literal('')]), version: z.string().min(1), title: z.string().trim().min(1).max(200), dueAt: z.string().datetime({ offset: true }), reminderAt:z.string().datetime({offset:true}).optional(), type: z.enum(['CALL', 'EMAIL', 'TODO']) }).strict();

export async function POST(req: NextRequest) {
  if (!originMatchesRequestHosts({ origin: req.headers.get('origin'), forwardedHost: req.headers.get('x-forwarded-host'), host: req.headers.get('host'), requestHost: req.nextUrl.host }) || req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Same-origin request required' }, { status: 403, headers });
  if (!sdrAdminAuthorized(req)) return NextResponse.json({ error: 'Unlock SDR tools before creating a task.' }, { status: 401, headers });
  if (process.env.DEMO_MODE === 'true') return NextResponse.json({ error: 'Live task creation disabled in demo mode.' }, { status: 403, headers });
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Select a contact, task type, title and due time.' }, { status: 400, headers });
    const input = parsed.data;
    const dueAt = new Date(input.dueAt).toISOString();
    if(input.reminderAt&&(Date.parse(input.reminderAt)<=Date.now()||Date.parse(input.reminderAt)>Date.parse(dueAt)))throw new FollowupTaskError('Reminder must be in the future and no later than the due time.',400);
    if (Date.parse(dueAt) <= Date.now()) throw new FollowupTaskError('Choose a future due time.', 400);
    const [meeting] = await batchRead('meetings', [input.meetingId], ['hs_meeting_start_time']);
    const start = String(meeting?.properties.hs_meeting_start_time || '');
    if (!Number.isFinite(Date.parse(start))) throw new FollowupTaskError('Meeting not found.', 404);
    const day = new Date(Date.parse(start) + 3 * 3600000).toISOString().slice(0, 10);
    const data = await loadRmJourney(day, day, true);
    const row = data.rows.find(r => r.id === input.meetingId);
    if (!row || !row.people.rms.some(r => r.id === input.rmId) || !row.contacts.some(c => c.id === input.contactId)) throw new FollowupTaskError('Meeting or contact linkage changed. Reload before creating a task.', 409);
    const status = journeyStatus(row, input.rmId, data.updatedAt);
    if (!status.responsible || !status.followupRequired || (row.deals.length > 0 && !status.deal) || (status.deal?.id || '') !== input.dealId) throw new FollowupTaskError('Confirm the follow-up owner and opportunity linkage in HubSpot first.', 409);
    const payload = { contactId: input.contactId, dealId: input.dealId, ownerId: input.rmId, title: input.title, dueAt, type: input.type, ...(input.reminderAt?{reminderAt:new Date(input.reminderAt).toISOString()}:{}) };
    const verify = async (taskId: string) => {
      const [[task], contacts, deals] = await Promise.all([
        batchRead('tasks', [taskId], ['hs_task_subject', 'hs_timestamp', 'hubspot_owner_id', 'hs_task_type', 'hs_task_status','hs_task_reminders']),
        readAssociations('tasks', 'contacts', [taskId]), readAssociations('tasks', 'deals', [taskId]),
      ]);
      if (!task || task.properties.hs_task_subject !== payload.title || task.properties.hubspot_owner_id !== payload.ownerId || task.properties.hs_task_type !== payload.type || Date.parse(String(task.properties.hs_timestamp)) !== Date.parse(dueAt) || task.properties.hs_task_status !== 'NOT_STARTED' || (payload.reminderAt&&String(task.properties.hs_task_reminders)!==String(Date.parse(payload.reminderAt))) || !contacts.get(taskId)?.includes(payload.contactId) || (payload.dealId && !deals.get(taskId)?.includes(payload.dealId))) throw new FollowupTaskError(`Task ${taskId} could not be verified. Review HubSpot before retrying.`, 502);
      return task;
    };
    const result = await createJournaledTask({ key: `${input.meetingId}:${input.rmId}`, lockKey: `rm:${input.rmId}`, payload, verify,
      check: async () => {
        if (row.version !== input.version) throw new FollowupTaskError('Meeting changed. Reload before creating a task.');
        if (status.tasks.some(t => t.status !== 'COMPLETED')) throw new FollowupTaskError('An open follow-up task already exists for this RM. Review it in the timeline first.');
        // Re-read inside the lock: another meeting's create may have completed
        // after the journey snapshot was built.
        const [contactTasks, dealTasks] = await Promise.all([
          readAssociations('contacts', 'tasks', [input.contactId]),
          readAssociations('deals', 'tasks', input.dealId ? [input.dealId] : []),
        ]);
        const currentTasks = await batchRead('tasks', [...new Set([...contactTasks.values(), ...dealTasks.values()].flat())], ['hs_task_status', 'hubspot_owner_id']);
        if (currentTasks.some(t => t.properties.hubspot_owner_id === input.rmId && t.properties.hs_task_status !== 'COMPLETED')) throw new FollowupTaskError('An open task already exists for this RM and contact or opportunity. Review HubSpot first.');
        if(input.dealId){const [currentDeal]=await batchRead('deals',[input.dealId],['hubspot_owner_id','pipeline','hs_is_closed','dealstage']);if(!currentDeal||currentDeal.properties.hubspot_owner_id!==input.rmId||currentDeal.properties.pipeline!=='default'||currentDeal.properties.hs_is_closed==='true'||['closedwon','closedlost'].includes(String(currentDeal.properties.dealstage)))throw new FollowupTaskError('Opportunity owner or status changed. Reload before creating a task.');}
        const [contact] = await batchRead('contacts', [input.contactId], ['phone', 'mobilephone', 'email',...CONTACT_REVIEW_FIELDS]);
        if(contact&&contactDisposition(contact.properties).stopped)throw new FollowupTaskError('This contact is unqualified or has no need. Follow-up is not required.',409);
        if (!contact || (input.type === 'CALL' && ![contact.properties.phone, contact.properties.mobilephone].some(p => String(p || '').replace(/\D/g, '').length >= 8)) || (input.type === 'EMAIL' && !contact.properties.email)) throw new FollowupTaskError('This contact needs a phone for a call task or an email for an email task.', 400);
        const fields = await getPropertyDefinitions('tasks', ['hs_task_type', 'hs_task_status',...(input.reminderAt?['hs_task_reminders']:[])]);
        if(input.reminderAt&&!fields.some(f=>f.name==='hs_task_reminders'))throw new FollowupTaskError('Task reminders are unavailable.',502);
        for (const [name, value] of [['hs_task_type', input.type], ['hs_task_status', 'NOT_STARTED']]) if (!fields.find(f => f.name === name)?.options?.some(o => o.value === value && !o.hidden)) throw new FollowupTaskError('HubSpot task options are unavailable. No task was created.', 502);
      }, create: () => createFollowupTaskOnce(payload),
    });
    invalidateRmJourney();
    return NextResponse.json({ confirmed: true, taskId: result.task.id, reused: result.reused, task: result.task }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof FollowupTaskError ? error.message : 'Task creation could not be confirmed. Review HubSpot before retrying; a task may already exist.' }, { status: error instanceof FollowupTaskError ? error.status : 502, headers });
  }
}
