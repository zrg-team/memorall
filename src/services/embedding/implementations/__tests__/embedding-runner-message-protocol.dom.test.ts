import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

type RunnerMessageHandler = (event: MessageEvent) => void | Promise<void>;

describe("embedding runner message protocol", () => {
	let handleMessage: RunnerMessageHandler;
	let postMessageSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
	let startupPostMessageCalls: number;

	beforeAll(async () => {
		const nativeAddEventListener = window.addEventListener.bind(window);
		vi.spyOn(window, "addEventListener").mockImplementation(((
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (type === "message") {
				handleMessage = listener as RunnerMessageHandler;
				return;
			}

			nativeAddEventListener(type, listener, options);
		}) as typeof window.addEventListener);
		postMessageSpy = vi
			.spyOn(window, "postMessage")
			.mockImplementation(() => undefined);
		consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		vi.spyOn(console, "log").mockImplementation(() => undefined);

		await import("../../../../../public/runner/modes/embedding-runner.js");

		expect(handleMessage).toBeTypeOf("function");
		startupPostMessageCalls = postMessageSpy.mock.calls.length;
		postMessageSpy.mockClear();
		consoleErrorSpy.mockClear();
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	beforeEach(() => {
		postMessageSpy.mockClear();
		consoleErrorSpy.mockClear();
	});

	it("does not post RUNNER_READY to itself when loaded top-level", () => {
		expect(window.parent).toBe(window);
		expect(startupPostMessageCalls).toBe(0);
	});

	it.each([undefined, "completed-request"])(
		"does not reply to an inbound error response with messageId %s",
		async (messageId) => {
			await handleMessage({
				data: {
					messageId,
					type: "error",
					payload: {
						error: {
							message: "upstream failure",
							type: "invalid_request_error",
							code: null,
						},
					},
				},
				origin: window.location.origin,
				source: window,
			} as unknown as MessageEvent);

			expect(postMessageSpy).not.toHaveBeenCalled();
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		},
	);

	it("still returns one error for an unsupported request", async () => {
		await handleMessage({
			data: {
				messageId: "request-1",
				type: "unsupported-request",
			},
			origin: window.location.origin,
			source: window,
		} as unknown as MessageEvent);

		expect(postMessageSpy).toHaveBeenCalledOnce();
		expect(postMessageSpy).toHaveBeenCalledWith(
			{
				messageId: "request-1",
				type: "error",
				payload: {
					error: {
						message: "Unknown message type: unsupported-request",
						type: "invalid_request_error",
						code: null,
					},
				},
			},
			window.location.origin,
		);
	});
});
