import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const shell = readFileSync(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
const core = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
test("SDR tools have no open/close or outside-click state", () => {
  for (const source of [shell, core]) assert.doesNotMatch(source, /toolsOpen|setToolsOpen|onToggleTools|Close SDR Tools|closeOnOutside|toggleAdvanced/);
  assert.match(shell, /aria-label="SDR tools navigation"/);
});
test("both sidebar layouts place tools after the owner", () => {
  assert.match(core, /owner-card[\s\S]*?\{sidebarTools\}[\s\S]*?sync-card/);
  assert.match(shell, /owner-card[\s\S]*?\{sidebarTools\}[\s\S]*?<\/aside>/);
  assert.match(shell, /sidebarTools=\{sidebarTools\}/);
});
test("admin tools remain password protected without an accordion", () => {
  assert.match(shell, /fetch\("\/api\/sdr-admin"/);
  assert.match(shell, /adminUnlocked \? <div className=\{styles.advancedList\}/);
  assert.match(shell, /!adminUnlocked \? <div className=\{styles.advancedList\}/);
  assert.doesNotMatch(shell, /advancedOpen/);
});
test("the selected internal tool is marked as the current page", () => {
  assert.equal((shell.match(/aria-current=\{view ===/g) || []).length, 8);
});
