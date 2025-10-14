# PDF Reading Functionality

This document describes the PDF reading functionality available in the Memorall extension.

## Overview

The extension now supports reading and extracting text content from PDF files using [PDF.js](https://mozilla.github.io/pdf.js/). This allows users to process PDF documents just like regular web pages.

## Features

- Read PDF files from URLs
- Read PDF files from file uploads
- Extract text content from all pages or specific page ranges
- Access PDF metadata (title, author, subject, etc.)
- Search within PDF documents
- Export PDF content as text or Markdown
- Automatic PDF detection in content extraction
- Progress tracking for large PDF files

## Installation

The required dependencies are already installed:

```bash
npm install pdfjs-dist --legacy-peer-deps
```

## Core Modules

### 1. `src/embedded/pdf-extraction.ts`

Core PDF reading functionality using PDF.js.

#### Key Functions:

##### `readPDFFile(file: File | ArrayBuffer): Promise<PDFDocumentContent>`

Reads a PDF file and extracts all text content with metadata.

```typescript
const file = await selectFile(); // File input
const pdfContent = await readPDFFile(file);
console.log(pdfContent.title);
console.log(pdfContent.fullText);
```

##### `readPDFPages(file: File | ArrayBuffer, startPage: number, endPage: number): Promise<PDFPageContent[]>`

Extracts text from a specific range of pages.

```typescript
const pages = await readPDFPages(file, 1, 5); // Read first 5 pages
```

##### `readPDFFromUrl(url: string): Promise<PDFDocumentContent>`

Fetches and reads a PDF from a URL.

```typescript
const pdfContent = await readPDFFromUrl('https://example.com/document.pdf');
```

##### `isPDFUrl(url: string): boolean`

Checks if a URL points to a PDF file.

```typescript
if (isPDFUrl(window.location.href)) {
  // Current page is a PDF
}
```

#### Data Types:

```typescript
interface PDFPageContent {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
}

interface PDFDocumentContent {
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  creationDate: string;
  modificationDate: string;
  numPages: number;
  pages: PDFPageContent[];
  fullText: string;
}
```

### 2. `src/lib/pdf-utils.ts`

Higher-level utilities for working with PDFs.

#### Key Functions:

##### `selectAndReadPDF(): Promise<PDFDocumentContent | null>`

Prompts user to select a PDF file and reads it.

```typescript
const pdfContent = await selectAndReadPDF();
if (pdfContent) {
  console.log(`Loaded: ${pdfContent.title}`);
}
```

##### `formatPDFAsText(pdf: PDFDocumentContent): string`

Formats PDF content as plain text with metadata header.

```typescript
const textContent = formatPDFAsText(pdfContent);
// Save or display textContent
```

##### `formatPDFAsMarkdown(pdf: PDFDocumentContent): string`

Formats PDF content as Markdown with frontmatter.

```typescript
const markdown = formatPDFAsMarkdown(pdfContent);
// Save as .md file
```

##### `searchPDFContent(pdf: PDFDocumentContent, query: string, caseSensitive?: boolean)`

Searches for text within the PDF and returns matches with context.

```typescript
const results = searchPDFContent(pdfContent, 'machine learning');
results.forEach(result => {
  console.log(`Found on page ${result.pageNumber}: ${result.context}`);
});
```

##### `getPDFStats(pdf: PDFDocumentContent)`

Returns statistics about the PDF document.

```typescript
const stats = getPDFStats(pdfContent);
console.log(`Total words: ${stats.totalWords}`);
console.log(`Average words per page: ${stats.averageWordsPerPage}`);
```

### 3. `src/embedded/content-extraction.ts`

Integrated PDF support in content extraction pipeline.

#### Key Functions:

##### `extractPDFContent(url: string): Promise<ReadableContent>`

Extracts PDF content and formats it as ReadableContent.

##### `extractReadableContent(): Promise<ReadableContent>`

Automatically detects PDFs and extracts content accordingly.

```typescript
// Automatically handles both web pages and PDFs
const content = await extractReadableContent();
console.log(content.title);
console.log(content.textContent);
```

## Usage Examples

### Example 1: Read PDF from file input

```typescript
import { selectAndReadPDF } from '@/lib/pdf-utils';

async function readPDF() {
  const pdf = await selectAndReadPDF();
  if (pdf) {
    console.log('Title:', pdf.title);
    console.log('Pages:', pdf.numPages);
    console.log('Content:', pdf.fullText);
  }
}
```

### Example 2: Read PDF from URL

```typescript
import { readPDFFromUrl, isPDFUrl } from '@/embedded/pdf-extraction';

async function loadPDFFromURL(url: string) {
  if (!isPDFUrl(url)) {
    throw new Error('Not a PDF URL');
  }

  const pdf = await readPDFFromUrl(url);
  return pdf;
}
```

### Example 3: Search in PDF

```typescript
import { readPDFFile } from '@/embedded/pdf-extraction';
import { searchPDFContent } from '@/lib/pdf-utils';

async function searchInPDF(file: File, searchTerm: string) {
  const pdf = await readPDFFile(file);
  const results = searchPDFContent(pdf, searchTerm);

  console.log(`Found ${results.length} matches`);
  return results;
}
```

### Example 4: Process specific pages

```typescript
import { readPDFPages } from '@/embedded/pdf-extraction';

async function extractChapter(file: File) {
  // Read pages 10-20 (chapter 2)
  const pages = await readPDFPages(file, 10, 20);

  const chapterText = pages.map(p => p.text).join('\n\n');
  return chapterText;
}
```

### Example 5: Automatic content extraction

```typescript
import { extractPageContent } from '@/embedded/content-extraction';

// This automatically handles PDFs when viewing them in browser
async function extractCurrentPage() {
  const content = await extractPageContent();

  // Works for both regular web pages and PDFs
  console.log('Title:', content.title);
  console.log('Content:', content.article.textContent);
}
```

### Example 6: Export PDF as markdown

```typescript
import { readPDFFile } from '@/embedded/pdf-extraction';
import { formatPDFAsMarkdown } from '@/lib/pdf-utils';

async function exportToMarkdown(file: File) {
  const pdf = await readPDFFile(file);
  const markdown = formatPDFAsMarkdown(pdf);

  // Create download
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pdf.title || 'document'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

## Integration with Memorall

The PDF reading functionality is automatically integrated with the Memorall extension's content extraction pipeline:

1. **Content Scripts**: When a user visits a PDF URL, the content extraction automatically detects it and extracts text using `extractPDFContent()`.

2. **Remember Feature**: Users can "remember" PDF content just like web pages, and it will be properly indexed and searchable.

3. **Topic Management**: PDF content can be associated with topics and stored in the extension's database.

4. **Chat Context**: When chatting about a PDF, the extracted text is available as context for the AI.

## Configuration

### PDF.js Worker

The PDF.js worker is configured to use the CDN version:

```typescript
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
```

For production, you may want to bundle the worker locally. Update this in `src/embedded/pdf-extraction.ts`.

## Limitations

1. **Large Files**: Very large PDF files (>50MB) may take time to process and could impact performance.

2. **Scanned PDFs**: PDFs that are scanned images without OCR will not extract text properly. Consider adding OCR support if needed.

3. **Complex Layouts**: PDFs with complex layouts (multi-column, tables, forms) may have text extracted in unexpected order.

4. **Protected PDFs**: Password-protected or encrypted PDFs are not currently supported.

5. **Browser Compatibility**: Requires modern browser with ArrayBuffer and Worker support.

## Error Handling

All PDF functions throw errors when something goes wrong. Always wrap calls in try-catch:

```typescript
try {
  const pdf = await readPDFFromUrl(url);
  // Process PDF
} catch (error) {
  console.error('Failed to read PDF:', error);
  // Handle error appropriately
}
```

## Performance Tips

1. **Read Specific Pages**: When possible, use `readPDFPages()` to read only needed pages rather than the entire document.

2. **Progress Tracking**: For large PDFs, use `readPDFWithProgress()` to show progress to users.

3. **Lazy Loading**: Consider loading PDF content on-demand rather than automatically extracting everything.

4. **Caching**: Cache extracted PDF content to avoid re-processing the same document.

## Future Enhancements

Potential improvements to consider:

- OCR support for scanned PDFs
- Better handling of tables and complex layouts
- Support for PDF forms and annotations
- Thumbnail generation for pages
- Incremental loading for very large PDFs
- Support for password-protected PDFs
- Extract and preserve images from PDFs
- Better text positioning and structure preservation

## See Also

- [PDF.js Documentation](https://mozilla.github.io/pdf.js/)
- [Example Usage](../src/examples/pdf-reading-example.ts)
- Content Extraction Documentation
