# PDF Context Menu Troubleshooting Guide

## Issue: Context Menu Items Not Showing on PDF

### Problem
When opening a PDF like `https://pdfobject.com/pdf/sample.pdf`, the PDF-specific context menu items don't appear.

### Root Cause
Chrome's built-in PDF viewer has limitations:
1. Content scripts may not inject properly into PDF viewer
2. `documentUrlPatterns` in context menus doesn't work reliably with Chrome's PDF viewer
3. PDFs are often rendered in a special sandboxed environment

### Solution Implemented

We removed the `documentUrlPatterns` restriction and made PDF menu items visible on all pages. The PDF check now happens when the user clicks a menu item.

**Changes made:**
1. Removed `documentUrlPatterns: ["*://*/*.pdf", "file:///*.pdf"]` from context menu creation
2. Added PDF emoji (📄) to menu titles for easy identification
3. Added runtime URL check in the click handler
4. Show helpful notification if user clicks PDF option on non-PDF page

### How to Use

1. **Load the extension**: After making changes, reload the extension
   - Go to `chrome://extensions/`
   - Click the reload button on Memorall

2. **Test on PDF**:
   - Open https://pdfobject.com/pdf/sample.pdf
   - Right-click anywhere on the page
   - You should now see 5 PDF menu items with 📄 emoji:
     - 📄 Extract PDF content
     - 📄 Extract PDF page range
     - 📄 Search in PDF
     - 📄 Export PDF as text
     - 📄 Export PDF as Markdown

3. **What happens on non-PDF pages**:
   - Menu items still appear (for consistency)
   - If clicked, shows notification: "This page doesn't appear to be a PDF file"
   - User is guided to only use on PDF documents

## Testing Steps

### Step 1: Reload Extension
```
1. Open chrome://extensions/
2. Find Memorall extension
3. Click the reload icon
4. Verify no errors in console
```

### Step 2: Test with Online PDF
```
1. Open https://pdfobject.com/pdf/sample.pdf
2. Wait for PDF to fully load
3. Right-click anywhere on PDF
4. Verify 5 PDF menu items appear with 📄 emoji
5. Click "📄 Extract PDF content"
6. Should see notification with extracted content stats
```

### Step 3: Test with Local PDF
```
1. Download a PDF file
2. Drag and drop into Chrome (opens as file:// URL)
3. Right-click on PDF
4. Verify menu items appear
5. Test extraction
```

### Step 4: Test Error Handling
```
1. Open a regular web page (e.g., google.com)
2. Right-click
3. Click "📄 Extract PDF content"
4. Should see notification: "Not a PDF"
5. Verify graceful error message
```

## Known Limitations

### 1. Chrome's PDF Viewer Restrictions
**Issue**: Chrome's built-in PDF viewer is sandboxed

**Workarounds**:
- Extension fetches PDF content via URL
- Doesn't rely on DOM manipulation
- Uses PDF.js for parsing

### 2. Content Script Injection
**Issue**: Content scripts may not run in PDF viewer

**Solution**:
- Background script handles PDF operations
- Sends fetch request for PDF
- PDF.js parses ArrayBuffer directly

### 3. Large PDF Files
**Issue**: Very large PDFs (>50MB) may timeout

**Workarounds**:
- Use "Extract PDF page range" for large files
- Extract specific sections instead of full document
- Consider implementing streaming in future

### 4. Password-Protected PDFs
**Issue**: Cannot extract from encrypted PDFs

**Current Behavior**:
- Shows error notification
- Error message: "Failed to read PDF"

**Future Enhancement**:
- Add password prompt dialog
- Support encrypted PDFs

## Alternative Approaches

If context menu items still don't work:

### Approach 1: Keyboard Shortcut
Add keyboard shortcuts to trigger PDF operations:

```json
// manifest.json
"commands": {
  "extract-pdf": {
    "suggested_key": {
      "default": "Ctrl+Shift+P"
    },
    "description": "Extract PDF content"
  }
}
```

### Approach 2: Browser Action Button
Add PDF button to extension popup when on PDF page:

```typescript
// Check if current tab is PDF
if (isPDFUrl(currentTab.url)) {
  showPDFActions();
}
```

### Approach 3: Omnibox Command
Use address bar commands:

```
memorall pdf extract
```

## Debugging

### Enable Debug Logging

1. Open `src/background.ts`
2. Check logs in service worker console:
   ```
   chrome://extensions/ → Memorall → service worker → Console
   ```

3. Look for:
   - `📄 PDF operation response for {menuItemId}`
   - `❌ Failed to process PDF operation`

### Check Content Script

1. Open PDF page
2. Open DevTools (F12)
3. Check Console tab for:
   - `🚀 Memorall content script loaded on: {url}`
   - Any error messages

### Verify Menu Registration

In service worker console:
```javascript
chrome.contextMenus.getAll((menus) => {
  console.log('Registered menus:', menus);
});
```

Should show all 5 PDF menu items.

## Common Errors

### Error: "Could not establish connection"
**Cause**: Content script not injected

**Fix**:
1. Check manifest has content_scripts for `<all_urls>`
2. Reload extension
3. Refresh PDF page

### Error: "Failed to fetch PDF"
**Cause**: CORS or network issue

**Fix**:
1. Check host_permissions in manifest includes PDF URL
2. Try with local file:// PDF
3. Check network in DevTools

### Error: "Failed to read PDF"
**Cause**: Corrupted or invalid PDF

**Fix**:
1. Try different PDF file
2. Verify PDF opens normally in Chrome
3. Check PDF isn't password-protected

## Performance Optimization

For better performance with PDFs:

1. **Cache Extracted Content**
   - Store in session storage
   - Reuse for multiple operations
   - Clear on tab close

2. **Lazy Load Pages**
   - Only extract when needed
   - Don't process hidden pages
   - Use page range extraction

3. **Background Processing**
   - Move heavy parsing to offscreen document
   - Use Web Workers for parsing
   - Show progress indicators

## Future Improvements

1. **Dynamic Menu Visibility**
   - Only show PDF items on actual PDF pages
   - Requires periodic tab URL checking
   - May impact performance

2. **PDF Preview**
   - Show thumbnails in menu
   - Preview before extraction
   - Quick page navigation

3. **Batch Operations**
   - Process multiple PDFs
   - Export multiple pages
   - Bulk search

4. **OCR Support**
   - Extract text from scanned PDFs
   - Use Tesseract.js
   - Background processing

## Support

If issues persist:

1. Check extension version: Should be 0.0.2+
2. Verify Chrome version: Needs 115+
3. Check for conflicts: Disable other PDF extensions
4. Review console logs for specific errors
5. Try with simple PDF first (sample.pdf)

## Related Documentation

- [PDF Reading Documentation](./PDF_READING.md)
- [PDF Context Menu Integration](./PDF_CONTEXT_MENU.md)
- [Example Usage](../src/examples/pdf-reading-example.ts)
