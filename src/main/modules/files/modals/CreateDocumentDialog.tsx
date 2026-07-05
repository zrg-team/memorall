import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { FileText } from "lucide-react";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { cn } from "@/lib/utils";

const PRESET_EXTENSIONS = ["md", "txt", "json", "yaml", "csv", "html"];

export interface CreateDocumentDialogResult {
	name: string;
	extension: string;
}

export const CreateDocumentDialog = NiceModal.create<object>(() => {
	const modal = useModal();
	const { t } = useTranslation("documents");
	const customInputRef = useRef<HTMLInputElement>(null);

	const [documentName, setDocumentName] = useState("");
	const [selectedExt, setSelectedExt] = useState("md");
	const [customExt, setCustomExt] = useState("");
	const [isCustom, setIsCustom] = useState(false);
	const [error, setError] = useState("");

	const activeExt = isCustom
		? customExt.trim().replace(/^\.+/, "")
		: selectedExt;

	const handleCreate = () => {
		if (!documentName.trim()) {
			setError(t("create.nameRequired"));
			return;
		}

		const invalidChars = /[<>:"/\\|?*]/;
		if (invalidChars.test(documentName)) {
			setError(t("create.invalidCharacters"));
			return;
		}

		if (!activeExt) {
			setError(t("create.extensionRequired"));
			return;
		}

		modal.resolve({
			name: documentName.trim(),
			extension: `.${activeExt}`,
		} satisfies CreateDocumentDialogResult);
		modal.hide();
	};

	const handleCancel = () => {
		modal.resolve(null);
		modal.hide();
	};

	const handleSelectCustom = () => {
		setIsCustom(true);
		setError("");
		setTimeout(() => customInputRef.current?.focus(), 0);
	};

	return (
		<Dialog
			open={modal.visible}
			onOpenChange={(open) => !open && handleCancel()}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<FileText className="h-5 w-5 text-primary" />
						{t("create.title")}
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-5 py-1">
					{/* Name */}
					<div className="space-y-1.5">
						<Label htmlFor="document-name">{t("create.nameLabel")}</Label>
						<Input
							id="document-name"
							placeholder={t("create.namePlaceholder")}
							value={documentName}
							onChange={(e) => {
								setDocumentName(e.target.value);
								setError("");
							}}
							onKeyDown={(e) => e.key === "Enter" && handleCreate()}
							autoFocus
						/>
						{error && <p className="text-sm text-destructive">{error}</p>}
					</div>

					{/* Extension */}
					<div className="space-y-2">
						<Label>{t("create.extensionLabel")}</Label>
						<div className="flex flex-wrap gap-1.5">
							{PRESET_EXTENSIONS.map((ext) => (
								<button
									key={ext}
									type="button"
									onClick={() => {
										setSelectedExt(ext);
										setIsCustom(false);
										setError("");
									}}
									className={cn(
										"px-2.5 py-1 rounded-md text-xs font-mono border transition-colors",
										!isCustom && selectedExt === ext
											? "bg-primary text-primary-foreground border-primary"
											: "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
									)}
								>
									.{ext}
								</button>
							))}
							<button
								type="button"
								onClick={handleSelectCustom}
								className={cn(
									"px-2.5 py-1 rounded-md text-xs border transition-colors",
									isCustom
										? "bg-primary text-primary-foreground border-primary"
										: "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground",
								)}
							>
								{t("create.customExtension", { defaultValue: "other…" })}
							</button>
						</div>

						{isCustom && (
							<div className="relative">
								<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground select-none">
									.
								</span>
								<Input
									ref={customInputRef}
									className="pl-6 font-mono"
									placeholder="ext"
									value={customExt}
									onChange={(e) => {
										setCustomExt(e.target.value.replace(/^\.+/, ""));
										setError("");
									}}
									onKeyDown={(e) => e.key === "Enter" && handleCreate()}
								/>
							</div>
						)}
					</div>

					{/* Preview */}
					<div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
						<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="truncate font-mono text-sm text-foreground">
							{documentName.trim() || t("create.unnamed")}
							{activeExt ? `.${activeExt}` : ""}
						</span>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleCancel}>
						{t("create.cancel")}
					</Button>
					<Button onClick={handleCreate}>{t("create.create")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
});
