const path = require('path');
const fs = require('fs');
const SKILL_DIR = path.resolve('c:/Users/zerg/Projects/personal/memorall/.claude/skills/run-memorall');
const { chromium } = require(path.join(SKILL_DIR, '.pw-cache/node_modules/playwright'));
const EXTENSION_PATH = 'c:/Users/zerg/Projects/personal/memorall/publish/extension/chrome';
const OUT_DIR = 'c:/Users/zerg/Projects/personal/memorall/docs/store/unikorn/raw';
const CHROMIUM_EXE = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1223/chrome-win64/chrome.exe');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ROUTES = [
  ['agents.png', '/agents'],
  ['files.png', '/files'],
  ['memory.png', '/memory'],
  ['connections.png', '/connections'],
  ['skills.png', '/skills'],
  ['models.png', '/llm'],
  ['runtime.png', '/runtime'],
  ['flow-builder.png', '/flow-builder'],
  ['activities.png', '/activities'],
  ['embeddings.png', '/embeddings'],
  ['database.png', '/database'],
];

(async () => {
  const profileDir = path.join(SKILL_DIR, '.pw-cache', 'profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false, viewport: { width: 1280, height: 800 }, colorScheme: 'dark',
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`, '--no-sandbox', '--window-size=1360,940'],
    executablePath: fs.existsSync(CHROMIUM_EXE) ? CHROMIUM_EXE : undefined,
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('theme', 'dark'); } catch (e) {}
  });
  let extId;
  for (let i = 0; i < 30 && !extId; i++) {
    for (const sw of context.serviceWorkers()) { const m = sw.url().match(/chrome-extension:\/\/([^/]+)/); if (m) extId = m[1]; }
    if (!extId) await new Promise(r => setTimeout(r, 1000));
  }
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${extId}/options/index.html`);
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(2000); if (await page.$('[data-copilot="app-layout"]')) break; }
  await page.waitForTimeout(4000);
  try { await page.click('text=Skip Tour', { timeout: 4000 }); } catch (e) {}
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.mouse.move(1270, 790);
  await page.screenshot({ path: path.join(OUT_DIR, 'onboarding.png') });
  console.log('shot onboarding.png');

  const go = async (route) => {
    await page.evaluate((p) => {
      window.history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    }, route);
    await page.waitForTimeout(4000);
  };

  await go('/agents');
  // now rightPanelCollapsed === false, so the collapse chevron exists
  let collapsed = false;
  for (const sel of ['[aria-label="Show full right panel"]', '[title="Show full right panel"]']) {
    const el = await page.$(sel);
    if (el) { await el.click(); collapsed = true; break; }
  }
  console.log('collapsed chat panel:', collapsed);
  await page.waitForTimeout(3000);

  for (const [file, route] of ROUTES) {
    try {
      await go(route);
      await page.mouse.move(1270, 790);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT_DIR, file) });
      console.log('shot', file);
    } catch (e) { console.log('FAILED', file, e.message); }
  }
  await context.close();
})().catch(e => { console.error(e); process.exit(1); });
