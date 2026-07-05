import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

vi.mock("@zenfs/core", () => ({
	configure: vi.fn(async () => undefined),
	InMemory: {},
	fs: {
		promises: {
			mkdir: vi.fn(async () => undefined),
			readFile: vi.fn(async () => new Uint8Array()),
			readdir: vi.fn(async () => []),
			stat: vi.fn(async () => ({ isDirectory: () => true })),
			writeFile: vi.fn(async () => undefined),
		},
		umount: vi.fn(async () => undefined),
	},
}));

vi.mock("@zenfs/dom", () => ({
	IndexedDB: {},
}));

vi.mock("@/main/modules/files/handlers/pdf-extraction", () => ({
	readPDFFile: vi.fn(async () => ""),
}));

vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	ImageKind: {
		RGBA_32BPP: 1,
		RGB_24BPP: 2,
		GRAYSCALE_1BPP: 3,
	},
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
		paintInlineImageXObjectGroup: 4,
		paintImageMaskXObject: 5,
		paintImageMaskXObjectRepeat: 6,
	},
	getDocument: vi.fn(() => ({
		promise: Promise.resolve({
			destroy: vi.fn(),
			getMetadata: vi.fn(async () => ({ info: {}, metadata: null })),
			getPage: vi.fn(async () => ({
				getOperatorList: vi.fn(async () => ({ fnArray: [], argsArray: [] })),
				getTextContent: vi.fn(async () => ({ items: [] })),
				getViewport: vi.fn(() => ({ width: 1, height: 1 })),
			})),
			numPages: 0,
		}),
	})),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	SANDBOX_DOCUMENTS_ROOT: "/",
	SANDBOX_WORKSPACE_ROOT: "/",
	documentFileSystemService: {
		initialize: vi.fn(async () => undefined),
		onFilesystemChanged: vi.fn(() => vi.fn()),
		listDirectory: vi.fn(async () => []),
		getDocumentTree: vi.fn(async () => []),
		readFile: vi.fn(async () => new Uint8Array()),
		writeFile: vi.fn(async () => undefined),
		mkdir: vi.fn(async () => undefined),
	},
}));

vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {},
		databaseService: { use: vi.fn(async () => []) },
		flowBuilderService: {},
	},
}));

vi.mock("react-i18next", () => ({
	initReactI18next: {
		type: "3rdParty",
		init: vi.fn(),
	},
	useTranslation: () => ({ t: (key: string) => key }),
	Trans: ({ children }: { children?: React.ReactNode }) =>
		React.createElement(React.Fragment, null, children),
}));

const loadAll = async (modules: Record<string, () => Promise<unknown>>) => {
	const loaded: string[] = [];
	const failures: string[] = [];
	for (const [path, load] of Object.entries(modules)) {
		if (path.includes("/__tests__/")) continue;
		try {
			await load();
			loaded.push(path);
		} catch (error) {
			failures.push(
				`${path}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return { loaded: loaded.sort(), failures };
};

describe("requested main module coverage", () => {
	it("imports chat, documents, agents, agent wizard, and llm modules", async () => {
		const modules = {
			...import.meta.glob("../modules/chat/**/*.{ts,tsx}"),
			...import.meta.glob("../modules/files/**/*.{ts,tsx}"),
			...import.meta.glob("../modules/agents/**/*.{ts,tsx}"),
			...import.meta.glob("../modules/agent-wizard/**/*.{ts,tsx}"),
			...import.meta.glob("../modules/llm/**/*.{ts,tsx}"),
		};

		const { loaded, failures } = await loadAll(modules);

		expect(failures).toEqual([]);
		expect(loaded).toMatchSnapshot();
		// This eagerly imports the entire chat/files/agents/llm module trees
		// (univer, tiptap, transformers, …), which legitimately takes >30s under
		// full-suite CPU contention; give it headroom so it isn't a flaky timeout.
	}, 60000);
});
