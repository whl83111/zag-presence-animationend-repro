// Closes the panel the way an e2e run does: the close, a style read, and a late next frame all in one task.
// READ=none skips the style read (control). BLOCK is how late the next frame is, in ms.
import { chromium, firefox, webkit } from '@playwright/test';

const browserName = process.env.BROWSER ?? 'webkit';
const read = process.env.READ ?? 'style';
const block = Number(process.env.BLOCK ?? 300);
const browser = await { chromium, firefox, webkit }[browserName].launch();
const page = await browser.newPage();
const content = '[data-testid="panel"]';

// Log the exit animation's events and the moment zag attaches its `animationend` listener.
await page.addInitScript(() => {
  const log = (window.__log = []);
  const isContent = (n) => n instanceof Element && n.dataset.testid === 'panel';
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'animationend' && isContent(this)) log.push(`${performance.now().toFixed(0)} zag attaches its animationend listener`);
    return add.call(this, type, ...rest);
  };
  for (const type of ['animationstart', 'animationend']) {
    document.addEventListener(type, (e) => { if (isContent(e.target)) log.push(`${performance.now().toFixed(0)} ${type} (${e.animationName})`); }, true);
  }
});

await page.goto('http://localhost:5173/');
await page.getByText('Open').click();
await page.locator(content).waitFor({ state: 'visible' });
await page.waitForTimeout(500);

await page.evaluate(async ({ read, block }) => {
  const log = window.__log;
  const el = document.querySelector('[data-testid="panel"]');
  document.querySelector('[data-testid="close"]').click();
  // React 19 commits a discrete update in a microtask: wait for `data-state="closed"` in this same task.
  for (let i = 0; i < 20 && el.dataset.state !== 'closed'; i++) await Promise.resolve();
  if (read === 'style') log.push(`${performance.now().toFixed(0)} closed; style read: animation-name=${getComputedStyle(el).animationName}`);
  else log.push(`${performance.now().toFixed(0)} closed; no style read`);
  const end = performance.now() + block;
  while (performance.now() < end) {} // the next frame comes `block` ms late, as on a starved runner
  log.push(`${performance.now().toFixed(0)} task ends`);
}, { read, block });
await page.waitForTimeout(1500);

const count = await page.locator(content).count();
console.log(`${browserName} ${browser.version()} read=${read} block=${block}ms: mounted after 1.5s = ${count} ${count ? 'STRANDED' : 'ok'}`);
for (const line of await page.evaluate(() => window.__log)) console.log(`  ${line}`);
await browser.close();
