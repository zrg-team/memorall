/**
 * "Open from Memorall…" in a hosted app: the user's files, from the open
 * file's folder, filtered to what the app takes (its `accept` list).
 */
import { ArrowUp, FileText, Folder } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { ScrollArea } from "@/main/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
	HostedBridgeEntry,
	HostedBridgeFiles,
} from "@/services/memon/apps/hosted/bridge";

export interface HostedPickRequest {
	accept: string;
	multiple: boolean;
	folder: string;
}

/** What `accept` names by type, as the extensions they cover. */
const MIME_EXTENSIONS: Record<string, string[]> = {
	"application/pdf": ["pdf"],
	"image/*": ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "svg"],
	"image/png": ["png"],
	"image/jpeg": ["jpg", "jpeg"],
	"text/csv": ["csv"],
	"text/plain": ["txt"],
	"text/markdown": ["md", "markdown"],
	"application/json": ["json"],
};

/** Extensions an `accept` string allows; null allows everything. */
export const acceptedExtensions = (accept: string): Set<string> | null => {
	const tokens = accept
		.split(",")
		.map((token) => token.trim().toLowerCase())
		.filter(Boolean);
	if (!tokens.length) return null;
	const extensions = new Set<string>();
	for (const token of tokens) {
		if (token.startsWith(".")) extensions.add(token.slice(1));
		else if (MIME_EXTENSIONS[token]) {
			for (const extension of MIME_EXTENSIONS[token]) extensions.add(extension);
		} else return null;
	}
	return extensions;
};

const nameOf = (path: string) => path.split("/").pop() || path;
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const extensionOf = (path: string) =>
	/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? "";

export const HostedFilePicker: React.FC<{
	request: HostedPickRequest | null;
	files: HostedBridgeFiles;
	onDone: (paths: string[] | null) => void;
}> = ({ request, files, onDone }) => {
	const { t } = useTranslation("documents");
	const [folder, setFolder] = useState("/");
	const [entries, setEntries] = useState<HostedBridgeEntry[]>([]);
	const [chosen, setChosen] = useState<string[]>([]);
	const allowed = useMemo(
		() => acceptedExtensions(request?.accept ?? ""),
		[request?.accept],
	);

	useEffect(() => {
		if (request) {
			setFolder(request.folder);
			setChosen([]);
		}
	}, [request]);

	useEffect(() => {
		if (!request) return;
		let live = true;
		void files
			.list(folder)
			.catch(() => [] as HostedBridgeEntry[])
			.then((listed) => {
				if (!live) return;
				setEntries(
					listed
						.filter(
							(entry) =>
								!nameOf(entry.path).startsWith(".") &&
								(entry.type === "dir" ||
									!allowed ||
									allowed.has(extensionOf(entry.path))),
						)
						.sort((a, b) =>
							a.type === b.type
								? nameOf(a.path).localeCompare(nameOf(b.path))
								: a.type === "dir"
									? -1
									: 1,
						),
				);
			});
		return () => {
			live = false;
		};
	}, [request, folder, files, allowed]);

	const toggle = (path: string) =>
		setChosen((current) =>
			current.includes(path)
				? current.filter((entry) => entry !== path)
				: request?.multiple
					? [...current, path]
					: [path],
		);

	return (
		<Dialog
			open={Boolean(request)}
			onOpenChange={(open) => !open && onDone(null)}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{t("hostedApp.picker.title", { defaultValue: "Open a file" })}
					</DialogTitle>
				</DialogHeader>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2"
						disabled={folder === "/"}
						onClick={() => setFolder(parentOf(folder))}
						aria-label={t("hostedApp.picker.up", { defaultValue: "Up" })}
					>
						<ArrowUp className="h-3.5 w-3.5" />
					</Button>
					<span className="truncate font-mono">{folder}</span>
				</div>
				<ScrollArea className="h-72 rounded-md border">
					<div className="p-1">
						{entries.length === 0 ? (
							<p className="p-4 text-center text-xs text-muted-foreground">
								{t("hostedApp.picker.empty", {
									defaultValue: "Nothing to open here.",
								})}
							</p>
						) : (
							entries.map((entry) => (
								<button
									key={entry.path}
									type="button"
									className={cn(
										"flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
										chosen.includes(entry.path) && "bg-primary/10 text-primary",
									)}
									onClick={() =>
										entry.type === "dir"
											? setFolder(entry.path)
											: toggle(entry.path)
									}
									onDoubleClick={() =>
										entry.type === "file" && onDone([entry.path])
									}
								>
									{entry.type === "dir" ? (
										<Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
									) : (
										<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
									)}
									<span className="truncate">{nameOf(entry.path)}</span>
								</button>
							))
						)}
					</div>
				</ScrollArea>
				<DialogFooter>
					<Button variant="outline" onClick={() => onDone(null)}>
						{t("hostedApp.picker.cancel", { defaultValue: "Cancel" })}
					</Button>
					<Button disabled={!chosen.length} onClick={() => onDone(chosen)}>
						{t("hostedApp.picker.open", { defaultValue: "Open" })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
