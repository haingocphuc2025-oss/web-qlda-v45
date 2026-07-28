# SPEC V45 — Upload Google Drive trực tiếp, nhanh và hỗ trợ file lớn

**Trạng thái:** Đã triển khai và kiểm thử contract V45  
**Phạm vi:** Attachment của Web QLDA; không thay đổi dữ liệu sheet/cột A.

## 1. Mục tiêu đã chốt

Người dùng cần upload file **thẳng Google Drive**, vừa nhanh cho file nhỏ, vừa ổn định với file lớn.

V45 chọn kiến trúc:

```text
Browser → Google Drive API trực tiếp → thư mục dự án/sheet → metadata attachment
```

- Không mã hóa base64 cho đường upload Drive trực tiếp.
- Không phụ thuộc `127.0.0.1:8780`/Drive Desktop để file lớn được coi là đã lên cloud.
- Attachment V45 không dùng Apps Script/base64 fallback; khi chưa có OAuth Drive thì chặn picker và yêu cầu kết nối Drive.

## 2. Hiện trạng V44 và gap cần xử lý

| Hiện trạng | Hệ quả |
|---|---|
| Có Drive API OAuth + multipart/resumable | Có nền tảng upload trực tiếp. |
| Nhánh `resumable` khởi tạo session rồi PUT toàn bộ file một lần | Không phải resumable chunk thực; mạng rớt là phải gửi lại cả file. |
| Không retry/backoff/query trạng thái session | Không bền với mạng yếu, HTTP 429/5xx hoặc timeout. |
| Timeout cố định 45 giây | File lớn/mạng chậm có thể báo lỗi dù request còn chạy hoặc cần lâu hơn. |
| `ATTACHMENT_LARGE_FILE_MODE=true` | Nếu local helper chạy, file có thể chỉ được đánh dấu `drive-desktop`, không chứng minh đã lên Drive cloud. |
| Apps Script nhận base64 | Payload tăng khoảng 33%; không phù hợp file lớn. |

## 3. Kiến trúc V45

### 3.0 UX người dùng: “thả là lên Drive, xong mới báo được”

Luồng chính trong panel đính kèm:

1. Người dùng **kéo-thả file từ Explorer** vào vùng đính kèm hoặc bấm `Chọn file`.
2. File vào queue và **upload thẳng Google Drive ở nền**; không cần copy sang Drive Desktop, không qua bước trung gian base64.
3. Mỗi file hiện: `Đang tải 42%` → `Đang xác minh Drive` → `✓ Đã tải lên Drive`.
4. Chỉ khi Google Drive API trả `fileId` và metadata thật, ứng dụng mới:
   - đổi trạng thái sang `Đã tải lên Drive`;
   - hiện toast không chặn: `✓ Đã tải lên Drive: <tên file>`;
   - gắn icon 📎/link vào đúng dòng hồ sơ.
5. Nếu lỗi/mất mạng, không được báo thành công giả; file hiện `Tải lỗi — Thử lại` và không cản trở file khác trong queue.

**Lưu ý:** kéo-thả từ Explorer là đường chính đáng tin cậy trên Windows. Paste file từ clipboard chỉ được hỗ trợ khi trình duyệt thực sự cung cấp `File` object (thường với ảnh); không cam kết cho mọi loại file copy trong Explorer.

### 3.0.1 Cần chuẩn bị một lần, không lặp theo từng file

- Mở app bằng `http://localhost`/STAGING và bấm `Kết nối Drive` để người upload cấp OAuth cho Drive API lần đầu.
- Thư mục gốc Drive hoặc Shared Drive đã cấp quyền **Content manager/Editor** cho chính tài khoản Google của người upload.
- Không cần Drive Desktop, không cần mật khẩu Google, không cần chia sẻ từng file sau mỗi lần upload.
- Với Shared Drive: file kế thừa quyền thư mục/Shared Drive, nên CĐT/TVGS xem được theo quyền đã cấp sẵn.

### 3.1 Chọn route

| Điều kiện | Route | Concurrency |
|---|---|---|
| Đã kết nối Drive API, file < 16 MiB | Multipart Drive API | 3 file đồng thời |
| Đã kết nối Drive API, file >= 16 MiB | Resumable Drive API dạng chunk | 1 file lớn đồng thời |
| Chưa kết nối Drive API, mọi kích thước | Chặn picker; yêu cầu kết nối Drive API | 0 |

Ngưỡng 16 MiB và chunk 8 MiB là cấu hình tập trung; chunk phải là bội số 256 KiB theo Google resumable upload.

### 3.2 Resumable chunk thực

1. Tạo session `uploadType=resumable`, nhận `sessionUrl`.
2. Gửi `file.slice(start, end)` theo từng chunk 8 MiB với header:
   ```text
   Content-Length: <chunkBytes>
   Content-Range: bytes <start>-<end>/<totalBytes>
   ```
3. HTTP `308` → đọc `Range`, cập nhật offset và gửi chunk tiếp.
4. HTTP `200/201` → hoàn tất, lấy metadata file Drive.
5. Network error / `408` / `429` / `5xx` → exponential retry 1s, 2s, 4s (tối đa 3 lần mỗi chunk).
6. Sau retry thất bại → query session bằng `Content-Range: bytes */<totalBytes>` để đọc offset server đã nhận, rồi tiếp tục từ offset đó.
7. Người dùng có thể **Hủy**; UI dừng queue và trạng thái là `cancelled`, không báo thành công giả.

> Sau reload trang, browser không còn `File` object để tự gửi tiếp. V45 lưu metadata pending nhưng yêu cầu người dùng chọn lại chính file khi muốn resume sau reload; hệ thống đối chiếu tên/kích thước/hash mẫu trước khi tiếp tục.

### 3.3 Không đọc cả file vào RAM

- Direct Drive route phải dùng `File`/`Blob` và `file.slice()`.
- Không attachment route nào được tạo base64; file được gửi bằng `File`/`Blob` trực tiếp đến Drive API.
- Chỉ một chunk 8 MiB được giữ trong bộ nhớ khi upload file lớn.

### 3.4 Trạng thái và UX

Mỗi file có state machine rõ ràng:

```text
queued → authorizing → uploading → retrying → verifying → done
                     └→ paused / cancelled / failed
```

UI hiển thị:
- Progress `%` và `uploadedBytes / totalBytes`.
- Tốc độ tức thời/ETA khi đủ dữ liệu.
- Nhãn route: `Drive trực tiếp` hoặc `Chờ kết nối Drive`.
- Nút `Tạm dừng`, `Tiếp tục`, `Thử lại`, `Hủy` theo state.
- Attachment chỉ có `driveStatus=done` khi Drive trả file ID và metadata thật.

### 3.5 Metadata attachment (additive, tương thích V44)

```js
{
  id, name, size, type, addedAt,
  driveId, driveLink, webViewLink, driveDownloadUrl,
  driveStatus, driveError, uploadMode,
  uploadRoute,              // 'drive-multipart' | 'drive-resumable'
  uploadState,              // queued | uploading | retrying | verifying | done | failed | cancelled
  uploadedBytes, totalBytes,
  progressPercent, retryCount,
  sessionUrl,               // chỉ runtime; không render/không lộ UI
  lastErrorCode, updatedAt
}
```

- Fields cũ vẫn được đọc bình thường.
- `sessionUrl` không được hiện hoặc đưa vào tooltip/link chia sẻ.
- `uploadState` và progress được persist cục bộ; chỉ attachment có Drive ID và metadata Drive mới là attachment cloud hoàn chỉnh.

## 4. Bảo mật/chia sẻ

- V45 mặc định **không** tự gọi `type:'anyone'` sau upload.
- Quyền file kế thừa thư mục Drive dự án.
- Nếu cần link công khai, có action riêng `Tạo link công khai` với modal xác nhận rõ ràng.

## 5. Acceptance / E2E

1. File 1 MiB dùng multipart Drive direct, không base64.
2. Fixture 25 MiB dùng ≥4 chunks 8 MiB, đúng `Content-Range` liên tiếp.
3. Chèn một lỗi `503` giữa chunk: retry/backoff rồi resume từ byte server xác nhận, không upload lại từ byte 0.
4. `429` retry tối đa 3 lần; sau đó UI `failed` có nút `Thử lại`.
5. Chưa có Drive OAuth: không mở picker, không gọi Apps Script/base64, UI yêu cầu kết nối Drive.
6. Queue 3 file nhỏ: tối đa 3 concurrent; queue 2 file lớn: tối đa 1 concurrent.
7. Progress tăng từ 0→100, driveStatus chỉ `done` sau metadata Drive trả về.
8. Hủy file đang upload không ghi `driveStatus=done` và không làm block file khác.
9. Regression V44 9/9 vẫn xanh; thêm `e2e_v45_drive_resumable_chunked.js`.

## 6. Phạm vi không làm trong lát V45 này

- Không tự resume sau reload mà không chọn lại file (giới hạn bảo mật của browser File API).
- Không thay đổi schema sheet/import Excel/gutter attachment.
- Không dùng Apps Script/base64/local-helper làm đường upload attachment.

## 7. Quyết định triển khai đề xuất

Triển khai **Drive Direct Turbo**:

- Drive API direct là primary.
- Multipart <16 MiB; chunked resumable ≥16 MiB, chunk 8 MiB.
- Retry/resume/progress/cancel là bắt buộc.
- Không Apps Script/base64/local-helper fallback cho attachment.
- Trạng thái cloud chỉ dựa trên metadata Drive xác nhận.
- Private-by-default, public share là thao tác riêng.

---
*SPEC được cập nhật theo mã V45 và contract E2E ngày 2026-07-28.*
'} } }]}Oops tool call invalid concatenated? Need see. We tried commentary tool with likely call invalid due garbage? It hasn't executed shown. Need call correct. We need avoid too much. Use write_file.៏ Let's make proper. +#+#+#+#+#+ to=functions.write_file in commentary  北京赛车女րել  天天爱彩票中奖. Let's call. +#+#+#+#+#+ to=functions.write_file ￣影音先锋json={{