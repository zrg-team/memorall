# PDF Background Implementation

## Overview

This document explains the background-only PDF implementation that works with Chrome's built-in PDF viewer, which doesn't support content script injection.

## The Problem

When you open a PDF directly in Chrome (e.g., `https://example.com/sample.pdf`), Chrome uses a special sandboxed PDF viewer that:

1. **Doesn't allow content script injection** - Your content scripts won't run
2. **Runs in a restricted environment** - Limited DOM access
3. **Blocks extension messaging** - Can't communicate with content scripts

This means our original approach of using content scripts to handle PDF operations wouldn't work for PDFs opened directly in the browser.

## The Solution

All PDF operations now run **entirely in the background script** without requiring content scripts:

1. **Context menu click** → Background script detects PDF URL
2. **Background script** → Fetches PDF directly via `fetch()`
3. **PDF.js in service worker** → Parses PDF from ArrayBuffer
4. **Background operations** → Extract, search, export without content script
5. **Chrome notifications** → Show results to user
6. **Chrome downloads API** → Trigger file downloads

## Architecture

### Service Worker Environment

```
┌─────────────────────────────────────┐
│     Background Script (SW)          │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  PDF Service                 │  │
│  │  - fetchAndReadPDF()         │  │
│  │  - extractPDFPages()         │  │
│  │  - searchInPDF()             │  │
│  │  - formatPDFAsText()         │  │
│  │  - formatPDFAsMarkdown()     │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  PDF.js Worker               │  │
│  │  (from CDN)                  │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
         ↓                    ↓
   [Notifications]      [Downloads]
```

### Files Structure

**New Files:**
- `src/services/pdf-service.ts` - Core PDF operations for service worker
- `docs/PDF_BACKGROUND_IMPLEMENTATION.md` - This document

**Modified Files:**
- `src/background.ts` - Added PDF handlers and operations
- `manifest.json` - Added `downloads` permission

**Unchanged (still useful for embedded PDFs):**
- `src/embedded/pdf-extraction.ts` - PDF operations for content scripts
- `src/embedded/pdf-content-handler.ts` - Content script handlers
- `src/lib/pdf-utils.ts` - Utility functions

## Implementation Details

### 1. PDF Service (`src/services/pdf-service.ts`)

Core PDF operations designed to run in service worker environment:

```typescript
// Fetch and parse PDF
export async function fetchAndReadPDF(url: string): Promise<PDFDocumentContent> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  // Extract all pages...
  return pdfContent;
}
```

**Key Features:**
- Works in service worker context
- Uses `fetch()` instead of file inputs
- Processes ArrayBuffer directly
- No DOM manipulation needed

### 2. Background Handlers (`src/background.ts`)

Five operations implemented entirely in background:

#### a) Extract PDF Content
```typescript
async function handleExtractPDF(url: string) {
  const pdfContent = await fetchAndReadPDF(url);
  const stats = getPDFStats(pdfContent);

  // Store in session storage
  await chrome.storage.session.set({
    lastExtractedPDF: { url, content: pdfContent }
  });

  // Show notification with stats
  chrome.notifications.create({...});
}
```

#### b) Extract PDF Pages
```typescript
async function handleExtractPDFPages(url: string) {
  // Extracts pages 1-10 by default
  const pages = await extractPDFPages(url, 1, 10);
  await chrome.storage.session.set({...});
}
```

**Note:** Can't prompt user for page range in service worker, so uses default 1-10. Future enhancement: Add popup UI for custom ranges.

#### c) Search in PDF
```typescript
async function handleSearchPDF(url: string) {
  // Extract and cache PDF
  const pdfContent = await fetchAndReadPDF(url);
  await chrome.storage.session.set({...});

  // Notify user to use popup for search
  chrome.notifications.create({...});
}
```

**Note:** Service workers can't show prompt dialogs. Search functionality requires popup UI.

#### d) Export as Text
```typescript
async function handleExportPDFText(url: string) {
  const pdfContent = await fetchAndReadPDF(url);
  const textContent = formatPDFAsText(pdfContent);

  // Create blob and trigger download
  const blob = new Blob([textContent], { type: "text/plain" });
  const downloadUrl = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url: downloadUrl,
    filename: `${sanitizeFilename(pdfContent.title)}.txt`,
    saveAs: true,
  });
}
```

#### e) Export as Markdown
```typescript
async function handleExportPDFMarkdown(url: string) {
  const pdfContent = await fetchAndReadPDF(url);
  const markdownContent = formatPDFAsMarkdown(pdfContent);

  // Trigger download with .md extension
  await chrome.downloads.download({...});
}
```

### 3. PDF.js Configuration

Configured to work in service worker:

```typescript
// Use CDN worker (works in service worker context)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```

**Why CDN?**
- Service workers have restrictions on loading local workers
- CDN worker is reliably accessible
- No bundling complications

### 4. Permissions

Added to `manifest.json`:

```json
{
  "permissions": [
    "downloads"  // For chrome.downloads.download()
  ],
  "host_permissions": [
    "*://*/*.pdf"  // For fetch() PDF files
  ]
}
```

## User Experience

### When user clicks context menu item on PDF:

1. **Extract PDF content**
   - Shows: "Extracting PDF..." notification
   - Extracts all pages
   - Shows: "PDF Extracted - X pages, Y words" notification
   - Stores in session storage

2. **Extract PDF page range**
   - Shows: "Extracting PDF Pages..." notification
   - Extracts pages 1-10 (default)
   - Shows: "Pages Extracted - 10 pages, X words"
   - Stores in session storage

3. **Search in PDF**
   - Shows: "PDF Search - Use extension popup to search"
   - Caches PDF for future search
   - User can search in popup UI

4. **Export as text**
   - Shows: "Exporting PDF..." notification
   - Triggers download with .txt file
   - Shows: "Export Complete" notification

5. **Export as Markdown**
   - Shows: "Exporting PDF..." notification
   - Triggers download with .md file
   - Shows: "Export Complete" notification

## Session Storage

Extracted PDFs are stored in session storage for quick access:

```typescript
// Stored structure
{
  lastExtractedPDF: {
    url: "https://example.com/document.pdf",
    content: PDFDocumentContent,
    extractedAt: "2025-01-15T10:30:00Z"
  },
  lastExtractedPDFPages: {
    url: "https://example.com/document.pdf",
    startPage: 1,
    endPage: 10,
    pages: PDFPageContent[],
    extractedAt: "2025-01-15T10:30:00Z"
  }
}
```

**Benefits:**
- Reuse for multiple operations
- Fast access for search
- Cleared when tab closes
- No persistent storage needed

## Limitations

### 1. No User Prompts

**Issue:** Service workers can't show `prompt()` or `confirm()` dialogs

**Workaround:**
- Use default values (e.g., pages 1-10)
- Direct users to popup UI for custom input
- Show notifications with instructions

### 2. No Visual Feedback in Page

**Issue:** Can't show in-page UI elements (like the content script did)

**Solution:**
- Use Chrome notifications instead
- Show progress in notification title
- Clear messaging about what happened

### 3. Large PDF Performance

**Issue:** Fetching and parsing large PDFs in service worker

**Mitigation:**
- Show "Processing..." notification immediately
- Service worker timeout is 30 seconds (plenty for most PDFs)
- Future: Add chunked processing for very large files

### 4. CORS Restrictions

**Issue:** Some PDFs may have CORS restrictions

**Solution:**
- Added `*://*/*.pdf` to host_permissions
- Works for most publicly accessible PDFs
- Local file:// URLs work fine

## Testing

### Test Steps

1. **Reload Extension**
   ```
   chrome://extensions/ → Memorall → Reload
   ```

2. **Open PDF**
   ```
   Open: https://pdfobject.com/pdf/sample.pdf
   ```

3. **Test Context Menu**
   ```
   Right-click → See 📄 PDF menu items
   ```

4. **Test Extract**
   ```
   Click: 📄 Extract PDF content
   Wait: 2-3 seconds
   See: "PDF Extracted - 1 pages, X words" notification
   ```

5. **Test Export**
   ```
   Click: 📄 Export PDF as text
   See: Download prompt with .txt file
   Verify: File contains PDF text content
   ```

6. **Check Console**
   ```
   chrome://extensions/ → Memorall → service worker → Console
   See: 📄 logs showing PDF operations
   ```

### Expected Console Output

```
📄 Starting PDF operation: extract-pdf for https://...
📄 Fetching PDF from: https://...
📄 PDF fetched, size: 12345 bytes
📄 PDF loaded, pages: 1
📄 Extracted page 1/1
✅ PDF extraction complete: { title: "...", pages: 1, textLength: 123 }
✅ PDF extracted and stored in session
```

## Future Enhancements

### 1. Popup UI for Custom Input

Add popup page for:
- Custom page range selection
- Search query input
- Export options (format, quality, etc.)

### 2. Progress Indicators

For large PDFs:
- Show real-time progress in notification
- "Processing page 5/50..."
- Cancel button for long operations

### 3. Batch Operations

Process multiple PDFs:
- Select multiple PDF tabs
- Extract all in one operation
- Download as ZIP

### 4. OCR Support

For scanned PDFs:
- Use Tesseract.js for OCR
- Extract text from images
- Background processing

### 5. Caching Strategy

Optimize performance:
- Cache parsed PDFs in IndexedDB
- Reuse cached data for 24 hours
- Clear cache on storage limits

## Comparison: Content Script vs Background

| Feature | Content Script | Background Script |
|---------|---------------|-------------------|
| Works on embedded PDFs | ✅ Yes | ❌ No |
| Works on direct PDF URLs | ❌ No | ✅ Yes |
| In-page UI | ✅ Yes | ❌ No |
| User prompts | ✅ Yes | ❌ No |
| File downloads | ⚠️ Workaround | ✅ Native |
| Session storage | ✅ Yes | ✅ Yes |
| Performance | Good | Better |

**Current Strategy:**
- Background script handles direct PDF URLs (Chrome's viewer)
- Content script available for embedded PDFs in web pages
- Both implementations coexist for maximum compatibility

## Troubleshooting

### Issue: "Failed to fetch PDF"

**Causes:**
- CORS restrictions
- Network timeout
- Invalid URL

**Solutions:**
- Check host_permissions includes PDF domain
- Try with local file:// PDF
- Verify PDF URL is accessible

### Issue: No notification appears

**Causes:**
- Notifications permission denied
- Service worker not running

**Solutions:**
- Check chrome://settings/content/notifications
- Reload extension
- Check service worker console for errors

### Issue: Download doesn't start

**Causes:**
- Downloads permission missing
- Popup blocker active

**Solutions:**
- Verify `downloads` in manifest.json
- Check browser download settings
- Allow downloads from extension

## Related Documentation

- [PDF Reading](./PDF_READING.md) - Core PDF functionality
- [PDF Context Menu](./PDF_CONTEXT_MENU.md) - Menu integration
- [PDF Troubleshooting](./PDF_TROUBLESHOOTING.md) - Common issues
- [Examples](../src/examples/pdf-reading-example.ts) - Code examples
