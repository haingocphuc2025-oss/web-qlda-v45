# Web QLDA V45

Bản Web QLDA V45 hỗ trợ đính kèm file trực tiếp lên Google Drive.

## Chức năng chính

- Nút **Kết nối Google Drive** hiển thị trực tiếp trên toolbar.
- File nhỏ hơn 16 MiB dùng Drive multipart upload.
- File từ 16 MiB dùng resumable upload, chunk 8 MiB.
- Resume theo offset Google Drive xác nhận; retry 429/5xx.
- Hiển thị tiến độ, tốc độ và ETA.
- Không fallback Apps Script/base64 cho attachment.
- Chỉ báo thành công sau khi Drive trả metadata/file ID thật.
- PDF lớn được mở bằng Google Drive Preview sau khi upload hoàn tất.

## Cấu hình local

1. Sao chép:

   ```bash
   cp config.example.js config.local.js
   ```

2. Điền OAuth Web Client ID của deployment vào `config.local.js`.
3. Trong Google Cloud Console, thêm origin đang chạy vào **Authorized JavaScript origins**, ví dụ:

   ```text
   http://localhost:8155
   http://127.0.0.1:8155
   ```

`config.local.js` và `config.local.json` được `.gitignore`; không commit Client ID triển khai, token, API key, Drive ID hoặc Apps Script endpoint.

## Chạy local

```bash
npm install
npm run serve
```

Mở:

```text
http://localhost:8155/giao-dien-desktop-don-gian_v45.html
```

## Kiểm thử

Trong terminal khác khi server đang chạy ở port `8155`:

```bash
npm test
```

Probe OAuth thật (không upload file, không lưu token):

```bash
npm run test:oauth
```

## Bảo mật

- Access token chỉ tồn tại trong runtime browser.
- File mặc định kế thừa quyền thư mục Drive/Shared Drive.
- Không tự động đặt file thành public.
- `config.local.*` không thuộc repository.
