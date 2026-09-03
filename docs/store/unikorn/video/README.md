# Video giới thiệu (60 giây, 1920×1080, 30 fps)

`memorall-promo.mp4` là video demo dùng cho hồ sơ Unikorn / Chrome Web Store / trang chủ.
Video dựng từ 8 ảnh chụp có dữ liệu thật trong thư mục cha, theo đúng ngôn ngữ hình ảnh
của `00-cover.png` (nền tối, chữ trắng, nhấn gradient xanh dương → xanh ngọc), phụ đề tiếng Việt.

Kịch bản:

| Giây | Cảnh |
| --- | --- |
| 0–5 | Logo, tên, tagline, các chip giá trị |
| 5–10 | Vấn đề (gõ chữ): hàng chục tab, copy–paste, hôm sau chatbot chẳng nhớ gì → *Memorall thì nhớ.* |
| 10–46 | 8 cảnh sản phẩm: hỏi ngay trên trang, knowledge graph, PDF/Excel thành tri thức, dựng agent, năng lực của agent, skill, chọn model, kết nối MCP |
| 46–52 | Chạy trên máy bạn · không cần tài khoản · dữ liệu không rời khỏi máy · MIT |
| 52–60 | Kêu gọi cài đặt, link dùng thử web, GitHub |

## Dựng lại

Composition là `promo.html`: mọi chuyển động là hàm thuần của thời gian (`window.__seek(ms)`),
nên mỗi khung hình được chụp riêng bằng Playwright rồi đưa thẳng vào ffmpeg (H.264, CRF 18).
Nhạc nền được tổng hợp trong `music.cjs` để không phải xin phép bản quyền.

```powershell
# ffmpeg cần có libx264 + aac: cài sẵn trên PATH, hoặc
#   npm i ffmpeg-static   (bất kỳ thư mục nào) rồi trỏ FFMPEG tới ffmpeg.exe in ra
$env:FFMPEG = "C:\path\to\ffmpeg.exe"

node docs/store/unikorn/video/render.cjs --preview 3,8.6,13,49   # ảnh tĩnh để soát bố cục (preview/)
node docs/store/unikorn/video/render.cjs                         # memorall-promo.mp4 (~4 phút)
node docs/store/unikorn/video/render.cjs --no-music              # bản không nhạc
```

Đổi lời hoặc thứ tự cảnh: sửa `data-h` / `data-p` / `data-img` của các `<section class="scene shot">`
và bảng `SCENES` trong `promo.html`. Tiêu điểm zoom của mỗi ảnh là `data-focal` (toạ độ % trong ảnh).
