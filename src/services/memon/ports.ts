import { createMemonEmbeddedPort } from "./embedded-browser";
import { cropScreenshot } from "./page-capture";
import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { platform } from "@/platform/current";
import {
	toAgentSandbox,
	toFlowFileSystem,
} from "@/services/flow-service-adapters";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { zipFolder } from "@/services/filesystem/folder-zip";
import {
	captureWebSessionScreenshot,
	closeWebSession,
	focusWebSession,
	getWebSessionSurface,
	navigateWebSession,
	navigateWebSessionHistory,
	openWebSession,
	outlineWebSession,
	performOutlineAction,
	reserveWebSession,
} from "@/services/flows-integrations/tools/web/web-tool-registry";
import type {
	MemonAvailability,
	MemonBrowserPort,
	MemonDownloadPort,
	MemonFilesPort,
	MemonHomePort,
	MemonPorts,
	MemonSchedulerPort,
} from "./memon-machine";
import {
	MEMON_GUEST_HOME,
	MEMON_LEGACY_USERS_DIR,
	memonHomeDir,
	memonLegacyHomeDir,
} from "./constants";
import {
	type MemonHomeIO,
	moveMemonHome,
	prepareMemonHome,
} from "./agent-home";
import { loadMemonDesktopFiles, migrateMemonHomeFiles } from "./desktop-files";
import { getLocalTimezone } from "@/services/cron-jobs/cron-expression";
import type { CronJob } from "@/services/database/types";
import type { MemonViewerKind } from "./file-kinds";
import type {
	MemonCommandOutcome,
	MemonTerminalPort,
} from "./terminal/memon-terminal";
import { toTerminalLines } from "./terminal/terminal-output";
import type { MemonFileEntry, MemonSchedule } from "./types";
import {
	createMemonConnectionsPort,
	createMemonSkillsPort,
} from "./settings-ports";
import { STUDIO_USAGE_SOURCE } from "@/services/model-usage/model-usage-ledger";
import { createStudioPort, type MemonStudioPort } from "./studio-app";
import { createPiCodePort } from "./apps/pi-code/pi-code-port";
import { createMemonModelsPort, type MemonModelsPort } from "./models-port";
import { formatDownloadSize, MEMON_DOWNLOAD_MAX_BYTES } from "./download";
import { isResidentLocalProvider } from "@/services/llm/provider-registry";

/** Page outline budget; the screen adds window chrome around it. */
const OUTLINE_MAX_CHARS = 5_000;
const OPEN_TIMEOUT_MS = 20_000;

const browserAvailability = (): MemonAvailability => {
	if (platform.environment === "extension") return { available: true };
	if (platform.environment === "web") {
		return {
			available: false,
			reason:
				"the web app cannot drive a browser; use the Memorall extension or desktop app",
		};
	}
	const state = platform.capabilities.get("browser.automation");
	return state.available
		? { available: true }
		: {
				available: false,
				reason: state.reason ?? "the managed browser is not ready yet",
			};
};

export const createMemonBrowserPort = (): MemonBrowserPort => ({
	availability: browserAvailability,
	async open(url, { windowId }) {
		const { session } = await openWebSession({
			url,
			mode: "window",
			persist: true,
			timeoutMs: OPEN_TIMEOUT_MS,
			maxHtmlChars: 1_000,
			windowId,
		});
		const surface = getWebSessionSurface(session.id);
		return {
			sessionId: session.id,
			windowId: surface?.windowId ?? windowId,
			url: surface?.currentUrl ?? url,
			title: surface?.title ?? "",
		};
	},
	async navigate(sessionId, url) {
		const session = await navigateWebSession(sessionId, url, OPEN_TIMEOUT_MS);
		return {
			url: session.currentUrl || session.requestedUrl,
			title: session.title,
		};
	},
	outline: (sessionId) =>
		outlineWebSession(sessionId, { maxChars: OUTLINE_MAX_CHARS }),
	act: (sessionId, request) =>
		performOutlineAction(sessionId, request, { maxChars: OUTLINE_MAX_CHARS }),
	// The tab's screenshot, cut to the element: what the page shows, WebGL too.
	async capture(sessionId, request) {
		const { result } = await performOutlineAction(
			sessionId,
			{ ...request, action: "describe" },
			{ maxChars: OUTLINE_MAX_CHARS },
		);
		if (!result.ok || !result.box) {
			throw new Error(`${request.ref} could not be found on the page.`);
		}
		const { box } = result;
		const shot = await captureWebSessionScreenshot(sessionId);
		const scale = box.viewportWidth > 0 ? shot.width / box.viewportWidth : 1;
		const picture = await cropScreenshot(shot.dataUrl, {
			x: box.x * scale,
			y: box.y * scale,
			width: box.width * scale,
			height: box.height * scale,
		});
		return result.detail ? { ...picture, source: result.detail } : picture;
	},
	async history(sessionId, direction) {
		await navigateWebSessionHistory(sessionId, direction, OPEN_TIMEOUT_MS);
	},
	close: (sessionId) => closeWebSession(sessionId),
	focus: (sessionId) => focusWebSession(sessionId),
	reserve: (sessionId) => reserveWebSession(sessionId),
});

let flowFileSystem: IFlowFileSystem | undefined;
const getFlowFileSystem = (): IFlowFileSystem => {
	flowFileSystem ??= toFlowFileSystem(documentFileSystemService);
	return flowFileSystem;
};

const joinPath = (dir: string, name: string): string =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer instanceof ArrayBuffer
		? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
		: new Uint8Array(bytes).buffer;

const imageSize = async (
	bytes: Uint8Array,
): Promise<{ width: number; height: number } | null> => {
	if (typeof createImageBitmap === "undefined") return null;
	try {
		const bitmap = await createImageBitmap(new Blob([toArrayBuffer(bytes)]));
		const size = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return size;
	} catch {
		return null;
	}
};

/** The text the agent reads for a file the Viewer shows. */
const previewText = async (
	path: string,
	kind: MemonViewerKind,
	bytes: Uint8Array,
): Promise<string> => {
	switch (kind) {
		case "pdf": {
			// Same extraction doc_read and chat attachments use.
			const { readPDFFile } = await import(
				"@/main/modules/files/handlers/pdf-extraction"
			);
			const pdf = await readPDFFile(toArrayBuffer(bytes));
			const pages = pdf.pages
				.map((page, index) => `--- page ${index + 1} ---\n${page.text.trim()}`)
				.join("\n\n");
			return pages.trim() || pdf.fullText || "(this PDF has no text layer)";
		}
		case "excel": {
			const { parseExcelFile, workbookToMarkdown } = await import(
				"@/main/modules/files/handlers/excel-extraction"
			);
			return workbookToMarkdown(await parseExcelFile(bytes));
		}
		case "document": {
			const { docxToMarkdown } = await import(
				"@/main/modules/files/handlers/docx-extraction"
			);
			return docxToMarkdown(bytes) || "(this document has no text)";
		}
		case "presentation": {
			const { presentationToMarkdown, readPresentation } = await import(
				"@/main/modules/files/handlers/pptx-extraction"
			);
			return (
				presentationToMarkdown(await readPresentation(bytes)) ||
				"(this presentation has no slides)"
			);
		}
		case "image": {
			const size = await imageSize(bytes);
			return `An image${size ? `, ${size.width}×${size.height} px` : ""}. The user sees it; its pixels are not text you can read. If Studio has an Image tools model, memon_studio can caption or label it.`;
		}
		case "audio":
		case "video":
			return `A${kind === "audio" ? "n audio" : " video"} file. The user can play it. If Studio has a Transcribe model, memon_studio { action: "run", tool: "transcribe", path } gives its text.`;
		case "binary": {
			const extension = /\.([^./]+)$/.exec(path)?.[1] ?? "this";
			return `No preview for .${extension} files yet. The user can download it from Files.`;
		}
	}
};

export const createMemonFilesPort = (
	fs: IFlowFileSystem = getFlowFileSystem(),
): MemonFilesPort => ({
	availability: () => ({ available: true }),
	async list(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		return entries
			.map(
				(entry): MemonFileEntry => ({
					name: entry.name,
					path: joinPath(dir, entry.name),
					type: entry.isDirectory() ? "dir" : "file",
					size: entry.isDirectory() ? undefined : entry.size,
				}),
			)
			.sort((a, b) =>
				a.type === b.type
					? a.name.localeCompare(b.name)
					: a.type === "dir"
						? -1
						: 1,
			);
	},
	read: (path) => fs.readFile(path, { encoding: "utf8" }),
	async write(path, content) {
		const parent = path.replace(/\/[^/]+$/, "") || "/";
		if (parent !== "/") await fs.mkdir(parent, { recursive: true });
		await fs.writeFile(path, content);
	},
	async isDirectory(path) {
		try {
			return (await fs.stat(path)).isDirectory();
		} catch {
			return false;
		}
	},
	async exists(path) {
		try {
			await fs.stat(path);
			return true;
		} catch {
			return false;
		}
	},
	move: (from, to) => fs.rename(from, to),
	async copy(from, to) {
		const copyTree = async (source: string, target: string) => {
			if (!(await fs.stat(source)).isDirectory()) {
				await fs.copyFile(source, target);
				return;
			}
			await fs.mkdir(target, { recursive: true });
			for (const name of await fs.readdir(source)) {
				await copyTree(joinPath(source, name), joinPath(target, name));
			}
		};
		await copyTree(from, to);
	},
	remove: (path) => fs.rm(path, { recursive: true }),
	zip: (folder) => zipFolder(fs, folder),
	subscribe: (listener) =>
		documentFileSystemService.onFilesystemChanged(() => listener()),
	async preview(path, kind) {
		const bytes = (await fs.readFile(path)) as Uint8Array;
		return {
			text: await previewText(path, kind, bytes),
			size: bytes.byteLength,
		};
	},
});

const homeIO = (fs: IFlowFileSystem): MemonHomeIO => {
	const files = createMemonFilesPort(fs);
	return {
		list: (dir) => files.list(dir),
		exists: (path) => files.exists(path),
		isDirectory: (path) => files.isDirectory(path),
		move: (from, to) => files.move(from, to),
		async mkdir(path) {
			await fs.mkdir(path, { recursive: true });
		},
		async removeEmptyDir(path) {
			await fs.rmdir(path);
		},
	};
};

/** The agent's name, as the agents page has it. */
const agentNameOf = async (agentId: string): Promise<string | undefined> => {
	const { serviceManager } = await import("@/services");
	const flows = await serviceManager.flowBuilderService
		.listPredefinedFlows("foundation")
		.catch(() => []);
	return flows.find((flow) => flow.id === agentId)?.name;
};

/**
 * Agents' homes on the documents filesystem: `/agents/<agent name>`, with
 * Bot.md and Memory.md, and an older home of the agent's moved in (its old
 * notes and history to their hidden files).
 */
export const createMemonHomePort = (
	fs: IFlowFileSystem = getFlowFileSystem(),
	agentName: (agentId: string) => Promise<string | undefined> = agentNameOf,
): MemonHomePort => {
	const io = homeIO(fs);
	const files = createMemonFilesPort(fs);
	return {
		async resolve(agentId) {
			// An agent that is gone keeps a home by its id.
			const home = agentId
				? memonHomeDir((await agentName(agentId)) ?? agentId)
				: MEMON_GUEST_HOME;
			await prepareMemonHome(io, home, [
				agentId
					? memonLegacyHomeDir(agentId)
					: `${MEMON_LEGACY_USERS_DIR}/guest`,
			]);
			await migrateMemonHomeFiles(files, home);
			await loadMemonDesktopFiles(files, home);
			return home;
		},
		rename: (fromName, toName) => moveMemonHome(io, fromName, toName),
	};
};

const operationId = (label: string): string =>
	`memon:${label}:${Math.random().toString(36).slice(2, 10)}`;

/** Resolves the sandbox the same way process-chat's flow services do. */
export const resolveMemonSandbox = async (): Promise<IAgentSandboxService> => {
	const { serviceManager } = await import("@/services");
	return toAgentSandbox(
		serviceManager.getSandboxContainerService(),
		getFlowFileSystem(),
	);
};

export const createMemonTerminalPort = (
	getSandbox: () => Promise<IAgentSandboxService> = resolveMemonSandbox,
): MemonTerminalPort => ({
	async availability() {
		const sandbox = await getSandbox();
		const capabilities = await sandbox.getCapabilities({
			operationId: operationId("capabilities"),
		});
		return capabilities.supported.includes("runtime.command")
			? { available: true }
			: { available: false, reason: "this sandbox cannot run shell commands" };
	},
	async run(command, { cwd, waitMs, sessionKey }) {
		const sandbox = await getSandbox();
		const result = await sandbox.run(
			{ operation: "command", command, cwd, waitTimeoutMs: waitMs },
			{ operationId: operationId("run"), sessionKey },
		);
		if (result.kind !== "command") {
			throw new Error("The sandbox returned a non-command result.");
		}
		return {
			processId: result.processId,
			running: result.status === "running",
			exitCode: result.exitCode ?? (result.status === "completed" ? 0 : null),
			output: toTerminalLines(result.events),
			cursor: result.nextCursor,
		} satisfies MemonCommandOutcome;
	},
	async read(processId, cursor, sessionKey, waitMs) {
		const sandbox = await getSandbox();
		const result = await sandbox.process(
			{ operation: "read", processId, cursor, waitMs },
			{ operationId: operationId("read"), sessionKey },
		);
		if (!("events" in result)) {
			throw new Error("The sandbox returned no process output.");
		}
		return {
			processId,
			running: result.status === "running",
			exitCode: result.exitCode ?? (result.status === "completed" ? 0 : null),
			output: toTerminalLines(result.events),
			cursor: result.nextCursor,
		};
	},
	async input(processId, text, sessionKey) {
		const sandbox = await getSandbox();
		await sandbox.process(
			{ operation: "stdin", processId, input: text, appendNewline: true },
			{ operationId: operationId("stdin"), sessionKey },
		);
	},
	async stop(processId, sessionKey) {
		const sandbox = await getSandbox();
		await sandbox.process(
			{ operation: "stop", processId },
			{ operationId: operationId("stop"), sessionKey },
		);
	},
});

const toMemonSchedule = (job: CronJob): MemonSchedule => ({
	id: job.id,
	name: job.name,
	status: job.status,
	scheduleExpression: job.scheduleExpression,
	prompt:
		typeof job.actionPayload?.prompt === "string"
			? job.actionPayload.prompt
			: "",
	metadata: job.metadata ?? undefined,
	nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).getTime() : undefined,
	lastRunAt: job.lastRunAt ? new Date(job.lastRunAt).getTime() : undefined,
	lastStatus: job.lastStatus,
	lastError: job.lastError ?? undefined,
});

/**
 * The Scheduler on the cron job service the agent settings page uses, so a
 * schedule made on the computer is the same scheduled prompt there.
 */
export const createMemonSchedulerPort = (): MemonSchedulerPort => {
	const services = async () => (await import("@/services")).serviceManager;
	const jobsOf = async (agentId: string) =>
		(await (await services()).cronJobService.listByAgent(agentId)).filter(
			(job) => job.actionType === "agent_chat",
		);
	return {
		async list(agentId) {
			const manager = await services();
			const [jobs, flows] = await Promise.all([
				jobsOf(agentId),
				manager.flowBuilderService
					.listPredefinedFlows("foundation")
					.catch(() => []),
			]);
			return {
				agentName: flows.find((flow) => flow.id === agentId)?.name,
				items: jobs.map(toMemonSchedule),
			};
		},
		async save(agentId, input) {
			const existing = input.id
				? (await jobsOf(agentId)).find((job) => job.id === input.id)
				: undefined;
			const saved = await (await services()).cronJobService.save({
				id: existing?.id,
				name: input.name,
				status: input.status,
				scheduleExpression: input.scheduleExpression,
				timezone: existing?.timezone ?? getLocalTimezone(),
				actionType: "agent_chat",
				// Keep what the agent settings page stored (model, topic).
				actionPayload: {
					...(existing?.actionPayload ?? {}),
					prompt: input.prompt,
					agentFlowId: agentId,
				},
				agentFlowId: agentId,
				conversationId: existing?.conversationId ?? null,
				allowOverlap: existing?.allowOverlap ?? false,
				metadata: input.metadata ??
					existing?.metadata ?? { scheduleMode: "raw" },
			});
			return toMemonSchedule(saved);
		},
		async remove(id) {
			await (await services()).cronJobService.delete(id);
		},
	};
};

/**
 * Studio on the studios the Studio page runs: the model the user chose for
 * each, the same generation code, and the same history. Its model calls go
 * through the models port: each run is booked to the computer's Studio
 * session and its agent.
 */
export const createMemonStudioPort = (
	models: MemonModelsPort = createMemonModelsPort(),
): MemonStudioPort => {
	const generations = () => import("@/services/studio/studio-generations");
	// Looking models up and loading them makes no model request to book.
	const lookups = () =>
		models.llm(() => ({
			source: STUDIO_USAGE_SOURCE,
			sessionId: "lookups",
			title: "Studio",
		}));
	return createStudioPort({
		currentModel: async (mode) => (await lookups()).getCurrentModelFor(mode),
		modelInfo: async (model) => {
			const { data } = await (await lookups()).modelsFor(model.serviceName);
			const target = model.modelId.toLowerCase();
			return data.find((entry) => entry.id.toLowerCase() === target);
		},
		prepare: async (model, mode) => {
			if (!isResidentLocalProvider(model.provider)) return;
			await (await lookups()).serveFor(
				model.serviceName,
				model.modelId,
				undefined,
				{ category: mode },
			);
		},
		models: (scope) => models.llm(() => scope),
		generators: {
			speech: async (options) =>
				(await generations()).runSpeechGeneration(options),
			transcribe: async (options) =>
				(await generations()).runTranscription(options),
			image: async (options) =>
				(await generations()).runImageGeneration(options),
			imageTool: async (options) =>
				(await generations()).runImageToolGeneration(options),
			textTool: async (options) =>
				(await generations()).runTextToolGeneration(options),
			decision: async (options) =>
				(await generations()).runDecisionGeneration(options),
		},
		record: async (record) =>
			(await import("@/services/studio/studio-history")).recordStudioRun(
				record,
			),
	});
};

/**
 * Downloads from this page's origin, without the user's cookies. A site that
 * does not allow cross-origin reads (no CORS) cannot be fetched here.
 */
export const createMemonDownloadPort = (): MemonDownloadPort => ({
	async fetch(url) {
		let response: Response;
		try {
			response = await fetch(url, {
				credentials: "omit",
				cache: "no-store",
				redirect: "follow",
			});
		} catch {
			throw new Error(
				`${new URL(url).host} does not let other sites read its files (no CORS), so it cannot be saved from here. Try the file's own address on a CDN, or ask the user to save it.`,
			);
		}
		if (!response.ok) {
			throw new Error(
				`${url} answered ${response.status} ${response.statusText}`.trim(),
			);
		}
		const length = Number(response.headers.get("content-length") ?? 0);
		if (length > MEMON_DOWNLOAD_MAX_BYTES) {
			throw new Error(
				`${url} is ${formatDownloadSize(length)}; downloads stop at ${formatDownloadSize(MEMON_DOWNLOAD_MAX_BYTES)}.`,
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > MEMON_DOWNLOAD_MAX_BYTES) {
			throw new Error(
				`${url} is over ${formatDownloadSize(MEMON_DOWNLOAD_MAX_BYTES)}; downloads stop there.`,
			);
		}
		return {
			bytes,
			contentType: response.headers.get("content-type") ?? "",
			url: response.url || url,
		};
	},
});

export const createMemonPorts = (
	overrides: Partial<MemonPorts> = {},
	/** The one way the computer's apps reach the models (metered). */
	models: MemonModelsPort = createMemonModelsPort(),
): MemonPorts => ({
	browser: overrides.browser ?? createMemonBrowserPort(),
	embedded: overrides.embedded ?? createMemonEmbeddedPort(),
	files: overrides.files ?? createMemonFilesPort(),
	terminal: overrides.terminal ?? createMemonTerminalPort(),
	scheduler: overrides.scheduler ?? createMemonSchedulerPort(),
	studio: overrides.studio ?? createMemonStudioPort(models),
	skills: overrides.skills ?? createMemonSkillsPort(),
	connections: overrides.connections ?? createMemonConnectionsPort(),
	download: overrides.download ?? createMemonDownloadPort(),
	homes: overrides.homes ?? createMemonHomePort(),
	models: overrides.models ?? models,
	piCode:
		overrides.piCode ??
		createPiCodePort({
			fs: getFlowFileSystem,
			sandbox: resolveMemonSandbox,
			models,
		}),
});
