/**
 * PDF Page Selector Dialog
 * Allows users to select specific pages from a PDF to convert to remembered content
 */

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, BookOpen, Check } from "lucide-react";
import type { DocumentFile } from "@/types/document-library";
import { documentStorageService } from "@/modules/documents/services/document-storage";
import { readPDFFile, type PDFPageContent } from "@/embedded/pdf-extraction";
import { backgroundJob } from "@/services/background-jobs/background-job";
import { logError, logInfo } from "@/utils/logger";

interface PDFPageSelectorProps {
	file: DocumentFile;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConvert?: () => void; // Simplified callback - no need to pass data anymore
}

export const PDFPageSelector: React.FC<PDFPageSelectorProps> = ({
	file,
	open,
	onOpenChange,
	onConvert,
}) => {
	const [loading, setLoading] = useState(false);
	const [pages, setPages] = useState<PDFPageContent[]>([]);
	const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
	const [converting, setConverting] = useState(false);
	const [pageRangeStart, setPageRangeStart] = useState("");
	const [pageRangeEnd, setPageRangeEnd] = useState("");

	useEffect(() => {
		if (open && file.type === "pdf") {
			loadPDFPages();
		}
	}, [open, file.id]);

	const loadPDFPages = async () => {
		try {
			setLoading(true);
			const content = await documentStorageService.getFileContent(file.id);
			const arrayBuffer =
				content.buffer instanceof ArrayBuffer
					? content.buffer
					: new ArrayBuffer(content.byteLength);

			const pdfContent = await readPDFFile(arrayBuffer);
			setPages(pdfContent.pages);
		} catch (error) {
			console.error("Failed to load PDF pages:", error);
		} finally {
			setLoading(false);
		}
	};

	const togglePage = (pageNumber: number) => {
		setSelectedPages((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(pageNumber)) {
				newSet.delete(pageNumber);
			} else {
				newSet.add(pageNumber);
			}
			return newSet;
		});
	};

	const selectAll = () => {
		setSelectedPages(new Set(pages.map((p) => p.pageNumber)));
	};

	const deselectAll = () => {
		setSelectedPages(new Set());
	};

	const selectRange = () => {
		const start = parseInt(pageRangeStart, 10);
		const end = parseInt(pageRangeEnd, 10);

		if (isNaN(start) || isNaN(end)) return;

		const newSet = new Set(selectedPages);
		for (let i = Math.max(1, start); i <= Math.min(pages.length, end); i++) {
			newSet.add(i);
		}
		setSelectedPages(newSet);
	};

	const handleConvert = async () => {
		if (selectedPages.size === 0) return;

		try {
			setConverting(true);

			// Get file content from storage and convert to text in main thread
			const fileContent = await documentStorageService.getFileContent(file.id);
			const pageNumbers = Array.from(selectedPages).sort((a, b) => a - b);

			logInfo(
				`Converting PDF in main thread: ${file.name} with ${pageNumbers.length} pages`,
			);

			// Convert Uint8Array to ArrayBuffer for PDF processing
			const arrayBuffer =
				fileContent.buffer instanceof ArrayBuffer
					? fileContent.buffer.slice(
							fileContent.byteOffset,
							fileContent.byteOffset + fileContent.byteLength,
						)
					: fileContent.buffer;

			// Extract PDF pages in main thread
			const pdfContent = await readPDFFile(arrayBuffer as ArrayBuffer);

			// Filter selected pages
			const selectedPageData = pdfContent.pages.filter((p) =>
				pageNumbers.includes(p.pageNumber),
			);

			if (selectedPageData.length === 0) {
				throw new Error("No pages selected for conversion");
			}

			// Combine all selected pages into one content block
			const combinedContent = selectedPageData
				.map((page) => {
					return `Page ${page.pageNumber}\n${page.text}`;
				})
				.join("\n\n---\n\n");

			// Create title from file name and page range
			const pageRangeText =
				pageNumbers.length === pdfContent.pages.length
					? "All Pages"
					: pageNumbers.length === 1
						? `Page ${pageNumbers[0]}`
						: `Pages ${Math.min(...pageNumbers)}-${Math.max(...pageNumbers)}`;

			const title = `${file.name.replace(".pdf", "")} - ${pageRangeText}`;

			logInfo(`PDF converted to text in main thread, saving to offscreen...`);

			// Send text content to offscreen to save
			const { jobId, promise } = await backgroundJob.execute(
				"remember-save",
				{
					sourceType: "file_upload" as const,
					sourceUrl: `document://${file.id}`,
					title,
					rawContent: combinedContent,
					cleanContent: combinedContent,
					textContent: combinedContent,
					sourceMetadata: {
						inputMethod: "direct" as const,
						timestamp: new Date().toISOString(),
						context: `PDF document: ${file.name} (${selectedPageData.length} pages)`,
					},
					extractionMetadata: {
						method: "pdf-extraction",
						fileName: file.name,
						pageCount: selectedPageData.length,
						selectedPages: pageNumbers,
						timestamp: new Date().toISOString(),
					},
				},
				{ stream: false },
			);

			logInfo(`Remember save job created: ${jobId}`);

			// Wait for completion
			const result = await promise;

			logInfo(`PDF save completed:`, result);

			// Call simplified callback
			if (onConvert) {
				onConvert();
			}

			onOpenChange(false);
			setSelectedPages(new Set());
		} catch (error) {
			logError("Failed to convert pages:", error);
			alert("Failed to convert PDF pages. Please try again.");
		} finally {
			setConverting(false);
		}
	};

	const truncateText = (text: string, maxLength: number) => {
		if (text.length <= maxLength) return text;
		return text.substring(0, maxLength) + "...";
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
				<DialogHeader className="flex-shrink-0">
					<DialogTitle>Convert PDF Pages to Remembered Content</DialogTitle>
					<DialogDescription>
						Select the pages you want to convert and save to your remembered
						content library
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						<span className="ml-3 text-muted-foreground">Loading pages...</span>
					</div>
				) : (
					<div className="flex flex-col gap-4 flex-1 min-h-0">
						{/* Page Selection Controls */}
						<div className="space-y-3 border-b pb-4 flex-shrink-0">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={selectAll}
										disabled={pages.length === 0}
									>
										Select All
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={deselectAll}
										disabled={selectedPages.size === 0}
									>
										Deselect All
									</Button>
								</div>
								<Badge variant="secondary">
									{selectedPages.size} of {pages.length} pages selected
								</Badge>
							</div>

							{/* Range Selection */}
							<div className="flex items-end gap-2">
								<div className="flex-1">
									<Label htmlFor="range-start" className="text-xs">
										From Page
									</Label>
									<Input
										id="range-start"
										type="number"
										min="1"
										max={pages.length}
										placeholder="1"
										value={pageRangeStart}
										onChange={(e) => setPageRangeStart(e.target.value)}
										className="h-8"
									/>
								</div>
								<div className="flex-1">
									<Label htmlFor="range-end" className="text-xs">
										To Page
									</Label>
									<Input
										id="range-end"
										type="number"
										min="1"
										max={pages.length}
										placeholder={pages.length.toString()}
										value={pageRangeEnd}
										onChange={(e) => setPageRangeEnd(e.target.value)}
										className="h-8"
									/>
								</div>
								<Button
									variant="secondary"
									size="sm"
									onClick={selectRange}
									disabled={!pageRangeStart || !pageRangeEnd}
									className="h-8"
								>
									Add Range
								</Button>
							</div>
						</div>

						{/* Page List */}
						<ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
							<div className="space-y-2 pr-4">
								{pages.map((page) => {
									const isSelected = selectedPages.has(page.pageNumber);
									return (
										<div
											key={page.pageNumber}
											onClick={() => togglePage(page.pageNumber)}
											className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
												isSelected
													? "bg-accent border-primary"
													: "hover:bg-muted/50"
											}`}
										>
											<div className="flex items-center justify-center h-5 w-5 mt-0.5">
												{isSelected ? (
													<div className="flex items-center justify-center h-5 w-5 rounded bg-primary text-primary-foreground">
														<Check className="h-3 w-3" />
													</div>
												) : (
													<div className="h-4 w-4 rounded border-2" />
												)}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2 mb-1">
													<BookOpen className="h-4 w-4 text-muted-foreground" />
													<span className="font-medium text-sm">
														Page {page.pageNumber}
													</span>
													<span className="text-xs text-muted-foreground">
														{page.width.toFixed(0)} × {page.height.toFixed(0)}
													</span>
												</div>
												<p className="text-xs text-muted-foreground leading-relaxed">
													{truncateText(page.text, 150)}
												</p>
											</div>
										</div>
									);
								})}
							</div>
						</ScrollArea>
					</div>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={converting}
					>
						Cancel
					</Button>
					<Button
						onClick={handleConvert}
						disabled={selectedPages.size === 0 || converting}
					>
						{converting ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								Converting...
							</>
						) : (
							`Convert ${selectedPages.size} ${selectedPages.size === 1 ? "Page" : "Pages"}`
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
