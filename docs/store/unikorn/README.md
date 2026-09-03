# Bộ ảnh + mô tả nộp Unikorn (unikorn.vn/products/new)

`description.md` chứa toàn bộ phần chữ: tagline, mô tả dài (~7.000 ký tự, yêu cầu tối thiểu 500),
mô tả ngắn dự phòng và danh sách liên kết.

## Ảnh

| Tệp | Dùng làm | Chú thích gợi ý (dán kèm ảnh) |
| --- | --- | --- |
| `00-cover.png` (1200×630) | Thumbnail | Memorall — không gian làm việc cho AI agent ngay trong trình duyệt |
| `01-in-page-assistant.png` | Demo 1 | Trợ lý mở ngay trên trang đang đọc: đính kèm đoạn bôi đen, nội dung hiển thị, HTML hoặc ảnh chụp trang làm ngữ cảnh |
| `02-knowledge-graph.png` | Demo 2 | Knowledge graph theo chủ đề: 115 node, 186 quan hệ được rút ra từ tài liệu bạn đã lưu |
| `03-documents-pdf.png` | Demo 3 | Thư viện tài liệu: đọc PDF/ảnh/Excel ngay trong app và chuyển thành tri thức bằng "Convert to Knowledge" |
| `04-agent-builder.png` | Demo 4 | Tạo agent riêng: system prompt, skills, MCP, lịch chạy và bật/tắt từng năng lực (sandbox, web, file system) |
| `05-chat-workspace.png` | Demo 5 | Cửa sổ chat chính, chọn agent và mô hình ngay trong khung nhập |
| `06-models-local-remote.png` | Demo 6 | Tự chọn mô hình: WebLLM / Wllama / Transformers chạy trong máy, hoặc OpenRouter, OpenAI, Ollama, LM Studio |
| `07-skills-library.png` | Demo 7 | Thư viện skill theo chuẩn SKILL.md — dạy agent quy trình lặp lại, lưu cục bộ |
| `08-mcp-connections.png` | Demo 8 | Kết nối MCP: Composio, local server hoặc endpoint HTTP/SSE tự cấu hình; khóa được mã hóa bằng passkey |
| `09-flow-engine.png` | Demo 9 | Flow Builder: lắp graph agent từ các step có sẵn (retrieval, tool use, chat completion...) |
| `10-get-started.png` | Demo 10 | Ba cách bắt đầu: dịch vụ quản lý, model chạy cục bộ miễn phí, hoặc dùng API key của bạn |

Ảnh 01–05 chụp từ bản cài thật có dữ liệu; ảnh 06–10 chụp từ bản build production
(`publish/extension/chrome`) trên profile sạch ở 1280×800, chế độ tối.

`raw/` giữ toàn bộ ảnh chụp gốc của lần capture (kể cả các trang chưa có dữ liệu:
runtime, activities, embeddings, database) để chọn lại khi cần.

## Tái tạo ảnh 06–10

```powershell
yarn build:extension:chrome
node .claude/skills/run-memorall/driver.cjs open   # hoặc script capture trong docs/store/unikorn/capture.cjs
```
