import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('chrome-companion/background-v154.js', 'utf8');
const fn = source.slice(source.indexOf('function clickNextSalesNavPageV154()'), source.indexOf('\nasync function extractPage'));
function inspect(items) {
  class Button {
    constructor(label, opts = {}) { this.label = label; Object.assign(this, opts); }
    getClientRects() { return this.hidden ? [] : [1]; }
    getAttribute(name) { return name === 'aria-label' ? this.label : name === 'aria-disabled' ? this.ariaDisabled : ''; }
    click() { this.clicked = true; }
  }
  const buttons = items.map(([label, opts]) => new Button(label, opts));
  const result = vm.runInNewContext(`${fn}; clickNextSalesNavPageV154()`, {
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
