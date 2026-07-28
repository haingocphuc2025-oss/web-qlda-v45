const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8155/giao-dien-desktop-don-gian_v45.html?v=v45-500mb-resume';
const MiB = 1024 * 1024;
const TOTAL_BYTES = 500 * MiB;
const CHUNK_BYTES = 8 * MiB;
const PARTIAL_COMMIT_BYTES = 4 * MiB;

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `\n${JSON.stringify(detail, null, 2)}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const dataCalls = [];
  const allRequests = [];
  const progressEvents = [];
  const pageErrors = [];
  let committedBytes = 0;
  let partialFailureInjected = false;
  page.on('pageerror', error => pageErrors.push(String(error?.stack || error)));

  await page.route('https://accounts.google.com/gsi/client', route => route.abort());
  await page.route('**/upload/drive/v3/files**', async route => {
    if (!route.request().url().includes('uploadType=resumable')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { Location: 'https://upload.mock/v45/500mb-session', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location' },
      contentType: 'application/json', body: '{}'
    });
  });
  await page.route('https://upload.mock/v45/500mb-session', async route => {
    const request = route.request();
    const headers = request.headers();
    const contentRange = headers['content-range'] || '';
    allRequests.push({ contentRange, bodyLength: request.postDataBuffer()?.length || 0 });
    if (contentRange === `bytes */${TOTAL_BYTES}`) {
      const end = Math.max(-1, committedBytes - 1);
      await route.fulfill({ status: 308, headers: end >= 0 ? { Range: `bytes=0-${end}`, 'Access-Control-Expose-Headers': 'Range' } : {} });
      return;
    }
    const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match || Number(match[3]) !== TOTAL_BYTES) {
      await route.fulfill({ status: 400, contentType: 'text/plain', body: `bad range ${contentRange}` });
      return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    dataCalls.push({ start, end, bodyLength: request.postDataBuffer()?.length || 0 });

    // Simulate a network drop after Drive has committed exactly half of chunk #2.
    if (start === CHUNK_BYTES && !partialFailureInjected) {
      partialFailureInjected = true;
      committedBytes = CHUNK_BYTES + PARTIAL_COMMIT_BYTES;
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'partial chunk committed before transient failure' });
      return;
    }
    if (start !== committedBytes) {
      await route.fulfill({ status: 409, contentType: 'text/plain', body: `expected resume at ${committedBytes}, received ${start}` });
      return;
    }
    committedBytes = end + 1;
    if (committedBytes === TOTAL_BYTES) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'v45-500mb-id', name: 'v45-500mb.bin', size: String(TOTAL_BYTES) }) });
    } else {
      await route.fulfill({ status: 308, headers: { Range: `bytes=0-${committedBytes - 1}`, 'Access-Control-Expose-Headers': 'Range' } });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async ({ totalBytes, chunkBytes }) => {
    driveDirectAccessToken = 'v45-500mb-token';
    driveDirectTokenExpiresAt = Date.now() + 3600000;
    const block = new Uint8Array(chunkBytes).fill(0x5a);
    const pseudoFile = {
      name: 'v45-500mb.bin', type: 'application/octet-stream', size: totalBytes,
      slice(start, end) { return new Blob([block.subarray(0, Math.max(0, end - start))], { type: this.type }); }
    };
    let simulatedNow = 0;
    try {
      const uploaded = await driveApiResumableUpload(pseudoFile, 'folder-500mb', 'ROW-500MB', {
        // Deterministic clock: proves speed/ETA calculation without waiting for a real 500MB transfer.
        now: () => (simulatedNow += 1000),
        onProgress: state => window.__v45Progress500 = (window.__v45Progress500 || []).concat([{ ...state, time: performance.now() }])
      });
      return { ok:true, uploaded, progress:window.__v45Progress500 || [] };
    } catch (error) {
      return { ok:false, error:error?.message || String(error), progress:window.__v45Progress500 || [] };
    }
  }, { totalBytes: TOTAL_BYTES, chunkBytes: CHUNK_BYTES });
  progressEvents.push(...result.progress);

  const maxBody = Math.max(...dataCalls.map(call => call.bodyLength), 0);
  const partialResumeCall = dataCalls.find(call => call.start === CHUNK_BYTES + PARTIAL_COMMIT_BYTES);
  const queries = allRequests.filter(call => call.contentRange === `bytes */${TOTAL_BYTES}`);
  assert(result.ok, '500MB resumable upload phải hoàn tất', { result, lastCalls:dataCalls.slice(-5) });
  assert(dataCalls[0]?.start === 0 && dataCalls[0]?.end === CHUNK_BYTES - 1, 'Chunk đầu phải bắt đầu byte 0', { first:dataCalls[0] });
  assert(partialResumeCall, 'Sau 503 Drive đã nhận một phần chunk, request tiếp phải resume từ offset Drive báo', { dataCalls:dataCalls.slice(0,5) });
  assert(maxBody <= CHUNK_BYTES, 'Không được tải toàn bộ 500MB trong một request', { maxBody, chunkBytes:CHUNK_BYTES });
  assert(queries.length >= 1, 'Lỗi giữa upload phải query lại offset Drive', { allRequests:allRequests.slice(0,7) });
  assert(!allRequests.some(call => /script\.google\.com|base64/i.test(call.contentRange)), '500MB tuyệt đối không đi qua Apps Script/base64', { allRequests });
  assert(progressEvents.some(event => event.uploadState === 'retrying'), 'UI phải nhận trạng thái retry', { progressEvents });
  assert(progressEvents.some(event => Number(event.speedBytesPerSecond) > 0 && Number(event.etaSeconds) > 0), 'Progress 500MB phải kèm tốc độ và ETA trước khi hoàn tất', { progressEvents:progressEvents.slice(0,6) });
  assert(progressEvents.at(-1)?.uploadedBytes === TOTAL_BYTES && progressEvents.at(-1)?.progressPercent === 100 && Number(progressEvents.at(-1)?.etaSeconds) === 0, '500MB phải kết thúc progress 100% và ETA 0', { last:progressEvents.at(-1) });
  assert(pageErrors.length === 0, 'Không được có page error khi 500MB resumable', { pageErrors });

  console.log(JSON.stringify({ status:'PASS', chunks:dataCalls.length, maxBody, partialResumeAt:partialResumeCall.start, offsetQueries:queries.length, progressEvents:progressEvents.length }, null, 2));
  await browser.close();
})().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
