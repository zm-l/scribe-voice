import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing CSS rule ${selector}`);
  return match[1];
}
test('app shell is viewport-bounded instead of growing below the hidden body', () => {
  assert.match(rule('html, body, #root'), /height:\s*100%/);
  assert.match(rule('.app-shell'), /height:\s*100vh/);
  assert.match(rule('.app-shell'), /min-height:\s*0/);
  assert.match(rule('.workspace'), /height:\s*100%/);
  assert.match(rule('.workspace'), /min-height:\s*0/);
});
test('content can shrink and scroll while the header remains fixed', () => {
  assert.match(rule('.content-scroll'), /min-height:\s*0/);
  assert.match(rule('.content-scroll'), /overflow:\s*auto/);
  assert.match(rule('.content-scroll'), /flex:\s*1 1 0/);
  assert.match(rule('.topbar'), /flex-shrink:\s*0/);
});
