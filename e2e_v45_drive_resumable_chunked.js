const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-resumable-chunked';
const MiB = 1024 * 1024;
const TOTAL_BYTES = 25 * MiB;
const CHUNK_BYTES = 8 * MiB;

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`);
}

function chunkRanges(total, chunkSize) {
  const ranges = [];
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push(`bytes ${start}-${Math.min(total, start + chunkSize) - 1}/${total}`);
  }
  return ranges;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const sessionCalls = [];
  const progressEvents = [];
  const expectedRanges = chunkRanges(TOTAL_BYTES, CHUNK_BYTES);
  let committedEnd = -1;
  let transient503Injected = false;

  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));
  await page.route('https://accounts.google.com/gsi/client', route => route.abort());
  await page.route('**/upload/drive/v3/files**', async route => {
    const request = route.request();
    if (!request.url().includes('uploadType=resumable')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: {
        Location: 'https://upload.mock/v45/session-1',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Location'
      },
      contentType: 'application/json',
      body: '{}'
    });
  });
  await page.route('https://upload.mock/v45/session-1', async route => {
    const request = route.request();
    const headers = request.headers();
    const contentRange = headers['content-range'] || '';
    const bodyLength = request.postDataBuffer()?.length || 0;
    sessionCalls.push({ contentRange, bodyLength, authorization: headers.authorization || '' });

    if (contentRange === `bytes */${TOTAL_BYTES}`) {
      const responseHeaders = committedEnd >= 0
        ? { Range: `bytes=0-${committedEnd}`, 'Access-Control-Expose-Headers': 'Range' }
        : {};
      await route.fulfill({ status: 308, headers: responseHeaders });
      return;
    }

    const currentIndex = expectedRanges.indexOf(contentRange);
    if (currentIndex < 0) {
      await route.fulfill({ status: 400, contentType: 'text/plain', body: `Expected Content-Range; got ${contentRange || '(missing)'}` });
      return;
    }
    if (currentIndex === 1 && !transient503Injected) {
      transient503Injected = true;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary outage' });
      return;
    }

    committedEnd = Number(contentRange.match(/-(\d+)\//)[1]);
    if (currentIndex === expectedRanges.length - 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'v45-large-file-id', name: 'v45-large.pdf', size: String(TOTAL_BYTES) })
      });
      return;
    }
    await route.fulfill({ status: 308, headers: { Range: `bytes=0-${committedEnd}` } });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async ({ totalBytes }) => {
    window.__v45ProgressEvents = [];
    driveDirectAccessToken = 'v45-test-token';
    driveDirectTokenExpiresAt = Date.now() + 60 * 60 * 1000;
    const file = new File([new Uint8Array(totalBytes).fill(7)], 'v45-large.pdf', { type: 'application/pdf' });
    try {
      const uploaded = await driveApiResumableUpload(file, 'v45-folder-id', 'HS-001', {
        onProgress: state => window.__v45ProgressEvents.push(state)
      });
      return { ok: true, uploaded, progressEvents: window.__v45ProgressEvents };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), progressEvents: window.__v45ProgressEvents || [] };
    }
  }, { totalBytes: TOTAL_BYTES });
  progressEvents.push(...(result.progressEvents || []));

  const dataChunkCalls = sessionCalls.filter(call => call.contentRange.startsWith('bytes ') && !call.contentRange.startsWith('bytes */'));
  const statusQueries = sessionCalls.filter(call => call.contentRange === `bytes */${TOTAL_BYTES}`);

  assert(result.ok, 'Resumable upload phải hoàn tất sau lỗi 503 giữa chừng', { result, sessionCalls });
  assert(dataChunkCalls.length === expectedRanges.length + 1, 'Phải gửi đúng 4 chunk 8MiB và retry 1 chunk lỗi', { expectedRanges, dataChunkCalls });
  assert(dataChunkCalls.every(call => expectedRanges.includes(call.contentRange)), 'Mỗi PUT chunk phải có Content-Range chính xác', { expectedRanges, dataChunkCalls });
  assert(dataChunkCalls.every(call => call.bodyLength <= CHUNK_BYTES), 'Không được PUT nguyên file lớn trong một request', { dataChunkCalls, totalBytes: TOTAL_BYTES });
  assert(dataChunkCalls.every(call => call.authorization === 'Bearer v45-test-token'), 'Mỗi request chunk phải mang OAuth bearer token', { dataChunkCalls });
  assert(statusQueries.length >= 1, 'Sau lỗi transient phải hỏi offset Drive để resume an toàn', { sessionCalls });
  assert(progressEvents.length >= expectedRanges.length, 'Phải phát progress theo byte upload thực', { progressEvents });
  assert(progressEvents.at(-1)?.uploadedBytes === TOTAL_BYTES && progressEvents.at(-1)?.progressPercent === 100, 'Progress cuối phải là 100% sau Drive xác nhận', { progressEvents });
  assert(pageErrors.length === 0, 'Không được có page error khi upload resumable', { pageErrors });

  console.log(JSON.stringify({
    status: 'PASS',
    totalBytes: TOTAL_BYTES,
    chunkBytes: CHUNK_BYTES,
    chunkRanges: dataChunkCalls.map(call => call.contentRange),
    statusQueries: statusQueries.length,
    progressEvents
  }, null, 2));
  await browser.close();
})().catch(async error => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
