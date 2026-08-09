import type { Page } from "@playwright/test";

interface JobResult<T> {
	status: "pending" | "processing" | "completed" | "failed";
	result?: { operation: string; result: T };
	error?: string;
}

export const runSandboxOperation = async <T>(
	page: Page,
	operation: string,
	payload: unknown,
	timeoutMs = 90_000,
): Promise<T> =>
	page.evaluate(
		({ operation, payload, timeoutMs }) =>
			new Promise<T>((resolve, reject) => {
				const jobId = `e2e-sandbox-${crypto.randomUUID()}`;
				const timer = window.setTimeout(() => {
					chrome.runtime.onMessage.removeListener(listener);
					reject(new Error(`Sandbox operation timed out: ${operation}`));
				}, timeoutMs);
				const listener = (message: unknown) => {
					if (!message || typeof message !== "object") return;
					const event = message as {
						type?: string;
						jobId?: string;
						result?: JobResult<T>;
					};
					if (event.type !== "JOB_COMPLETED" || event.jobId !== jobId) return;
					window.clearTimeout(timer);
					chrome.runtime.onMessage.removeListener(listener);
					if (event.result?.status === "failed") {
						reject(new Error(event.result.error ?? `Sandbox operation failed: ${operation}`));
						return;
					}
					resolve(event.result?.result?.result as T);
				};
				chrome.runtime.onMessage.addListener(listener);
				void chrome.runtime.sendMessage({
					type: "JOB_ENQUEUED",
					target: "offscreen",
					sender: "popup",
					timestamp: Date.now(),
					jobId,
					job: {
						id: jobId,
						jobType: "sandbox-operation",
						status: "pending",
						createdAt: new Date().toISOString(),
						progress: [],
						payload: { operation, payload },
					},
				});
			}),
		{ operation, payload, timeoutMs },
	);
