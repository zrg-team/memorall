/**
 * Excel Sheet Selector Dialog
 * Allows users to select specific sheets from an Excel file to Convert to Knowledgeed content
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import { Loader2, Sheet, Check } from "lucide-react";

import { Button } from "@/main/components/ui/button";
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
	parseExcelFile,
	sheetToMarkdown,
} from "@/main/modules/documents/handlers/excel-extraction";
import { topicService } from "@/main/modules/topics/services/topic-service";
import type { KnowledgeGrowMode } from "@/main/modules/knowledge/services/knowledge-graph-service";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type { Topic } from "@/services/database/types";
import type { GrowType } from "@/services/database/entities/topic-types";
import { logError, logInfo } from "@/utils/logger";

interface ExcelSheetSelectorProps {
	file: DocumentFile;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConvert?: () => void;
}

const DEFAULT_TOPIC_VALUE = "__default__";

const GROW_LABELS: Record<GrowType, string> = {
	"knowledge-graph": "Knowledge Graph",
	structmem: "StructMem",
};

const growTypeToMode = (growType: GrowType): KnowledgeGrowMode =>
	growType === "structmem" ? "structmem" : "knowledge";

const modeToGrowType = (mode: KnowledgeGrowMode): GrowType =>
	mode === "structmem" ? "structmem" : "knowledge-graph";

export const ExcelSheetSelector: React.FC<ExcelSheetSelectorProps> = ({
	file,
	open,
	onOpenChange,
	onConvert,
}) => {
	const { t } = useTranslation("documents");
	const [loading, setLoading] = useState(false);
	const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
	const [sheetNames, setSheetNames] = useState<string[]>([]);
	const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
	const [converting, setConverting] = useState(false);
	const [topicsLoading, setTopicsLoading] = useState(false);
	const [topics, setTopics] = useState<Topic[]>([]);
	const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(
		undefined,
	);
	const [growMode, setGrowMode] = useState<KnowledgeGrowMode>("knowledge");

	useEffect(() => {
		if (open && file.type === "excel") {
			loadExcelSheets();
			loadTopics();
		}
	}, [open, file.id]);

	const loadExcelSheets = async () => {
		try {
			setLoading(true);
			const content = await documentFileSystemService.readFile(
				toDocumentsSandboxPath(file.id),
			);

			// Parse Excel file
			const wb = await parseExcelFile(content);
			setWorkbook(wb);
			setSheetNames(wb.SheetNames);
		} catch (error) {
			logError("Failed to load Excel sheets:", error);
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

	const toggleSheet = (sheetName: string) => {
		setSelectedSheets((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(sheetName)) {
				newSet.delete(sheetName);
			} else {
				newSet.add(sheetName);
			}
			return newSet;
		});
	};

	const selectAll = () => {
		setSelectedSheets(new Set(sheetNames));
	};

	const deselectAll = () => {
		setSelectedSheets(new Set());
	};

	const handleConvert = async () => {
		if (selectedSheets.size === 0 || !workbook) return;

		try {
			setConverting(true);

			const selectedSheetNames = Array.from(selectedSheets);

			logInfo(
				`Converting Excel in main thread: ${file.name} with ${selectedSheetNames.length} sheets`,
			);

			// Convert selected sheets to markdown tables
			const markdownSections = selectedSheetNames.map((sheetName) => {
				const markdown = sheetToMarkdown(workbook, sheetName);
				return `## ${sheetName}\n\n${markdown}`;
			});

			const combinedMarkdown = markdownSections.join("\n\n");

			// Create title from file name and sheet info
			const sheetText =
				selectedSheetNames.length === sheetNames.length
					? t("excelSelector.allSheets")
					: selectedSheetNames.length === 1
						? selectedSheetNames[0]
						: t("excelSelector.sheetCount", {
								count: selectedSheetNames.length,
							});

			const title = `${file.name.replace(/\.(xls|xlsx|xlsm)$/i, "")} - ${sheetText}`;

			logInfo(
				`Excel converted to markdown in main thread, sending to knowledge graph...`,
			);

			if (selectedTopicId) {
				await topicService.addFileToTopic(selectedTopicId, file.path);
			}

			// Send markdown content directly to knowledge graph handler
			const { jobId, promise } = await backgroundJob.execute(
				"knowledge-graph",
				{
					filePath: file.path,
					content: combinedMarkdown,
					topicId: selectedTopicId,
					growMode,
				},
				{ stream: false },
			);

			logInfo(`Knowledge graph job created: ${jobId}`);

			// Wait for completion
			const result = await promise;

			logInfo(`Knowledge graph generation completed:`, result);

			// Call callback
			if (onConvert) {
				onConvert();
			}

			onOpenChange(false);
			setSelectedSheets(new Set());
			setSelectedTopicId(undefined);
			setGrowMode("knowledge");
		} catch (error) {
			logError("Failed to convert sheets:", error);
			alert(t("excelSelector.convertError"));
		} finally {
			setConverting(false);
		}
	};

	const getSheetPreview = (sheetName: string): string => {
		if (!workbook) return "";

		const worksheet = workbook.Sheets[sheetName];
		if (!worksheet) return "";

		try {
			// Get the range of the worksheet
			const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
			const rowCount = range.e.r - range.s.r + 1;
			const colCount = range.e.c - range.s.c + 1;

			// Get first few cells for preview
			const previewCells: string[] = [];
			for (let R = range.s.r; R <= Math.min(range.s.r + 2, range.e.r); ++R) {
				for (let C = range.s.c; C <= Math.min(range.s.c + 3, range.e.c); ++C) {
					const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
					const cell = worksheet[cellAddress];
					if (cell && cell.v) {
						previewCells.push(String(cell.v));
					}
				}
			}

			return `${rowCount} rows × ${colCount} columns | ${previewCells.slice(0, 4).join(", ")}${previewCells.length > 4 ? "..." : ""}`;
		} catch {
			return t("excelSelector.previewUnavailable");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
				<DialogHeader className="flex-shrink-0">
					<DialogTitle>{t("excelSelector.title")}</DialogTitle>
					<DialogDescription>
						{t("excelSelector.description")}
					</DialogDescription>
				</DialogHeader>

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
						<span className="ml-3 text-muted-foreground">
							{t("excelSelector.loadingSheets")}
						</span>
					</div>
				) : (
					<div className="flex flex-col gap-4 flex-1 min-h-0">
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-b pb-4 flex-shrink-0">
							<div className="space-y-1.5">
								<Label htmlFor="excel-memory-select" className="text-xs">
									{t("excelSelector.memory")}
								</Label>
								<Select
									value={selectedTopicId ?? DEFAULT_TOPIC_VALUE}
									onValueChange={handleTopicChange}
									disabled={topicsLoading || converting}
								>
									<SelectTrigger id="excel-memory-select" className="h-9">
										<SelectValue
											placeholder={t("excelSelector.selectMemory")}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={DEFAULT_TOPIC_VALUE}>
											{t("excelSelector.defaultMemory")}
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
								<Label htmlFor="excel-grow-type-select" className="text-xs">
									{t("excelSelector.growType")}
								</Label>
								<Select
									value={modeToGrowType(growMode)}
									onValueChange={(value) =>
										setGrowMode(growTypeToMode(value as GrowType))
									}
									disabled={converting}
								>
									<SelectTrigger id="excel-grow-type-select" className="h-9">
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

						{/* Sheet Selection Controls */}
						<div className="space-y-3 border-b pb-4 flex-shrink-0">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={selectAll}
										disabled={sheetNames.length === 0}
									>
										{t("excelSelector.selectAll")}
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={deselectAll}
										disabled={selectedSheets.size === 0}
									>
										{t("excelSelector.deselectAll")}
									</Button>
								</div>
								<Badge variant="secondary">
									{t("excelSelector.sheetsSelected", {
										count: selectedSheets.size,
										total: sheetNames.length,
									})}
								</Badge>
							</div>
						</div>

						{/* Sheet List */}
						<ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
							<div className="space-y-2 pr-4">
								{sheetNames.map((sheetName) => {
									const isSelected = selectedSheets.has(sheetName);
									return (
										<div
											key={sheetName}
											onClick={() => toggleSheet(sheetName)}
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
													<Sheet className="h-4 w-4 text-muted-foreground" />
													<span className="font-medium text-sm">
														{sheetName}
													</span>
												</div>
												<p className="text-xs text-muted-foreground leading-relaxed">
													{getSheetPreview(sheetName)}
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
						{t("excelSelector.cancel")}
					</Button>
					<Button
						onClick={handleConvert}
						disabled={selectedSheets.size === 0 || converting}
					>
						{converting ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								{t("excelSelector.converting")}
							</>
						) : (
							t("excelSelector.convert", { count: selectedSheets.size })
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
