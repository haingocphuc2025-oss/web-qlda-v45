const { chromium } = require('playwright');

const URL = 'http://localhost:8155/giao-dien-desktop-don-gian_v45.html?v=v45-retry-ui';
const DRIVE_API_RE = /^https:\/\/www\.googleapis\.com\/(?:drive|upload\/drive)\/v3\/files/;
const assert = (ok, message, detail) => { if (!ok) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const requests = [];
  let folderCounter = 0;

  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  await page.route('**/script.google.com/**', route => route.abort());
  await page.route(DRIVE_API_RE, async route => {
    const request = route.request();
    const url = request.url();
    const headers = request.headers();
    requests.push({ url, method: request.method(), authorization: headers.authorization || '' });

    if (url.includes('uploadType=multipart')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'retry-drive-id', name: 'retry-4kb.txt', size: '4096' })
      });
      return;
    }
    if (request.method() === 'GET' && /\/drive\/v3\/files\/retry-drive-id/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'retry-drive-id',
          name: 'retry-4kb.txt',
          mimeType: 'text/plain',
          size: '4096',
          webViewLink: 'https://drive.google.com/file/d/retry-drive-id/view',
          webContentLink: 'https://drive.google.com/uc?id=retry-drive-id&export=download'
        })
      });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) });
      return;
    }
    if (request.method() === 'POST') {
      folderCounter += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `folder-${folderCounter}`, name: 'folder' }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'text/plain', body: `Unhandled Drive request ${request.method()} ${url}` });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('.browse-tree-child', { hasText: 'Hợp đồng - pháp lý' }).first().click();
  await page.waitForTimeout(200);
  const row = 1;
  await page.evaluate(rowIndex => {
    const sheet = getAttachmentSheet();
    ensureSheetAttachments(sheet)[rowIndex] = [{
      id: 'failed-entry', name: 'retry-4kb.txt', size: 4096, type: 'text/plain',
      driveStatus: 'error', uploadState: 'failed', driveError: 'Tải lỗi cũ'
    }];
    openAttachmentPanel(rowIndex);
  }, row);

  await page.evaluate(() => {
    window.google = { accounts: { oauth2: {} } };
    driveDirectAccessToken = 'v45-direct-test-token';
    driveDirectTokenExpiresAt = Date.now() + 60 * 60 * 1000;
  });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.attach-file-retry').click()
  ]);
  await chooser.setFiles({ name: 'retry-4kb.txt', mimeType: 'text/plain', buffer: Buffer.alloc(4096, 0x62) });
  await page.waitForFunction(rowIndex => {
    const files = ensureSheetAttachments(getAttachmentSheet())[rowIndex] || [];
    return files.length === 1 && files[0].driveStatus === 'done';
  }, row, { timeout: 10000 });

  const result = await page.evaluate(rowIndex => {
    const files = ensureSheetAttachments(getAttachmentSheet())[rowIndex] || [];
    return {
      files: files.map(file => ({ id:file.id, driveStatus:file.driveStatus, uploadState:file.uploadState, driveId:file.driveId, progress:file.progressPercent })),
      text: document.querySelector('#attachList')?.innerText || ''
    };
  }, row);

  assert(requests.some(req => req.url.includes('uploadType=multipart')), 'Retry phải upload qua Drive multipart API', { requests });
  assert(result.files.length === 1 && result.files[0].id === 'failed-entry' && result.files[0].driveStatus === 'done' && result.files[0].driveId === 'retry-drive-id', 'Retry phải tái dùng entry lỗi và nhận Drive ID từ link', result);
  assert(result.text.includes('Đã tải lên Drive') && !result.text.includes('Chưa lưu local'), 'UI retry thành công phải hiển thị trạng thái Drive rõ ràng', result);
  assert(errors.length === 0, 'Retry UI không được có runtime error', { errors });
  console.log(JSON.stringify({ status:'PASS', result, requests:requests.length }, null, 2));
  await browser.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
