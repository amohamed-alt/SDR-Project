// v1.5.2 reliability layer.
// Keep the existing background implementation and add an independent kick/watchdog
// so full-search capture no longer depends on the popup staying alive or on one
// specific LinkedIn navigation event firing.
importScripts('background.js');

const V152_FULL_RUN_KEY = 'salesNavFullRunV1';
const V152_CONTINUATION_TAB_KEY = 'salesNavFullRunContinuationTabV1';
const V152_WATCHDOG_ALARM = 'salesnav-full-run-watchdog-v152';
let v152KickBusy = false;

async function v152CurrentRun() {
  const stored = await chrome.storage.local.get([V152_FULL_RUN_KEY]);
  return stored[V152_FULL_RUN_KEY] || null;
}

async function v152ResolveTabId() {
  const stored = await chrome.storage.local.get([V152_CONTINUATION_TAB_KEY]);
  const remembered = Number(stored[V152_CONTINUATION_TAB_KEY]);
  if (Number.isFinite(remembered)) {
    try {
      if (await verifySalesNavTab(remembered)) return remembered;
    } catch {}
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = Number(tabs?.[0]?.id);
    if (Number.isFinite(tabId) && await verifySalesNavTab(tabId)) return tabId;
  } catch {}
  return null;
}

async function v152Kick(delayMs = 4500) {
  if (v152KickBusy) return;
  v152KickBusy = true;
  try {
    const run = await v152CurrentRun();
    if (!run || run.complete || !run.runId) return;
    const tabId = await v152ResolveTabId();
    if (!Number.isFinite(tabId)) return;
    await scheduleContinuation(tabId, delayMs);
  } finally {
    v152KickBusy = false;
  }
}

async function v152EnsureWatchdog() {
  const existing = await chrome.alarms.get(V152_WATCHDOG_ALARM);
  if (!existing) chrome.alarms.create(V152_WATCHDOG_ALARM, { periodInMinutes: 1 });
}

// The popup writes the local run immediately after the first server ACK.
// This listener catches that write and arms background continuation before the
// popup can disappear during LinkedIn page navigation.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[V152_FULL_RUN_KEY]?.newValue) return;
  const run = changes[V152_FULL_RUN_KEY].newValue;
  if (!run || run.complete || !run.runId) return;
  void v152Kick(4500);
});

// If LinkedIn behaves as an SPA and no normal page-load event fires, activation
// plus the watchdog still recover the run.
chrome.tabs.onActivated.addListener(() => {
  void v152Kick(2500);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== V152_WATCHDOG_ALARM) return;
  void v152Kick(1500);
});

chrome.runtime.onInstalled.addListener(() => {
  void v152EnsureWatchdog();
  void v152Kick(2500);
});

chrome.runtime.onStartup.addListener(() => {
  void v152EnsureWatchdog();
  void v152Kick(2500);
});

void v152EnsureWatchdog();
void v152Kick(2500);
