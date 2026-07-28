const { chromium } = require('playwright');

async function probe(baseUrl){
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const events = [];
  page.on('console', msg => events.push({ type: 'console', text: msg.text() }));
  page.on('pageerror', err => events.push({ type: 'pageerror', text: String(err) }));
  let popupUrl = null;
  let popupText = null;
  let popupClosed = false;
  page.on('popup', async popup => {
    try {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      popupUrl = popup.url();
      popupText = await popup.locator('body').innerText().catch(() => '');
      await popup.close().catch(() => {});
    } finally {
      popupClosed = true;
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.browse-tree-child', { hasText: 'Hợp đồng - pháp lý' }).first().click();
  await page.waitForTimeout(600);
  const connect = page.locator('#driveApiSignInBtn');
  const visible = await connect.isVisible().catch(() => false);
  const text = visible ? await connect.innerText().catch(() => '') : '';
  if (visible) {
    await connect.click();
    await page.waitForTimeout(3500);
  }
  const state = await page.evaluate(() => ({
    origin: location.origin,
    href: location.href,
    hasGoogle: !!window.google?.accounts?.oauth2,
    token: typeof driveDirectAccessToken === 'string' && driveDirectAccessToken.length > 0,
    tokenExp: typeof driveDirectTokenExpiresAt === 'number' ? driveDirectTokenExpiresAt : 0,
    canDirect: typeof canUseDriveDirectUpload === 'function' ? canUseDriveDirectUpload() : null,
    buttonText: document.getElementById('driveApiSignInBtn')?.innerText || '',
    buttonHidden: document.getElementById('driveApiSignInBtn')?.hidden ?? null,
    bodyHasOriginMismatch: document.body?.innerText?.includes('origin_mismatch') || false
  }));
  await browser.close();
  return { baseUrl, visible, text, popupUrl, popupClosed, popupText: popupText ? popupText.slice(0, 500) : '', state, events };
}

(async()=>{
  const urls = [
    'http://localhost:8155/giao-dien-desktop-don-gian_v45.html?diag=oauth-localhost',
    'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?diag=oauth-127'
  ];
  const out = [];
  for (const u of urls) out.push(await probe(u));
  console.log(JSON.stringify(out, null, 2));
})().catch(err => { console.error(err?.stack || String(err)); process.exit(1); });
