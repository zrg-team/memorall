/**
 * Excel Viewer Component using Univer
 * Renders Excel files with full spreadsheet functionality
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	LocaleType,
	mergeLocales,
	Univer,
	UniverInstanceType,
} from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import DesignEnUS from "@univerjs/design/locale/en-US";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import DocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import { UniverFormulaEnginePlugin } from "@univerjs/engine-formula";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import { UniverSheetsFormulaPlugin } from "@univerjs/sheets-formula";
import { UniverSheetsFormulaUIPlugin } from "@univerjs/sheets-formula-ui";
import SheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsNumfmtUIPlugin } from "@univerjs/sheets-numfmt-ui";
import SheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
import SheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import { UniverUIPlugin } from "@univerjs/ui";
import UIEnUS from "@univerjs/ui/locale/en-US";

// Import CSS styles
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";
import "@univerjs/docs-ui/lib/index.css";
import "@univerjs/sheets-ui/lib/index.css";
import "@univerjs/sheets-formula-ui/lib/index.css";
import "@univerjs/sheets-numfmt-ui/lib/index.css";

// Import facade packages
import "@univerjs/engine-formula/facade";
import "@univerjs/ui/facade";
import "@univerjs/docs-ui/facade";
import "@univerjs/sheets/facade";
import "@univerjs/sheets-ui/facade";
import "@univerjs/sheets-formula/facade";
import "@univerjs/sheets-numfmt/facade";

import * as XLSX from "xlsx";
import { parseExcelFile } from "@/main/modules/documents/handlers/excel-extraction";
import { logError, logInfo } from "@/utils/logger";

export interface ExcelViewerProps {
	fileData: Uint8Array;
	fileName: string;
	className?: string;
}

export const ExcelViewer: React.FC<ExcelViewerProps> = ({
	fileData,
	fileName,
	className = "",
}) => {
	const { t } = useTranslation("documents");
	const containerRef = useRef<HTMLDivElement>(null);
	const univerRef = useRef<Univer | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!fileData) {
			logError("File data is missing");
			setError(t("excelViewer.noData"));
			setLoading(false);
			return;
		}

		const initializeUniver = async () => {
			if (!containerRef.current) {
				logError("Container ref not available");
				setError(t("excelViewer.containerNotReady"));
				setLoading(false);
				return;
			}

			logInfo("Container ready, initializing Univer...");

			try {
				setLoading(true);
				setError(null);

				logInfo("Starting Excel file parsing...");
				// Parse Excel file using existing utility
				const workbook = await parseExcelFile(fileData);
				logInfo(
					"Excel file parsed successfully, sheet count:",
					workbook.SheetNames.length,
				);

				// Convert XLSX workbook to Univer format
				logInfo("Converting to Univer format...");
				const univerWorkbookData = convertXLSXToUniver(workbook, fileName);
				logInfo("Conversion completed, creating Univer instance...");

				// Create Univer instance
				const univer = new Univer({
					locale: LocaleType.EN_US,
					locales: mergeLocales(
						DesignEnUS,
						UIEnUS,
						DocsUIEnUS,
						SheetsUIEnUS,
						SheetsFormulaUIEnUS,
						SheetsNumfmtUIEnUS,
						SheetsEnUS,
					),
				});
				logInfo("Univer instance created, registering plugins...");

				// Register plugins
				univer.registerPlugin(UniverRenderEnginePlugin);
				// Skip formula engine for read-only mode
				// univer.registerPlugin(UniverFormulaEnginePlugin);
				univer.registerPlugin(UniverUIPlugin, {
					container: containerRef.current,
					header: true, // Keep header for sheet tabs and navigation
					toolbar: false, // Disable editing toolbar
					footer: true, // Keep footer for sheet navigation
				});
				univer.registerPlugin(UniverDocsPlugin);
				univer.registerPlugin(UniverDocsUIPlugin);
				univer.registerPlugin(UniverSheetsPlugin);
				univer.registerPlugin(UniverSheetsUIPlugin);
				// Skip formula plugins for read-only mode
				// univer.registerPlugin(UniverSheetsFormulaPlugin);
				// univer.registerPlugin(UniverSheetsFormulaUIPlugin);
				univer.registerPlugin(UniverSheetsNumfmtPlugin);
				univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
				logInfo("Plugins registered, creating workbook...");

				// Create workbook
				univer.createUnit(UniverInstanceType.UNIVER_SHEET, univerWorkbookData);
				logInfo("Workbook created successfully");

				// Make workbook read-only by preventing editing interactions
				setTimeout(() => {
					const container = containerRef.current;
					if (container) {
						// Disable context menus and editing keyboard shortcuts
						container.addEventListener("contextmenu", (e) =>
							e.preventDefault(),
						);
						container.addEventListener("keydown", (e) => {
							// Allow navigation keys but prevent editing keys
							const allowedKeys = [
								"ArrowUp",
								"ArrowDown",
								"ArrowLeft",
								"ArrowRight",
								"PageUp",
								"PageDown",
								"Home",
								"End",
								"Tab",
							];
							if (!allowedKeys.includes(e.key) && !e.ctrlKey) {
								e.preventDefault();
								e.stopPropagation();
							}
						});

						// Prevent double-click editing
						container.addEventListener("dblclick", (e) => {
							e.preventDefault();
							e.stopPropagation();
						});

						// Prevent input events
						container.addEventListener("input", (e) => {
							e.preventDefault();
							e.stopPropagation();
						});
					}
				}, 100);

				univerRef.current = univer;
				logInfo(`Excel file loaded successfully: ${fileName}`);
			} catch (err) {
				logError("Failed to initialize Excel viewer:", err);
				setError(t("excelViewer.loadError"));
			} finally {
				setLoading(false);
			}
		};

		// Small delay to ensure DOM is rendered
		setTimeout(initializeUniver, 0);

		// Cleanup
		return () => {
			if (univerRef.current) {
				univerRef.current.dispose();
				univerRef.current = null;
			}
		};
	}, [fileData, fileName, t]);

	const convertXLSXToUniver = (workbook: XLSX.WorkBook, fileName: string) => {
		const sheets: any = {};

		workbook.SheetNames.forEach((sheetName, index) => {
			const worksheet = workbook.Sheets[sheetName];
			const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");

			// Convert worksheet data to Univer format
			const cellData: any = {};

			for (let R = range.s.r; R <= range.e.r; ++R) {
				for (let C = range.s.c; C <= range.e.c; ++C) {
					const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
					const cell = worksheet[cellAddress];

					if (cell) {
						if (!cellData[R]) cellData[R] = {};
						cellData[R][C] = {
							v: cell.v,
							t: cell.t === "n" ? 2 : 1, // 2 for number, 1 for string
							s: {
								// Lock all cells for read-only mode
								locked: true,
							},
						};
					}
				}
			}

			sheets[`sheet-${index}`] = {
				id: `sheet-${index}`,
				name: sheetName,
				tabColor: "",
				hidden: 0,
				rowCount: Math.max(range.e.r + 1, 100),
				columnCount: Math.max(range.e.c + 1, 20),
				zoomRatio: 1,
				scrollTop: 0,
				scrollLeft: 0,
				defaultColumnWidth: 73,
				defaultRowHeight: 19,
				mergeData: [],
				cellData,
				rowData: {},
				columnData: {},
				showGridlines: 1,
				rowHeader: {
					width: 46,
					hidden: 0,
				},
				columnHeader: {
					height: 20,
					hidden: 0,
				},
				selections: ["A1"],
				rightToLeft: 0,
				// Add protection to make sheet read-only
				protection: {
					sheet: true,
					password: "",
					allowSelectLockedCells: true,
					allowSelectUnlockedCells: true,
					allowFormatCells: false,
					allowFormatColumns: false,
					allowFormatRows: false,
					allowInsertColumns: false,
					allowInsertRows: false,
					allowInsertHyperlinks: false,
					allowDeleteColumns: false,
					allowDeleteRows: false,
					allowSort: false,
					allowAutoFilter: false,
					allowPivotTables: false,
					allowEditObjects: false,
					allowEditScenarios: false,
				},
			};
		});

		return {
			id: "workbook-01",
			name: fileName,
			sheetOrder: Object.keys(sheets),
			appVersion: "3.0.0-alpha",
			sheets,
			locale: LocaleType.EN_US,
			styles: {},
			resources: [],
		};
	};

	return (
		<div className={`w-full h-full relative ${className}`}>
			<div ref={containerRef} className="w-full h-full" />

			{loading && (
				<div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90">
					<div className="text-sm text-muted-foreground">
						{t("excelViewer.loading")}
					</div>
				</div>
			)}

			{error && (
				<div className="absolute inset-0 flex flex-col items-center justify-center bg-white p-4">
					<div className="text-sm text-destructive mb-4">{error}</div>
					<div className="text-xs text-muted-foreground text-center">
						{t("excelViewer.error")}
						<br />
						{t("excelViewer.errorDescription")}
					</div>
				</div>
			)}
		</div>
	);
};
