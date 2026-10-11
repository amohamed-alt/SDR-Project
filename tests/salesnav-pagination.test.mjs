import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('chrome-companion/background-v154.js', 'utf8');
const fn = source.slice(source.indexOf('function clickNextSalesNavPageV154('), source.indexOf('\nasync function extractPage'));
function inspect(items, count = 25) {
  class Button {
    constructor(label, opts = {}) { this.label = label; Object.assign(this, opts); }
    getClientRects() { return this.hidden ? [] : [1]; }
    getAttribute(name) { return name === 'aria-label' ? this.label : name === 'aria-disabled' ? this.ariaDisabled : ''; }
    click() { this.clicked = true; }
  }
  const buttons = items.map(([label, opts]) => new Button(label, opts));
  const result = vm.runInNewContext(`${fn}; clickNextSalesNavPageV154(${count})`, {
    HTMLButtonElement: Button, document: { querySelectorAll: () => buttons }, getComputedStyle: () => ({ visibility: 'visible' }),
  });
  return { result, buttons };
}
test('single visible Next page is clicked; hidden unrelated button ignored', () => {
  const { result, buttons } = inspect([['Next page', {}], ['Next', { hidden: true }], ['Previous', {}]]);
  assert.equal(result.state, 'clicked'); assert.equal(buttons[0].clicked, true); assert.equal(buttons[1].clicked, undefined);
});
test('disabled pagination proves end; missing pagination does not', () => {
  assert.equal(inspect([['Next', { disabled: true }]]).result.state, 'end');
  assert.equal(inspect([['Next', { ariaDisabled: 'true' }]]).result.state, 'end');
  assert.equal(inspect([]).result.state, 'uncertain');
});
test('ambiguous pagination never clicks', () => {
  const { result, buttons } = inspect([['Next', {}], ['Next page', {}]]);
  assert.equal(result.state, 'uncertain'); assert.ok(buttons.every((button) => !button.clicked));
});

test('short non-final page pauses without clicking while short final page can end', () => {
  const partial = inspect([['Next', {}]], 12);
  assert.equal(partial.result.state, 'uncertain'); assert.equal(partial.buttons[0].clicked, undefined);
  assert.equal(inspect([['Next', {disabled:true}]], 12).result.state, 'end');
});
test('resume fills a partial saved page without incrementing the page or dropping earlier leads', async () => {
  const body = source.slice(source.indexOf('async function persistCurrentPage('), source.indexOf('\nasync function advance('));
  const writes = [];
  const run = { pagesRead: 1, lastPageCount: 12, signatures: ['partial'], total: 12 };
  const current = { sourceUrl: 'https://www.linkedin.com/sales/search/people?page=1', leads: Array.from({length:25},(_,i)=>({name:String(i)})) };
  const result = await vm.runInNewContext(`${body}; persistCurrentPage(run, current)`, {
    run, current, URL, MAX_PAGES:100, pageSignature:()=> 'full',dedupe:values=>values, cleanUrl:value=>value,
    savePage:async(_run,page,leads)=>{writes.push({page,leads});return {total:25};},setRun:async()=>{},
  });
  assert.equal(result.pagesRead,1);assert.equal(result.lastPageCount,25);assert.equal(writes[0].page,1);assert.deepEqual(Array.from(result.signatures),['full']);
});
