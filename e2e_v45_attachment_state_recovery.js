const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-state-recovery';
function assert(condition, message, detail) {
  if (!condition) throw new Error(message + (detail ? `\n${JSON.stringify(detail, null, 2)}` : ''));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.locator('.browse-tree-child', { hasText: 'Hợp đồng - pháp lý' }).first().click();
  await page.waitForTimeout(200);
  const row = 1;
  await page.evaluate(rowIndex => {
    const sheet = getAttachmentSheet();
    const store = ensureSheetAttachments(sheet);
    store[rowIndex] = [
      {
        id: 'legacy-local-copy', name: 'legacy-4kb.xlsx', size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        localStatus: 'error', localPath: 'C:/obsolete/legacy-4kb.xlsx',
        driveStatus: '', addedAt: '28/7/2026 14:48:36'
      },
      {
        id: 'legacy-failed-copy', name: 'legacy-4kb.xlsx', size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        driveStatus: 'error', driveError: 'Drive chưa xác nhận file ID.',
        addedAt: '28/7/2026 14:48:37'
      }
    ];
    openAttachmentPanel(rowIndex);
  }, row);
  await page.waitForTimeout(100);
  const result = await page.evaluate(rowIndex => {
    const files = ensureSheetAttachments(getAttachmentSheet())[rowIndex] || [];
    return {
      files: files.map(file => ({
        id: file.id, driveStatus: file.driveStatus, uploadState: file.uploadState,
        localStatus: file.localStatus || '', driveError: file.driveError || ''
      })),
      text: document.querySelector('#attachList')?.innerText || '',
      retryButtons: document.querySelectorAll('.attach-file-retry').length,
      disabledPreview: document.querySelector('.attach-file-preview')?.disabled === true,
      disabledShare: document.querySelector('.attach-file-share')?.disabled === true
    };
  }, row);
  assert(result.files.length === 1, 'Legacy duplicate cùng nguồn phải được gom còn một entry', result);
  assert(result.files[0].driveStatus === 'error' && result.files[0].uploadState === 'failed', 'Legacy entry phải chuyển về trạng thái lỗi rõ ràng', result);
  assert(result.files[0].localStatus === '' && !result.text.includes('Chưa lưu local'), 'V45 không được hiển thị trạng thái local-helper cũ', result);
  assert(result.retryButtons === 1, 'Entry lỗi phải có hành động Thử lại/Chọn lại file', result);
  assert(result.disabledPreview && result.disabledShare, 'Không có Drive ID thì Xem/Chia sẻ phải disable', result);
  assert(pageErrors.length === 0, 'Không được có runtime error khi phục hồi attachment cũ', { pageErrors });
  console.log(JSON.stringify({ status: 'PASS', result }, null, 2));
  await browser.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
