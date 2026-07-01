import { beforeAll, describe, expect, it, vi } from "vitest";
import { stepRegistry } from "flow-core/registries/step-registry";
import { toolRegistry } from "flow-core/registries/tool-registry";
import {
	expectStepContracts,
	expectToolContracts,
	sortedDelta,
} from "@/services/__tests__/flow-contract-test-utils";

vi.mock("@/main/modules/documents/handlers/pdf-extraction", () => ({
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

describe("flows-integrations registered contracts", () => {
	let toolNames: string[] = [];
	let stepNames: string[] = [];

	beforeAll(async () => {
		const beforeTools = new Set(toolRegistry.getRegisteredToolNames());
		const beforeSteps = new Set(stepRegistry.getRegisteredStepNames());
		await import("../index");
		toolNames = sortedDelta(beforeTools, toolRegistry.getRegisteredToolNames());
		stepNames = sortedDelta(beforeSteps, stepRegistry.getRegisteredStepNames());
	});

	it("registers every integrations tool contract", () => {
		expect(toolNames).toMatchSnapshot();
		expectToolContracts(toolNames);
	});

	it("registers every integrations step contract", () => {
		expect(stepNames).toMatchSnapshot();
		expectStepContracts(stepNames);
	});
});
