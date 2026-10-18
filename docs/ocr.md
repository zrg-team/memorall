# OCR workspace

Choose **OCR** in the workspace switcher and select a compatible OCR or vision model. Upload a PDF, PNG, JPEG or WebP, then choose **Extract text**. Each processed page is saved in the session with its source image, page number and model name. Uploads are limited to 50 MB.

## Models and instructions

OCR runs inside Memorall through **Transformers Media**. Search or paste a Hugging Face repository in the on-device model browser, download a compatible ONNX export, and select it. Discovery checks ONNX files and architecture support against the installed runtime rather than a list of model names. Q4 weights are used when the export provides them. Downloaded models run through WebGPU or the CPU/WASM fallback without a separate model server.

The installed runtime must support the model's architecture, processor and export. Adding a new repository does not automatically make an unsupported architecture runnable. The OCR picker keeps its model selection separate from chat.

The setup screen features LightOnOCR-3 in its 4B, 1B and 0.8B variants. Each recommendation checks its actual repository files before enabling a local download. Official repositories without ONNX weights are labeled accordingly; a recommendation is not a claim that those weights can run locally. Search combines vision models, OCR capability tags and a wider set of ONNX OCR candidates before filtering for compatibility. OCR matches rank before general vision models. This avoids missing names such as LightOnOCR in keyword searches or burying compatible exports behind popular detector-only repos. Custom prefill/decode exports need their own runtime and are not offered as native downloads. There is no external demo link in OCR setup.

**Model instructions** accepts the prompt recommended by the model's card, including an empty prompt for image-only transcription. Custom instructions are sent verbatim and remembered per model on this device. **Use default instructions** restores the default, including the layout instruction when enabled. No prompt is inferred from a model's name.

Processors with a chat template receive a templated image message; processors without one receive the configured prompt directly. Encoder-decoder results retain their full output, while decoder-only results have their echoed input tokens removed.

Configured image-capable OpenAI, OpenRouter, Custom OpenAI-compatible, LM Studio and Ollama models can also be selected. Known text-only models are excluded. With an on-device model, documents stay local; a hosted model receives the page images used in its requests.

## PDFs and layout

Navigate a PDF and convert the current page, every page, or specific pages such as `1, 3-5, 8`. Ranges are inclusive, duplicate pages are removed, and processing follows document order. Invalid or out-of-range selections cannot start conversion. Pages are rendered locally one at a time, at up to 200 DPI and a maximum dimension of 1540 pixels. Stop cancels the current request and prevents subsequent pages from being submitted.

**Include layout boxes** requests labeled regions. Models that return markers such as `![title](80,70,920,140)` using normalized 0–1000 coordinates get colored source overlays, block counts and matching result cards. Hovering highlights matching elements; clicking or keyboard selection reveals the matching region or card. Fit and zoom controls help inspect the source. Block output is optional and depends on the model and prompt; ordinary transcription still works without coordinates.

Results offer **Blocks** when available, **Document**, **Raw**, and **Data (JSON)** views. Document rendering keeps headings, lists and tables, while stripping active HTML and model-provided attributes.

## Files and data

Choose Markdown, JSON or HTML, then **Download** or **Save to Files**. Exports include the selected conversion batch in page order, without mixing repeated conversions of the same file. Markdown and HTML contain readable document content; HTML can be opened offline and printed. JSON preserves raw Markdown, available block labels, coordinates and content, page numbers, requested pages, model provenance, and per-page statuses or errors. It does not invent fields such as invoice totals or convert arbitrary content into a fixed schema. The result picker can select any saved page; its source and linked regions are restored from history.
