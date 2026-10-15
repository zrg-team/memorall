/**
 * The hosted apps: web apps built from a pinned upstream
 * (tools/hosted-apps/apps.mjs) into public/vendors/apps/<id>/. Files and
 * MemonOS open files with them, and the agent changes those files through
 * each app's engine (engine/engine.js), the app's own document code.
 *
 * Adding an app: build it (apps.mjs plus an engine in
 * tools/hosted-apps/engines), then list it here. Files, MemonOS and the
 * agent's tools find it from this list.
 */

export const HOSTED_APP_IDS = [
	"spreadsheet",
	"documents",
	"presentation",
	"whiteboard",
	"pdf",
] as const;

export type HostedAppId = (typeof HOSTED_APP_IDS)[number];

export interface HostedAppManifest {
	id: HostedAppId;
	/** English name; the UI translates `hostedApps.<id>.name`. */
	name: string;
	/** What the agent and the screen call one of its files. */
	noun: string;
	/**
	 * Extensions it opens, lowercase, without the dot. The app edits its own
	 * format (`newFile`) in place; another one it saves as a copy in its own
	 * format beside it, and the agent's engine reads what it cannot write.
	 */
	extensions: readonly string[];
	/** A new file: its extension and the name it starts as. */
	newFile: { extension: string; name: string };
}

export const HOSTED_APPS: Readonly<Record<HostedAppId, HostedAppManifest>> = {
	spreadsheet: {
		id: "spreadsheet",
		name: "Spreadsheet",
		noun: "workbook",
		extensions: ["xlsx", "xlsm", "xls", "ods"],
		newFile: { extension: "xlsx", name: "Untitled spreadsheet" },
	},
	documents: {
		id: "documents",
		name: "Documents",
		noun: "document",
		// Hanword (.hwp, .hwpx) converts on opening.
		extensions: ["docx", "dotx", "docm", "hwp", "hwpx"],
		newFile: { extension: "docx", name: "Untitled document" },
	},
	presentation: {
		id: "presentation",
		name: "Presentation",
		noun: "presentation",
		extensions: ["pptx"],
		newFile: { extension: "pptx", name: "Untitled presentation" },
	},
	whiteboard: {
		id: "whiteboard",
		name: "Whiteboard",
		noun: "board",
		extensions: ["whiteboard"],
		newFile: { extension: "whiteboard", name: "Untitled board" },
	},
	pdf: {
		id: "pdf",
		name: "PDF",
		noun: "PDF",
		extensions: ["pdf"],
		newFile: { extension: "pdf", name: "Untitled" },
	},
};

const APP_BY_EXTENSION = new Map<string, HostedAppId>(
	HOSTED_APP_IDS.flatMap((id) =>
		HOSTED_APPS[id].extensions.map((extension) => [extension, id] as const),
	),
);

export const isHostedAppId = (value: unknown): value is HostedAppId =>
	typeof value === "string" &&
	(HOSTED_APP_IDS as readonly string[]).includes(value);

const extensionOf = (path: string): string =>
	/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? "";

/** The app that opens this file, or null. */
export const hostedAppForPath = (path: string): HostedAppId | null =>
	APP_BY_EXTENSION.get(extensionOf(path)) ?? null;

/** Every extension an app opens, as ".xlsx, .docx, …" for prompts. */
export const hostedAppExtensionsText = (): string =>
	HOSTED_APP_IDS.flatMap((id) =>
		HOSTED_APPS[id].extensions.map((extension) => `.${extension}`),
	).join(", ");

/**
 * On the Files page, where an app keeps what it makes on its own (version
 * history, templates): one folder for all of them, not a "Spreadsheets/"
 * beside every file the user opens. On a Memon computer it is the agent's home.
 */
export const HOSTED_APPS_DATA_DIR = "/.apps" as const;

/** Where the built apps live, relative to the platform's assets. */
export const HOSTED_APPS_ASSET_DIR = "vendors/apps" as const;
export const hostedAppPagePath = (id: HostedAppId): string =>
	`${HOSTED_APPS_ASSET_DIR}/${id}/index.html`;
export const hostedAppEnginePath = (id: HostedAppId): string =>
	`${HOSTED_APPS_ASSET_DIR}/${id}/engine/engine.js`;
export const HOSTED_APPS_INDEX_PATH = `${HOSTED_APPS_ASSET_DIR}/apps.json`;
