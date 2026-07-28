const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-folder-hierarchy';

function assert(condition, message, detail) {
  if (!condition) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const creates = [];
  const errors = [];
  let ordinal = 0;
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  await page.route('https://accounts.google.com/gsi/client', route => route.abort());
  await page.route('**/drive/v3/files**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) });
      return;
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      ordinal += 1;
      creates.push({ name: payload.name, parents: payload.parents || [], mimeType: payload.mimeType || '' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `folder-${ordinal}`, name: payload.name }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const target = await page.evaluate(async () => {
    driveDirectAccessToken = 'v45-folder-token';
    driveDirectTokenExpiresAt = Date.now() + 60 * 60 * 1000;
    return ensureDriveDirectTargetFolder(
      'Dự án kiểm thử V45',
      '03_THI_CONG_NGHIEM_THU',
      'BBNT-001_Bien-ban-nghiem-thu__row-a1b2c3d4'
    );
  });

  const names = creates.map(item => item.name);
  const rowFolder = creates.find(item => /__row-a1b2c3d4$/.test(item.name));
  const archiveFolder = creates.find(item => item.name === '03_THI_CONG_NGHIEM_THU');
  assert(rowFolder, 'V45 phải tạo row-folder ổn định dưới nhóm hồ sơ', { creates });
  assert(archiveFolder, 'V45 phải có folder nhóm hồ sơ', { creates });
  assert(rowFolder.parents.length === 1 && rowFolder.parents[0] === `folder-${creates.indexOf(archiveFolder) + 1}`,
    'row-folder phải là con trực tiếp của folder nhóm hồ sơ', { creates, rowFolder, archiveFolder });
  assert(/__row-a1b2c3d4$/.test(target.folderName || '') && /__row-a1b2c3d4/.test(target.folderPath || ''),
    'Metadata trả về phải lưu folder row vật lý', { target });
  assert(errors.length === 0, 'Không được có page error khi tạo hierarchy Drive', { errors });

  console.log(JSON.stringify({ status: 'PASS', target, creates }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
