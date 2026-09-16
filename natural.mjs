// No stand-ins: real clicks, a `toBeHidden` assertion for the style reads, no busy loop. The late frame has to come
// from the machine itself, so run this under a CPU quota (see container.sh). ROUNDS open-close cycles; BROWSER picks the engine.
import { chromium, expect, firefox, webkit } from '@playwright/test';

const browserName = process.env.BROWSER ?? 'webkit';
const rounds = Number(process.env.ROUNDS ?? 10);
const content = '[data-testid="panel"]';
const browser = await { chromium, firefox, webkit }[browserName].launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/');

let stranded = 0;
for (let i = 0; i < rounds; i++) {
  await page.getByText('Open').click();
  await page.locator(content).waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  await page.getByTestId('close').click({ noWaitAfter: true });
  await expect(page.locator(content)).toBeHidden({ timeout: 5000 }).catch(() => {}); // the style reads
  await page.waitForTimeout(2000);
  if (await page.locator(content).count()) {
    stranded++;
    console.log(`  round ${i}: STRANDED`);
    await page.reload();
  }
}
console.log(`${browserName} ${browser.version()} rounds=${rounds}: ${stranded}/${rounds} stranded`);
await browser.close();
