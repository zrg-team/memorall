import { beforeAll, describe, expect, it, vi } from "vitest";
import { BaseProcessHandler } from "../base-process-handler";
import { createJobErrorMetadata, getErrorMessage } from "../error-metadata";
import { handlerRegistry } from "../handler-registry";
import { ProcessFactory } from "../process-factory";
import type { BaseJob, ItemHandlerResult, ProcessDependencies } from "../types";

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		initialize: vi.fn(async () => undefined),
		uploadFile: vi.fn(async () => ({ path: "/mock/file.txt" })),
		readFile: vi.fn(async () => new Uint8Array()),
		writeFile: vi.fn(async () => undefined),
	},
}));

vi.mock("@/utils/secure-session", () => ({
	default: {
		reload: vi.fn(async () => undefined),
		set: vi.fn(async () => undefined),
		get: vi.fn(async () => null),
		exists: vi.fn(async () => false),
	},
}));

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

const createBaseJob = (jobType: string): BaseJob => ({
	id: `${jobType}-id`,
	jobType,
	status: "pending",
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	progress: [],
});

const createDependencies = (): ProcessDependencies => ({
	logger: {
		info: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
		debug: vi.fn(async () => undefined),
	},
	updateJobProgress: vi.fn(async () => undefined),
	completeJob: vi.fn(async () => undefined),
});

class ProbeProcessHandler extends BaseProcessHandler<BaseJob> {
	async process(
		jobId: string,
		_job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		await this.addProgress(jobId, "Probe progress", 42, dependencies, {
			probe: true,
		});
		return this.createSuccessResult({ ok: true });
	}

	history() {
		return this.getProgressHistory();
	}
}

describe("background job handler registry", () => {
	let registeredJobTypes: string[] = [];

	beforeAll(async () => {
		await import("../index");
		registeredJobTypes = handlerRegistry
			.getRegisteredJobTypes()
			.sort((left, right) => left.localeCompare(right));
	}, 30000);

	it("registers every background job handler by job type", () => {
		expect(registeredJobTypes.length).toBeGreaterThan(0);
		expect(
			registeredJobTypes.map((jobType) => ({
				jobType,
				handler: handlerRegistry.getHandler(jobType).constructor.name,
			})),
		).toMatchSnapshot();
	});

	it("throws for unknown job types", () => {
		expect(() => handlerRegistry.getHandler("missing-job-type")).toThrow(
			"No handler registered for job type: missing-job-type",
		);
	});
});

describe("BaseProcessHandler", () => {
	it("records progress updates and returns success results", async () => {
		const handler = new ProbeProcessHandler();
		const dependencies = createDependencies();

		await expect(
			handler.process("probe-id", createBaseJob("probe"), dependencies),
		).resolves.toEqual({ ok: true });

		expect(dependencies.updateJobProgress).toHaveBeenCalledWith(
			"probe-id",
			expect.objectContaining({
				stage: "Probe progress",
				progress: 42,
				metadata: { probe: true },
			}),
		);
		expect(handler.history()).toEqual([
			expect.objectContaining({
				stage: "Probe progress",
				progress: 42,
				metadata: { probe: true },
			}),
		]);
	});
});

describe("ProcessFactory", () => {
	it("wraps handler success with start and completion progress", async () => {
		const dependencies = createDependencies();
		const processFactory = ProcessFactory.getInstance();
		const handler = {
			process: vi.fn(async () => ({ value: "done" })),
		};

		processFactory.register({
			instance: handler,
			jobs: ["unit-success-job"],
		});
		processFactory.setDependencies(dependencies);

		await processFactory.executeJob(
			"unit-success-id",
			createBaseJob("unit-success-job"),
		);

		expect(handler.process).toHaveBeenCalledOnce();
		expect(dependencies.updateJobProgress).toHaveBeenNthCalledWith(
			1,
			"unit-success-id",
			expect.objectContaining({ stage: "Starting...", progress: 0 }),
		);
		expect(dependencies.updateJobProgress).toHaveBeenNthCalledWith(
			2,
			"unit-success-id",
			expect.objectContaining({
				stage: "Completed successfully",
				progress: 100,
				status: "completed",
				result: { value: "done" },
			}),
		);
		expect(dependencies.completeJob).toHaveBeenCalledWith(
			"unit-success-id",
			expect.objectContaining({
				status: "completed",
				result: { value: "done" },
			}),
		);
	});

	it("turns handler failures into failed job results with metadata", async () => {
		const dependencies = createDependencies();
		const processFactory = ProcessFactory.getInstance();

		processFactory.register({
			instance: {
				process: vi.fn(async () => {
					throw new Error(
						'Request failed: 429 {"error":{"message":"rate limited","code":"rate_limit","metadata":{"provider_name":"openai"}},"user_id":"user-1"}',
					);
				}),
			},
			jobs: ["unit-failure-job"],
		});
		processFactory.setDependencies(dependencies);

		await processFactory.executeJob(
			"unit-failure-id",
			createBaseJob("unit-failure-job"),
		);

		expect(dependencies.updateJobProgress).toHaveBeenLastCalledWith(
			"unit-failure-id",
			expect.objectContaining({
				stage: "Failed with error",
				progress: 100,
				status: "failed",
				error: expect.stringContaining("Request failed: 429"),
				metadata: {
					error: expect.objectContaining({
						message: "rate limited",
						statusCode: 429,
						code: "rate_limit",
						providerName: "openai",
						userId: "user-1",
					}),
				},
			}),
		);
		expect(dependencies.completeJob).toHaveBeenCalledWith(
			"unit-failure-id",
			expect.objectContaining({
				status: "failed",
				error: expect.stringContaining("Request failed: 429"),
			}),
		);
	});
});

describe("job error metadata", () => {
	it("normalizes unknown thrown values", () => {
		expect(getErrorMessage("plain failure")).toBe("plain failure");
		expect(createJobErrorMetadata("plain failure")).toEqual({
			message: "plain failure",
			rawMessage: "plain failure",
			statusCode: undefined,
			code: undefined,
			providerName: undefined,
			userId: undefined,
		});
	});
});
