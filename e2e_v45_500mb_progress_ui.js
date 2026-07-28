const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-500mb-progress-ui';
const MiB = 1024 * 1024;
const assert = (ok, message, detail) => { if (!ok) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.stack || error)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('.browse-tree-child', { hasText: 'Hợp đồng - pháp lý' }).first().click();
  await page.waitForTimeout(200);
  const row = 1;
  const result = await page.evaluate(({ rowIndex, MiB }) => {
    const sheet = getAttachmentSheet();
    ensureSheetAttachments(sheet)[rowIndex] = [{
      id: 'v45-500mb-ui', name: 'ho-so-nghiem-thu-500mb.pdf', size: 500 * MiB, type: 'application/pdf',
      driveStatus: 'uploading', uploadState: 'uploading', progressPercent: 42,
      uploadedBytes: 210 * MiB, totalBytes: 500 * MiB,
      speedBytesPerSecond: 8 * MiB, etaSeconds: 37
    }];
    openAttachmentPanel(rowIndex);
    const text = document.querySelector('#attachList')?.innerText || '';
    return { text, previewDisabled: document.querySelector('.attach-file-preview')?.disabled === true, shareDisabled: document.querySelector('.attach-file-share')?.disabled === true };
  }, { rowIndex: row, MiB });
  assert(result.text.includes('Đang tải lên Drive · 42%'), 'Panel phải hiển thị tiến độ phần trăm 500MB', result);
  assert(/8(?:\.0)? MB\/s/.test(result.text), 'Panel phải hiển thị tốc độ upload thật', result);
  assert(result.text.includes('còn 37 giây'), 'Panel phải hiển thị ETA còn lại', result);
  assert(result.previewDisabled && result.shareDisabled, 'Trong lúc upload không cho xem/chia sẻ file chưa được Drive xác nhận', result);
  assert(errors.length === 0, 'Progress UI không được có runtime error', { errors });
  console.log(JSON.stringify({ status: 'PASS', result }, null, 2));
  await browser.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
