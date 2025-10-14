# PDF Context Menu Integration

This document describes the PDF context menu integration added to the Memorall extension's background.ts.

## Overview

PDF-specific context menu items have been added to provide quick access to PDF operations when viewing PDF files in the browser. These menu items appear only when the user is viewing a PDF document.

## Context Menu Items

The following context menu items are available when viewing PDF files:

### 1. Extract PDF Content
- **ID**: `extract-pdf`
- **Title**: "Extract PDF content"
- **Function**: Extracts text content from all pages of the PDF
- **Result**: Shows notification with page count and statistics, stores extracted content in session storage

### 2. Extract PDF Page Range
- **ID**: `extract-pdf-pages`
- **Title**: "Extract PDF page range"
- **Function**: Prompts user for start/end page numbers and extracts only those pages
- **Result**: Shows notification with extracted page range and statistics

### 3. Search in PDF
- **ID**: `search-pdf`
- **Title**: "Search in PDF"
- **Function**: Prompts user for search term and finds all occurrences in the PDF
- **Result**: Shows notification with number of matches and first few results

### 4. Export PDF as Text
- **ID**: `export-pdf-text`
- **Title**: "Export PDF as text"
- **Function**: Exports entire PDF as plain text file with metadata header
- **Result**: Downloads a .txt file

### 5. Export PDF as Markdown
- **ID**: `export-pdf-markdown`
- **Title**: "Export PDF as Markdown"
- **Function**: Exports entire PDF as Markdown file with frontmatter
- **Result**: Downloads a .md file

## Implementation Details

### Background Script (`src/background.ts`)

The context menu items are registered in the `chrome.runtime.onInstalled` listener:

```typescript
// PDF-specific context menu items
chrome.contextMenus.create({
  id: EXTRACT_PDF_CONTEXT_MENU_ID,
  title: "Extract PDF content",
  contexts: ["page"],
  documentUrlPatterns: ["*://*/*.pdf", "file:///*.pdf"],
});
```

**Key Features:**
- Items only appear on PDF pages using `documentUrlPatterns`
- Supports both HTTP(S) URLs and local file URLs
- Separated from other menu items with a divider

### Message Handling

When a PDF context menu item is clicked:

1. **Background Script** sends message to content script:
   ```typescript
   chrome.tabs.sendMessage(tab.id, {
     type: `PDF_${menuItemId.toUpperCase()}`,
     tabId: tab.id,
     url: tab.url,
   });
   ```

2. **Content Script** receives and routes to PDF handler:
   ```typescript
   case CONTENT_BACKGROUND_EVENTS.PDF_EXTRACT_PDF:
     handlePDFOperation(message, sendResponse);
   ```

3. **PDF Handler** executes the operation:
   ```typescript
   await handlePDFMessage({
     type: message.type,
     url: message.url,
   });
   ```

### Content Script Handler (`src/embedded/pdf-content-handler.ts`)

The main handler file provides:

- **`handleExtractPDF()`**: Extract full PDF content
- **`handleExtractPDFPages()`**: Extract specific page range
- **`handleSearchPDF()`**: Search within PDF
- **`handleExportPDFAsText()`**: Export as plain text
- **`handleExportPDFAsMarkdown()`**: Export as Markdown
- **`handlePDFMessage()`**: Router for all PDF operations

### Event Constants (`src/constants/content-background.ts`)

New event types added:

```typescript
export const CONTENT_BACKGROUND_EVENTS = {
  // ... existing events
  PDF_EXTRACT_PDF: "PDF_EXTRACT_PDF",
  PDF_EXTRACT_PDF_PAGES: "PDF_EXTRACT_PDF_PAGES",
  PDF_SEARCH_PDF: "PDF_SEARCH_PDF",
  PDF_EXPORT_PDF_TEXT: "PDF_EXPORT_PDF_TEXT",
  PDF_EXPORT_PDF_MARKDOWN: "PDF_EXPORT_PDF_MARKDOWN",
};
```

## User Experience

### Visual Feedback

1. **In-Page Notifications**: Custom toast notifications appear in the top-right corner showing:
   - Operation status (success/failure)
   - Statistics (page count, word count, etc.)
   - Error messages if operation fails

2. **File Downloads**: Export operations trigger browser download with sanitized filename

3. **Session Storage**: Extracted content is stored in `chrome.storage.session` for access by other extension components

### Example Usage Flow

1. User opens a PDF file in browser (e.g., `https://example.com/document.pdf`)
2. User right-clicks anywhere on the PDF
3. PDF-specific menu items appear at the bottom of context menu
4. User clicks "Extract PDF content"
5. Extension extracts all text from PDF
6. Notification appears: "PDF Extracted - Extracted 25 pages, Words: 5,432, Characters: 32,100"
7. Content is stored in session for use in "Remember" or "Recall" features

## Integration with Memorall Features

### Remember Feature

Extracted PDF content can be remembered just like web pages:
- Use "Remember this page" on PDF to save entire document
- Use "Remember to topic" to associate PDF with a topic
- PDF text is searchable in the knowledge base

### Recall Feature

PDF content is available as context when using Recall:
- "Recall" opens chat with PDF content as context
- "Recall topic" includes PDF in topic-specific conversations

### Topic Management

PDFs can be assigned to topics:
- Extract PDF content
- Use "Remember to topic" to associate with existing topic
- PDF becomes part of topic's knowledge base

## Error Handling

All PDF operations include comprehensive error handling:

1. **Invalid PDF URLs**: Checks if current page is a PDF before proceeding
2. **Fetch Errors**: Handles network failures when downloading PDF
3. **Parse Errors**: Catches PDF.js parsing errors for corrupted PDFs
4. **User Cancellation**: Gracefully handles when user cancels prompts
5. **Storage Errors**: Logs warnings if session storage fails

Error notifications are displayed to user with helpful messages.

## Performance Considerations

1. **Large PDFs**: Operations may take time for very large PDFs (>50MB)
2. **Memory Usage**: Entire PDF content is loaded into memory during extraction
3. **Session Storage**: Extracted content is stored temporarily in session storage
4. **Background Processing**: Operations run in content script without blocking UI

## Browser Compatibility

### Supported

- Chrome/Edge 115+ (MV3 support)
- PDF.js worker via CDN
- File and HTTP(S) URLs

### Limitations

- Password-protected PDFs not supported
- Scanned PDFs (without OCR) won't extract text properly
- Some complex PDF layouts may have text extraction issues

## Future Enhancements

Potential improvements:

1. **Progress Indicators**: Show progress bar for large PDF operations
2. **Batch Operations**: Process multiple PDFs at once
3. **OCR Support**: Extract text from scanned PDFs
4. **Page Previews**: Show thumbnail previews when selecting page ranges
5. **Advanced Search**: Regex support, case-sensitive options
6. **Export Options**: More export formats (JSON, CSV, etc.)
7. **Annotations**: Extract and preserve PDF annotations
8. **Images**: Extract images from PDF pages

## Troubleshooting

### Context Menu Items Not Appearing

**Problem**: PDF menu items don't show when viewing PDF

**Solutions**:
- Verify URL ends with `.pdf`
- Check if PDF is embedded in iframe (context menus may not work)
- Reload extension and refresh PDF page
- Check browser console for errors

### Extraction Fails

**Problem**: "Failed to extract PDF" error

**Solutions**:
- Ensure PDF is accessible (not 404)
- Check if PDF is password-protected
- Verify network connection for remote PDFs
- Try with a different PDF file

### Export Downloads Not Working

**Problem**: Export creates file but doesn't download

**Solutions**:
- Check browser download settings
- Verify download permissions in extension manifest
- Check browser console for blocked download errors
- Ensure sufficient disk space

## Testing

To test PDF context menu integration:

1. Open any PDF file in browser
2. Right-click on the PDF
3. Verify all 5 PDF menu items appear
4. Test each operation:
   - Extract PDF content
   - Extract page range (e.g., pages 1-3)
   - Search for a term
   - Export as text
   - Export as Markdown
5. Verify notifications appear
6. Check downloads folder for exported files
7. Verify no console errors

## Code References

- Background script: `src/background.ts:10-21` (constants)
- Context menu creation: `src/background.ts:202-241` (menu items)
- Message handler: `src/background.ts:258-287` (PDF handler)
- Content script integration: `src/content.ts:55-62` (message routing)
- PDF operations: `src/embedded/pdf-content-handler.ts` (all functions)
- Event constants: `src/constants/content-background.ts:11-16`

## See Also

- [PDF Reading Documentation](./PDF_READING.md) - Core PDF functionality
- [Example Usage](../src/examples/pdf-reading-example.ts) - Code examples
- Background Script Architecture
- Content Script Communication Protocol
