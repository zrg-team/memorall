/**
 * Excel Viewer Component using Univer
 * Renders Excel files with full spreadsheet functionality
 */

import { LocaleType, mergeLocales, Univer } from "@univerjs/core";
import { FUniver } from "@univerjs/core/facade";
import DesignEnUS from "@univerjs/design/locale/en-US";
import { UniverDocsPlugin } from "@univerjs/docs";
import { UniverDocsUIPlugin } from "@univerjs/docs-ui";
import DocsUIEnUS from "@univerjs/docs-ui/locale/en-US";
import { UniverRenderEnginePlugin } from "@univerjs/engine-render";
import { UniverSheetsPlugin } from "@univerjs/sheets";
import SheetsEnUS from "@univerjs/sheets/locale/en-US";
import SheetsFormulaUIEnUS from "@univerjs/sheets-formula-ui/locale/en-US";
import { UniverSheetsNumfmtPlugin } from "@univerjs/sheets-numfmt";
import { UniverSheetsNumfmtUIPlugin } from "@univerjs/sheets-numfmt-ui";
import SheetsNumfmtUIEnUS from "@univerjs/sheets-numfmt-ui/locale/en-US";
import { UniverSheetsUIPlugin } from "@univerjs/sheets-ui";
import SheetsUIEnUS from "@univerjs/sheets-ui/locale/en-US";
import { UniverUIPlugin } from "@univerjs/ui";
import UIEnUS from "@univerjs/ui/locale/en-US";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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

import { parseExcelFile } from "@/main/modules/files/handlers/excel-extraction";
import { logError, logInfo } from "@/utils/logger";
import { convertXLSXToUniver } from "./excel-to-univer";

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
		let cancelled = false;
		let pendingUniver: Univer | null = null;

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
				if (cancelled) return;
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
					locales: {
						[LocaleType.EN_US]: mergeLocales(
							DesignEnUS,
							UIEnUS,
							DocsUIEnUS,
							SheetsEnUS,
							SheetsUIEnUS,
							SheetsFormulaUIEnUS,
							SheetsNumfmtUIEnUS,
						),
					},
				});
				pendingUniver = univer;
				if (cancelled) {
					univer.dispose();
					pendingUniver = null;
					return;
				}
				logInfo("Univer instance created, registering plugins...");

				univer.registerPlugin(UniverRenderEnginePlugin);
				univer.registerPlugin(UniverUIPlugin, {
					container: containerRef.current,
					header: true,
					toolbar: false,
					footer: true,
					contextMenu: false,
					headerMenu: false,
				});
				univer.registerPlugin(UniverDocsPlugin);
				univer.registerPlugin(UniverDocsUIPlugin);
				univer.registerPlugin(UniverSheetsPlugin, {
					notExecuteFormula: true,
				});
				univer.registerPlugin(UniverSheetsUIPlugin, {
					disableEdit: true,
					formulaBar: false,
					footer: {
						sheetBar: true,
						statisticBar: true,
						menus: false,
						zoomSlider: true,
						addSheetButtonConfig: { show: false },
					},
				});
				univer.registerPlugin(UniverSheetsNumfmtPlugin);
				univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
				logInfo("Plugins registered, creating workbook...");

				const univerAPI = FUniver.newAPI(univer);
				const facadeWorkbook = univerAPI.createWorkbook(univerWorkbookData);
				await facadeWorkbook.getWorkbookPermission().setReadOnly();
				if (cancelled) {
					univer.dispose();
					pendingUniver = null;
					return;
				}
				logInfo("Workbook created successfully");

				univerRef.current = univer;
				pendingUniver = null;
				logInfo(`Excel file loaded successfully: ${fileName}`);
			} catch (err) {
				pendingUniver?.dispose();
				pendingUniver = null;
				if (cancelled) return;
				logError("Failed to initialize Excel viewer:", err);
				setError(t("excelViewer.loadError"));
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		void initializeUniver();

		return () => {
			cancelled = true;
			pendingUniver?.dispose();
			pendingUniver = null;
			if (univerRef.current) {
				univerRef.current.dispose();
				univerRef.current = null;
			}
		};
	}, [fileData, fileName, t]);

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
