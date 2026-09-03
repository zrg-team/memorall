# 🧠 Memorall — hồ sơ nộp Unikorn

## 🏷️ Tên sản phẩm
Memorall

## 💬 Một câu định vị (tagline)
Memorall biến trình duyệt thành không gian làm việc cho AI agent: có bộ nhớ lâu dài, có công cụ thật, và bạn tự chọn mô hình — mặc định chạy ngay trên máy bạn.

## 📝 Mô tả sản phẩm (dán vào ô mô tả)

🧠 **Bộ nhớ lâu dài** · 🛠️ **Công cụ thật** · 🎛️ **Tự chọn mô hình** · 🔒 **Local-first**

### ✨ Sản phẩm là gì

Memorall là một *browser-native agent workspace* — extension cho Chrome/Edge (kèm bản web và bản desktop dùng chung một mã nguồn) biến trình duyệt thành nơi làm việc đầy đủ của AI agent:

- 🧠 **Bộ nhớ lâu dài** dưới dạng knowledge graph theo chủ đề
- 📚 **Thư viện tài liệu** đọc được PDF, ảnh, Excel ngay trong app
- 🛠️ **Công cụ thao tác thật**: trình duyệt, tệp, sandbox chạy code
- 🎛️ **Quyền tự chọn mô hình**: chạy trên máy hoặc gọi API khi cần

Toàn bộ dữ liệu mặc định nằm trong máy người dùng, không bắt buộc đăng nhập, không đẩy lên cloud.

### 🎯 Vấn đề giải quyết

Phần lớn thời gian làm việc tri thức diễn ra trong tab trình duyệt, nhưng công cụ AI hiện nay lại tách rời khỏi đó:

- 🗂️ Bạn đọc tài liệu, mở hàng chục tab, lưu PDF, ghi chú…
- 📋 …rồi vẫn phải copy–paste thủ công từng đoạn vào chatbot
- 🔁 …và mỗi cuộc trò chuyện lại bắt đầu từ con số không, vì trợ lý không nhớ gì về dự án của bạn
- ⚠️ Kèm theo rủi ro riêng tư: tài liệu nội bộ, hợp đồng, dữ liệu khách hàng bị gửi lên máy chủ bên thứ ba

**Memorall giải quyết cả hai.** Những gì bạn đọc và chủ động lưu — trang web, đoạn bôi đen, ảnh chụp màn hình, PDF, bảng Excel, ghi chú — được chuyển thành bộ nhớ có cấu trúc: knowledge graph theo chủ đề, kết hợp tìm kiếm từ khóa và tìm kiếm ngữ nghĩa bằng vector. Agent hiểu ngữ cảnh dự án, thuật ngữ và các tuyến nghiên cứu dài hạn của bạn thay vì chỉ trả lời trên một đoạn prompt rời rạc. Và vì mọi thứ chạy cục bộ, dữ liệu vẫn ở lại trên máy bạn.

### 🚀 Tính năng chính

1. 💬 **Trợ lý ngay trong trang.** Mở panel chat trên bất kỳ website nào; đính kèm đoạn bôi đen, nội dung đang hiển thị, toàn bộ text/HTML hoặc ảnh chụp trang làm ngữ cảnh; lưu vào một topic chỉ với vài cú nhấp.
2. 🕸️ **Bộ nhớ và knowledge graph.** Chuyển văn bản, Markdown, PDF, Excel thành node và quan hệ theo topic; duyệt bằng đồ thị trực quan, tìm kiếm ngữ nghĩa, chỉnh sửa và dọn dẹp dữ liệu ngay trên giao diện.
3. 🦾 **Agent có công cụ thật, không chỉ trả lời chữ.** Đọc/ghi thư viện tài liệu và workspace file, điều khiển trình duyệt (mở trang, đọc DOM, chờ selector, thao tác), chạy code Node.js trong sandbox ngay trong trình duyệt — cài package, chạy server, dựng thử ứng dụng.
4. 🧩 **Tự tạo agent riêng.** Mỗi agent là một graph do bạn định nghĩa: system prompt, skills, tools, kết nối MCP (HTTP/SSE), lịch chạy định kỳ; bật/tắt từng năng lực (truy xuất tri thức, web browser, sandbox, file system, delegation) cho từng agent.
5. 🎛️ **Tự do chọn mô hình.** Chạy model ngay trong trình duyệt bằng WebLLM, Wllama hoặc Transformers.js (tăng tốc WebGPU khi thiết bị hỗ trợ), hoặc kết nối OpenAI, OpenRouter, Ollama, LM Studio khi cần model mạnh hơn. Embedding chọn được 384d / 768d / 1536d.

🔐 *Quyền extension cần và lý do:* `activeTab` + content script (đọc nội dung trang khi bạn yêu cầu) · `storage` (lưu cấu hình và dữ liệu cục bộ) · `tabs`/`webNavigation` (mở trang và theo dõi điều hướng cho agent) · `contextMenus` (lưu nhanh nội dung bôi đen) · `notifications` (báo khi job nền chạy xong) · `offscreen` (chạy model và tác vụ nặng dưới nền để giao diện không giật).

### 👥 Ai nên dùng

Memorall dành cho người làm việc nặng trong trình duyệt và cần bộ nhớ tích luỹ:

- 🔬 **Nhà nghiên cứu, nghiên cứu sinh, analyst** phải đọc rồi tổng hợp hàng chục paper/báo cáo cho cùng một đề tài
- 👩‍💻 **Lập trình viên và kỹ sư AI** muốn một agent có sandbox và quyền truy cập file để thử nghiệm nhanh, hoặc muốn tự lắp agent riêng thay vì dùng chatbot đóng
- ✍️ **Người viết nội dung, biên tập, SEO** cần thu thập tư liệu theo chủ đề rồi truy vết lại nguồn
- ⚖️ **Luật sư, kế toán, nhân sự** và các nhóm xử lý tài liệu nhạy cảm không được phép đẩy dữ liệu lên cloud
- 🛡️ **Người ưu tiên quyền riêng tư** muốn một trợ lý AI chạy hoàn toàn offline

Memorall không phù hợp với người chỉ cần hỏi đáp nhanh một câu — giá trị của nó nằm ở bộ nhớ tích luỹ theo thời gian.

### 🏁 Cách bắt đầu

- 🧩 **Chrome / Edge (nền tảng chính):** cài từ Chrome Web Store — https://chromewebstore.google.com/detail/memorall/kcienfpnencfkniagcjlpaehofblfhab — ghim icon lên thanh công cụ, mở Memorall, chọn mô hình (tải một model chạy cục bộ, hoặc dán API key của OpenAI/OpenRouter), rồi bắt đầu lưu trang và trò chuyện. Không cần tạo tài khoản.
- 🌐 **Web:** dùng thử trực tiếp, không cần cài đặt, tại https://zrg-team.github.io/memorall/studio/
- 🖥️ **Desktop:** bản Windows (Tauri 2, có MSI/NSIS) đã dựng và kiểm thử; macOS và Linux build được từ mã nguồn trên đúng hệ điều hành.
- 📖 **Mã nguồn mở (MIT):** https://github.com/zrg-team/memorall — có thể tự build và tự kiểm chứng.

### ⚡ Điểm khác biệt

- ☁️ **So với chatbot đám mây (ChatGPT, Claude, Gemini):** Memorall chạy được hoàn toàn cục bộ và offline bằng model trong trình duyệt, không bắt buộc tài khoản; dữ liệu và bộ nhớ nằm trong máy người dùng thay vì trên máy chủ nhà cung cấp.
- 🧾 **So với extension kiểu “chat với trang đang mở”:** Memorall không dừng ở tóm tắt một trang. Nó tích luỹ bộ nhớ dài hạn dưới dạng knowledge graph theo chủ đề, có thư viện tài liệu và chuyển PDF/Excel thành tri thức, đồng thời agent có “tay chân” thật — tự động hoá trình duyệt, đọc/ghi file và chạy code trong sandbox.
- 📓 **So với công cụ ghi chú tích hợp AI (Notion AI, Obsidian Copilot):** Memorall là một runtime agent mở. Hành vi agent xây trên Flow Engine dạng graph — bạn tự lắp node, tool, middleware và điều kiện, thêm graph mới mà không phải sửa code cũ, thay vì bị khoá trong một vòng lặp prompt cố định.
- 🔓 **Một mã nguồn, ba nền tảng, mở hoàn toàn:** extension, web tĩnh và desktop chạy chung một codebase, phát hành theo giấy phép MIT — người dùng và doanh nghiệp tự kiểm chứng cách dữ liệu được xử lý thay vì phải tin lời quảng cáo.

## ✂️ Mô tả ngắn (dự phòng, ≤ 132 ký tự)
Không gian làm việc cho AI agent ngay trong trình duyệt: bộ nhớ local-first, công cụ thật, tự chọn mô hình.

## 🔗 Liên kết
- 🏠 Trang chủ: https://zrg-team.github.io/memorall/
- 🌐 Dùng thử trên web: https://zrg-team.github.io/memorall/studio/
- 🧩 Chrome Web Store: https://chromewebstore.google.com/detail/memorall/kcienfpnencfkniagcjlpaehofblfhab
- 💻 GitHub: https://github.com/zrg-team/memorall
- 🔐 Chính sách riêng tư: https://zrg-team.github.io/memorall/privacy_policy.html
- 🎬 Video giới thiệu: `video/memorall-promo.mp4` (60 giây, 1080p)
