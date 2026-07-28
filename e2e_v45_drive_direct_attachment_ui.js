const { chromium } = require('playwright');

const URL = 'http://localhost:8155/giao-dien-desktop-don-gian_v45.html?v=v45-drive-direct-ui';
const DRIVE_API_RE = /^https:\/\/www\.googleapis\.com\/(?:drive|upload\/drive)\/v3\/files/;
const APPS_SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\//;

function assert(condition, message, detail) {
  if (!condition) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const driveRequests = [];
  const appsScriptRequests = [];
  let nextFolderId = 0;

  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await page.route(APPS_SCRIPT_RE, route => {
    appsScriptRequests.push(route.request().url());
    return route.fulfill({ status: 500, contentType: 'text/plain', body: 'Apps Script must not be used by V45 direct upload.' });
  });
  await page.route(DRIVE_API_RE, async route => {
    const request = route.request();
    const url = request.url();
    const headers = request.headers();
    const body = request.postDataBuffer() || Buffer.alloc(0);
    driveRequests.push({ url, method: request.method(), authorization: headers.authorization || '', contentType: headers['content-type'] || '', bodyLength: body.length });

    if (url.includes('uploadType=multipart')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'v45-direct-file-id', name: 'v45-direct-4kb.txt', size: '4096' })
      });
      return;
    }
    if (request.method() === 'GET' && /\/drive\/v3\/files\/v45-direct-file-id/.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'v45-direct-file-id', name: 'v45-direct-4kb.txt', mimeType: 'text/plain', size: '4096',
          webViewLink: 'https://drive.google.com/file/d/v45-direct-file-id/view',
          webContentLink: 'https://drive.google.com/uc?id=v45-direct-file-id&export=download'
        })
      });
      return;
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) });
      return;
    }
    if (request.method() === 'POST') {
      nextFolderId += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `v45-folder-${nextFolderId}`, name: 'folder' }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'text/plain', body: `Unhandled Drive request ${request.method()} ${url}` });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('.browse-tree-child', { hasText: 'Hợp đồng - pháp lý' }).first().click();
  await page.waitForTimeout(250);

  const connect = page.locator('#driveApiSignInBtn');
  assert(await connect.isVisible(), 'Nút Kết nối Drive phải luôn thấy được ngoài menu ...');
  assert(!(await connect.evaluate(el => !!el.closest('#ssMoreMenu'))), 'Nút Kết nối Drive không được nằm trong menu ẩn');

  const rowIndex = 1;
  await page.locator(`.row-attachment-indicator[data-row-index="${rowIndex}"]`).click();

  // Before a Drive token exists, picker must not open and no backend may receive a file.
  let chooserOpenedWithoutToken = false;
  page.once('filechooser', () => { chooserOpenedWithoutToken = true; });
  await page.locator('#attachUploadBtn').click();
  await page.waitForTimeout(250);
  assert(!chooserOpenedWithoutToken, 'Chưa kết nối Drive thì không được mở picker/upload fallback');
  assert(driveRequests.length === 0 && appsScriptRequests.length === 0, 'Chưa có token thì không được gửi file đi đâu', { driveRequests, appsScriptRequests });

  // Safe OAuth simulation: only exposes the capability flag and a fake short-lived token.
  await page.evaluate(() => {
    window.google = { accounts: { oauth2: {} } };
    driveDirectAccessToken = 'v45-direct-test-token';
    driveDirectTokenExpiresAt = Date.now() + 60 * 60 * 1000;
  });

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#attachUploadBtn').click()
  ]);
  await chooser.setFiles({ name: 'v45-direct-4kb.txt', mimeType: 'text/plain', buffer: Buffer.alloc(4096, 0x61) });
  await page.waitForFunction(row => {
    const files = getAttachmentSheet()?.attachments?.[row] || [];
    return files.some(file => file.driveStatus === 'done' || file.driveStatus === 'error');
  }, rowIndex, { timeout: 10000 });

  const state = await page.evaluate(row => {
    const file = (getAttachmentSheet()?.attachments?.[row] || [])[0] || {};
    return {
      driveStatus: file.driveStatus, uploadState: file.uploadState, uploadMode: file.uploadMode,
      driveId: file.driveId, driveLink: file.driveLink, progressPercent: file.progressPercent
    };
  }, rowIndex);
  const multipartRequest = driveRequests.find(request => request.url.includes('uploadType=multipart'));

  assert(appsScriptRequests.length === 0, 'Direct-only V45 tuyệt đối không gọi Apps Script/base64', { appsScriptRequests });
  assert(!!multipartRequest, 'File 4KiB phải upload qua Drive multipart API', { driveRequests });
  assert(multipartRequest.authorization === 'Bearer v45-direct-test-token', 'Drive request phải có OAuth bearer token', { multipartRequest });
  assert(multipartRequest.bodyLength > 4096, 'Multipart body phải chứa bytes file thật', { multipartRequest });
  assert(state.driveStatus === 'done' && state.uploadMode === 'drive-api' && state.driveId === 'v45-direct-file-id' && state.progressPercent === 100,
    'Chỉ báo hoàn tất khi Drive trả metadata/link thật', { state });
  assert(pageErrors.length === 0, 'Không được có page error trong direct upload UI', { pageErrors });

  console.log(JSON.stringify({ status: 'PASS', state, driveRequests: driveRequests.length, appsScriptRequests: appsScriptRequests.length }, null, 2));
  await browser.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
