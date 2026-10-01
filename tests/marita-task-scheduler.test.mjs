import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cairoDate, cairoMorning, planMaritaTask, createScheduledMaritaTask } from "../src/lib/marita-task-scheduler.ts";

const now = new Date("2026-09-30T18:00:00Z");
const tasks = (count, elevatus = false, day = "2026-10-01") => Array.from({ length: count }, (_, i) => ({
  id: `${day}-${elevatus}-${i}`,
  properties: { hubspot_owner_id: "31644369", hs_task_status: "NOT_STARTED", hs_timestamp: cairoMorning(day), hs_task_subject: elevatus ? "Elevatus call" : i % 2 ? "Follow up" : "Second trial" },
}));

test("all follow-ups and retries count within 70, with ten Elevatus slots reserved", () => {
  assert.equal(cairoDate(planMaritaTask(tasks(59), [], false, now)), "2026-10-01");
  assert.equal(cairoDate(planMaritaTask(tasks(60), [], false, now)), "2026-10-04");
  assert.equal(cairoDate(planMaritaTask(tasks(69), [], true, now)), "2026-10-01");
  assert.equal(cairoDate(planMaritaTask(tasks(70), [], true, now)), "2026-10-04");
});

test("ten Elevatus tasks are inside the cap and free the remaining general slots", () => {
  const list = [...tasks(59), ...tasks(10, true)];
  assert.equal(cairoDate(planMaritaTask(list, [], false, now)), "2026-10-01");
  assert.equal(cairoDate(planMaritaTask(list, [], true, now)), "2026-10-04");
});

test("overdue work consumes capacity before new work without changing promised dates", () => {
  const backlog = tasks(70, false, "2026-09-29");
  const list = [...backlog, ...tasks(60)];
  assert.equal(cairoDate(planMaritaTask(list, [], false, now)), "2026-10-05");
  assert.equal(cairoDate(planMaritaTask(list, [], true, now)), "2026-10-04");
  assert.equal(backlog[0].properties.hs_timestamp, cairoMorning("2026-09-29"));
});

test("completed records, another owner and repeated IDs do not inflate capacity", () => {
  const list = tasks(59);
  list.push(list[0], { id: "done", properties: { ...list[0].properties, hs_task_status: "COMPLETED" } }, { id: "daniel", properties: { ...list[0].properties, hubspot_owner_id: "37624223" } });
  assert.equal(cairoDate(planMaritaTask(list, [], false, now)), "2026-10-01");
});

test("Cairo timezone, DST and weekends are resolved from local calendar dates", () => {
  assert.equal(cairoMorning("2026-10-01"), "2026-10-01T06:00:00.000Z");
  assert.equal(cairoMorning("2026-11-01"), "2026-11-01T07:00:00.000Z");
  assert.equal(cairoDate(planMaritaTask([], [], false, new Date("2026-09-30T22:30:00Z"))), "2026-10-04");
});

test("missing dates fail closed and the planner leaves follow-up dates untouched", () => {
  const list = tasks(70); const before = structuredClone(list);
  planMaritaTask(list, [], false, now);
  assert.deepEqual(list, before);
  assert.throws(() => planMaritaTask([{ id: "missing", properties: { hubspot_owner_id: "31644369" } }], [], false, now), /no date/);
});

test("a write reservation counts during search indexing lag, without double counting a visible task", () => {
  const list = tasks(59);
  const reservation = { contactId: "1", companyId: "2", dueAt: cairoMorning("2026-10-01"), elevatus: false, taskId: "new" };
  assert.equal(cairoDate(planMaritaTask(list, [reservation], false, now)), "2026-10-04");
  list.push({ id: "new", properties: { hubspot_owner_id: "31644369", hs_task_status: "NOT_STARTED", hs_timestamp: reservation.dueAt } });
  assert.equal(cairoDate(planMaritaTask(list, [reservation], false, now)), "2026-10-04");
});

test("concurrent creates cannot claim the same remaining slot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "marita-schedule-test-"));
  let release; let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const input = { stateDirectory: directory, now, contactId: "1", companyId: "2", elevatus: false, readTasks: async () => tasks(59), createTask: async () => { started(); await waiting; return { id: "created" }; } };
  try {
    const first = createScheduledMaritaTask(input); await entered;
    await assert.rejects(createScheduledMaritaTask({ ...input, contactId: "3", companyId: "4" }), /busy/);
    release(); await first;
    const second = await createScheduledMaritaTask({ ...input, contactId: "3", companyId: "4", createTask: async () => ({ id: "second" }) });
    assert.equal(cairoDate(second.dueAt), "2026-10-04");
    await assert.rejects(createScheduledMaritaTask(input), /already reserved/);
  } finally { release?.(); await rm(directory, { recursive: true, force: true }); }
});

test("an ambiguous POST failure keeps the reservation across process restarts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "marita-schedule-test-"));
  let calls = 0;
  const input = { stateDirectory: directory, now, contactId: "1", companyId: "2", elevatus: false, readTasks: async () => [], createTask: async () => { calls++; throw new Error("timeout after sending POST"); } };
  try {
    await assert.rejects(createScheduledMaritaTask(input), /timeout/);
    const journal = JSON.parse(await readFile(path.join(directory, "reservations.json"), "utf8"));
    assert.equal(journal.reservations.length, 1);
    await assert.rejects(createScheduledMaritaTask(input), /uncertain write/);
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("Daniel inventory scheduling uses his own 50/day capacity and preserves backlog", () => {
  const tasks = Array.from({ length: 50 }, (_, i) => ({ id: String(i), properties: { hubspot_owner_id: "37624223", hs_task_status: "NOT_STARTED", hs_timestamp: "2026-10-04T06:00:00Z" } }));
  const due = planMaritaTask(tasks, [], false, new Date("2026-10-01T10:00:00Z"), { ownerId: "37624223", dailyCap: 50, elevatusTarget: 0 });
  assert.equal(cairoDate(due), "2026-10-05");
});
