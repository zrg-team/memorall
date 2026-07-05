/**
 * PDF Page Selector Dialog
 * Allows users to select specific pages from a PDF to Convert to Knowledgeed content
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, BookOpen, Check } from "lucide-react";

import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { ScrollArea } from "@/main/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Badge } from "@/main/components/ui/badge";
import type { DocumentFile } from "@/types/document-library";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import {
	readPDFFile,
	type PDFPageContent,
} from "@/main/modules/files/handlers/pdf-extraction";
import { topicService } from "@/main/modules/topics/services/topic-service";
import type { KnowledgeGrowMode } from "@/main/modules/knowledge/services/knowledge-graph-service";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { Topic } from "@/services/database/types";
import type { GrowType } from "@/services/database/entities/topic-types";
import { logError, logInfo } from "@/utils/logger";

interface PDFPageSelectorProps {
	file: DocumentFile;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConvert?: () => void; // Simplified callback - no need to pass data anymore
}

const DEFAULT_TOPIC_VALUE = "__default__";

const GROW_LABELS: Record<GrowType, string> = {
	"knowledge-graph": "Semantic Graph",
	structmem: "StructMem",
};

const growTypeToMode = (growType: GrowType): KnowledgeGrowMode =>
	growType === "structmem" ? "structmem" : "knowledge";

const modeToGrowType = (mode: KnowledgeGrowMode): GrowType =>
	mode === "structmem" ? "structmem" : "knowledge-graph";

export const PDFPageSelector: React.FC<PDFPageSelectorProps> = ({
	file,
	open,
	onOpenChange,
	onConvert,
}) => {
	const { t } = useTranslation("documents");
	const [loading, setLoading] = useState(false);
	const [pages, setPages] = useState<PDFPageContent[]>([]);
	const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
	const [converting, setConverting] = useState(false);
	const [pageRangeStart, setPageRangeStart] = useState("");
	const [pageRangeEnd, setPageRangeEnd] = useState("");
	const [topicsLoading, setTopicsLoading] = useState(false);
	const [topics, setTopics] = useState<Topic[]>([]);
	const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(
		undefined,
	);
	const [growMode, setGrowMode] = useState<KnowledgeGrowMode>("knowledge");

	useEffect(() => {
		if (open && file.type === "pdf") {
			loadPDFPages();
			loadTopics();
		}
	}, [open, file.id]);

	const loadPDFPages = async () => {
		try {
			setLoading(true);
			const content = await documentFileSystemService.readFile(
				toDocumentsSandboxPath(file.id),
			);
			const pdfContent = await readPDFFile(content.slice().buffer);
			setPages(pdfContent.pages);
		} catch (error) {
			logError("Failed to load PDF pages:", error);
		} finally {
			setLoading(false);
		}
	};

	const loadTopics = async () => {
		try {
			setTopicsLoading(true);
			const allTopics = await topicService.getTopics();
			setTopics(Array.isArray(allTopics) ? allTopics : []);
		} catch (error) {
			logError("Failed to load memories:", error);
			setTopics([]);
		} finally {
			setTopicsLoading(false);
		}
	};

	const handleTopicChange = (value: string) => {
		if (value === DEFAULT_TOPIC_VALUE) {
			setSelectedTopicId(undefined);
			return;
		}

		const topic = topics.find((item) => item.id === value);
		setSelectedTopicId(value);
		if (topic) {
			setGrowMode(growTypeToMode(topic.growType));
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
			const fileContent = await documentFileSystemService.readFile(file.id);
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
				throw new Error(t("pdfSelector.noPagesSelected"));
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
					? t("pdfSelector.allPages")
					: pageNumbers.length === 1
						? t("pdfSelector.page", { number: pageNumbers[0] })
						: t("pdfSelector.pagesRange", {
								start: Math.min(...pageNumbers),
								end: Math.max(...pageNumbers),
							});

			const title = `${file.name.replace(".pdf", "")} - ${pageRangeText}`;

			logInfo(
				`PDF converted to text in main thread, sending to knowledge graph...`,
			);

			if (selectedTopicId) {
				await topicService.addFileToTopic(selectedTopicId, file.path);
			}

			// Send text content directly to knowledge graph handler
			const { jobId, promise } = await backgroundJob.execute(
				"knowledge-graph",
				{
					filePath: file.path,
					content: combinedContent,
					topicId: selectedTopicId,
					growMode,
				},
				{ stream: false },
			);

			logInfo(`Knowledge graph job created: ${jobId}`);

			// Wait for completion
			const result = await promise;

			logInfo(`Knowledge graph generation completed:`, result);

			// Call simplified callback
			if (onConvert) {
				onConvert();
			}

			onOpenChange(false);
			setSelectedPages(new Set());
			setSelectedTopicId(undefined);
			setGrowMode("knowledge");
		} catch (error) {
			logError("Failed to convert pages:", error);
			alert(t("pdfSelector.convertError"));
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
					<DialogTitle>{t("pdfSelector.title")}</DialogTitle>
					<DialogDescription>{t("pdfSelector.description")}</DialogDescription>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						<span className="ml-3 text-muted-foreground">
							{t("pdfSelector.loadingPages")}
						</span>
					</div>
				) : (
					<div className="flex flex-col gap-4 flex-1 min-h-0">
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-b pb-4 flex-shrink-0">
							<div className="space-y-1.5">
								<Label htmlFor="pdf-memory-select" className="text-xs">
									{t("pdfSelector.memory")}
								</Label>
								<Select
									value={selectedTopicId ?? DEFAULT_TOPIC_VALUE}
									onValueChange={handleTopicChange}
									disabled={topicsLoading || converting}
								>
									<SelectTrigger id="pdf-memory-select" className="h-9">
										<SelectValue placeholder={t("pdfSelector.selectMemory")} />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={DEFAULT_TOPIC_VALUE}>
											{t("pdfSelector.defaultMemory")}
										</SelectItem>
										{topics.map((topic) => (
											<SelectItem key={topic.id} value={topic.id}>
												{topic.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="space-y-1.5">
								<Label htmlFor="pdf-grow-type-select" className="text-xs">
									{t("pdfSelector.growType")}
								</Label>
								<Select
									value={modeToGrowType(growMode)}
									onValueChange={(value) =>
										setGrowMode(growTypeToMode(value as GrowType))
									}
									disabled={converting}
								>
									<SelectTrigger id="pdf-grow-type-select" className="h-9">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="knowledge-graph">
											{GROW_LABELS["knowledge-graph"]}
										</SelectItem>
										<SelectItem value="structmem">
											{GROW_LABELS.structmem}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

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
										{t("pdfSelector.selectAll")}
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={deselectAll}
										disabled={selectedPages.size === 0}
									>
										{t("pdfSelector.deselectAll")}
									</Button>
								</div>
								<Badge variant="secondary">
									{t("pdfSelector.pagesSelected", {
										count: selectedPages.size,
										total: pages.length,
									})}
								</Badge>
							</div>

							{/* Range Selection */}
							<div className="flex items-end gap-2">
								<div className="flex-1">
									<Label htmlFor="range-start" className="text-xs">
										{t("pdfSelector.fromPage")}
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
										{t("pdfSelector.toPage")}
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
									{t("pdfSelector.addRange")}
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
														{t("pdfSelector.page", { number: page.pageNumber })}
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
						{t("pdfSelector.cancel")}
					</Button>
					<Button
						onClick={handleConvert}
						disabled={selectedPages.size === 0 || converting}
					>
						{converting ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								{t("pdfSelector.converting")}
							</>
						) : (
							t("pdfSelector.convert", { count: selectedPages.size })
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
