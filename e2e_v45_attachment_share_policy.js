const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-attachment-share';

function assert(condition, message, detail) {
  if (!condition) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const dialogs = [];
  const shareCalls = [];
  page.on('pageerror', error => dialogs.push({ type: 'pageerror', message: String(error?.stack || error) }));
  page.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), message: dialog.message() }); await dialog.dismiss(); });

  await page.route('https://accounts.google.com/gsi/client', route => route.abort());
  await page.route('**/drive/v3/files/**/permissions**', async route => {
    const body = route.request().postDataJSON();
    shareCalls.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: `perm-${shareCalls.length}` })
    });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const shareButtonPresent = await page.evaluate(() => typeof openAttachmentShareModal === 'function');
  assert(shareButtonPresent, 'V45 phải có modal chia sẻ attachment');

  await page.evaluate(() => {
    openAttachmentShareModal({
      name: 'demo.pdf',
      driveId: 'demo-file-id',
      driveLink: 'https://drive.google.com/file/d/demo-file-id/view'
    });
  });

  const labels = await page.$$eval('.v19-modal-actions .v19-btn', els => els.map(el => el.textContent.trim()));
  assert(labels.includes('Viewer') && labels.includes('Editor') && labels.includes('Anyone with link'), 'Modal share phải có đủ 3 lựa chọn', { labels });

  await page.getByRole('button', { name: 'Anyone with link' }).click();
  await page.waitForSelector('.v19-modal-overlay');
  const confirmTitle = await page.locator('.v19-modal-head strong').textContent();
  assert(/public|công khai|Anyone with link/i.test(confirmTitle || ''), 'Anyone with link phải đi qua confirm riêng', { confirmTitle });
  await page.getByRole('button', { name: 'Hủy' }).click();
  assert(shareCalls.length === 0, 'Bấm Anyone rồi hủy thì không được gọi share API', { shareCalls });
  assert(dialogs.length === 0, 'Không được dùng native dialog cho policy share', { dialogs });

  console.log(JSON.stringify({ status: 'PASS', labels }, null, 2));
  await browser.close();
})().catch(async error => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
