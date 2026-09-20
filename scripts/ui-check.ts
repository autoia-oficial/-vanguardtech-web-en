/**
 * Drives the running app in a real browser: signs in, visits every page at
 * three viewport sizes, and fails on any console error, failed request or
 * horizontal overflow. Screenshots land in the directory given by --out.
 *
 *   npx tsx scripts/ui-check.ts --base http://localhost:3000 --out /tmp/shots
 */
import { chromium, type Page, type ConsoleMessage } from 'playwright';
import { mkdir } from 'node:fs/promises';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'http://localhost:3000');
const OUT = arg('out', '/tmp/vg-shots');
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@vanguard.invalid';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'local-dev-password-123';

const PAGES = [
  ['dashboard', '/'],
  ['leads', '/leads'],
  ['pipeline', '/pipeline'],
  ['campaigns', '/campaigns'],
  ['emails', '/emails'],
  ['follow-ups', '/follow-ups'],
  ['automations', '/automations'],
  ['activity', '/activity'],
  ['errors', '/errors'],
  ['settings', '/settings'],
] as const;

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const problems: string[] = [];

function watch(page: Page, label: string) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') problems.push(`[${label}] console: ${msg.text().slice(0, 200)}`);
  });
  page.on('pageerror', (err) => problems.push(`[${label}] pageerror: ${err.message.slice(0, 200)}`));
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? 'unknown';
    if (!failure.includes('ERR_ABORTED')) {
      problems.push(`[${label}] request failed: ${req.url().slice(0, 120)} (${failure})`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500) problems.push(`[${label}] ${res.status()} from ${res.url().slice(0, 120)}`);
  });
}

async function checkOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
  });
  // A few pixels of slack absorbs sub-pixel rounding.
  if (overflow.scrollW > overflow.clientW + 2) {
    problems.push(`[${label}] horizontal overflow: ${overflow.scrollW}px content in ${overflow.clientW}px viewport`);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // CHROMIUM_PATH lets the caller point at a browser already on the machine
  // when its build differs from the one this Playwright version expects.
  const executablePath = process.env.CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  try {
    // --- sign in ---------------------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page, 'login');

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/login-dark.png` });

    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/`, { timeout: 15_000 });
    console.log('signed in');

    const cookies = await ctx.cookies();
    if (!cookies.some((c) => c.name === 'vg_session' && c.httpOnly)) {
      problems.push('[login] session cookie missing or not httpOnly');
    }

    // --- every page at every size ----------------------------------------
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [name, path] of PAGES) {
        const label = `${name}@${vp.name}`;
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
        // Wait for the client fetch to settle rather than screenshotting a spinner.
        await page.waitForTimeout(400);

        const body = await page.textContent('body');
        if (!body || body.trim().length < 20) problems.push(`[${label}] page rendered empty`);
        if (body && /Application error|Unhandled Runtime Error/i.test(body)) {
          problems.push(`[${label}] runtime error on page`);
        }

        await checkOverflow(page, label);
        if (vp.name === 'desktop') {
          await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
        }
        console.log(`  ok ${label}`);
      }
    }

    // --- lead detail ------------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/leads`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const firstLead = page.locator('a[href^="/leads/"]').first();
    if ((await firstLead.count()) > 0) {
      await firstLead.click();
      await page.waitForTimeout(800);
      await checkOverflow(page, 'lead-detail@desktop');
      await page.screenshot({ path: `${OUT}/lead-detail.png`, fullPage: true });
      console.log('  ok lead-detail');
    } else {
      problems.push('[leads] no lead rows to open');
    }

    // --- light theme ------------------------------------------------------
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // The sidebar and the mobile header each carry a toggle; only one is
    // visible at any width, so click whichever that is.
    await page.locator('button[aria-label*="light mode" i]:visible').first().click();
    await page.waitForTimeout(500);
    const theme = await page.getAttribute('html', 'data-theme');
    if (theme !== 'light') problems.push(`[theme] expected light, got ${theme}`);
    await page.screenshot({ path: `${OUT}/dashboard-light.png`, fullPage: true });

    // The choice must survive a reload.
    await page.reload({ waitUntil: 'networkidle' });
    if ((await page.getAttribute('html', 'data-theme')) !== 'light') {
      problems.push('[theme] light preference did not persist across reload');
    }
    console.log('  ok light theme');

    // --- mobile navigation drawer ----------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.click('button[aria-label="Open menu"]');
    await page.waitForTimeout(300);
    const navVisible = await page.locator('a[href="/leads"]').first().isVisible();
    if (!navVisible) problems.push('[mobile] navigation drawer did not open');
    await page.screenshot({ path: `${OUT}/mobile-nav.png` });
    console.log('  ok mobile nav');

    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log('');
  if (problems.length === 0) {
    console.log('No console errors, failed requests or overflow detected.');
  } else {
    console.log(`${problems.length} problem(s):`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
  console.log(`Screenshots: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
