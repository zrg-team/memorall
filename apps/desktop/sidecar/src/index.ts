import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
	BrowserAutomationError,
	BrowserAutomationManager,
} from "./browser-automation";
import {
	SIDECAR_PROTOCOL_VERSION,
	parseSidecarRequest,
	type SidecarResponse,
} from "./protocol";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const browser = new BrowserAutomationManager(
	resolve(
		process.env.MEMORALL_DESKTOP_APP_DATA_DIR ??
			resolve(process.cwd(), ".memorall-sidecar-data"),
	),
	{
		persistProfile: process.env.MEMORALL_BROWSER_PERSIST_PROFILE === "1",
		visible: process.env.MEMORALL_BROWSER_VISIBLE === "1",
	},
);
const operations = new Map<string, AbortController>();
let shutdownStarted = false;

const paramsRecord = (
	value: unknown,
	method: string,
): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${method} params must be an object.`);
	}
	return value as Record<string, unknown>;
};

const assertOnlyKeys = (
	params: Record<string, unknown>,
	allowed: string[],
	method: string,
): void => {
	const unexpected = Object.keys(params).filter(
		(key) => !allowed.includes(key),
	);
	if (unexpected.length > 0) {
		throw new Error(
			`${method} received unexpected params: ${unexpected.join(", ")}.`,
		);
	}
};

function send(response: SidecarResponse): void {
	process.stdout.write(`${JSON.stringify(response)}\n`);
}

lines.on("line", (line) => {
	void handleLine(line);
});
lines.once("close", () => {
	if (!shutdownStarted) void browser.stop();
});

async function handleLine(line: string): Promise<void> {
	let id = "unknown";
	try {
		const request = parseSidecarRequest(JSON.parse(line));
		id = request.id;
		if (request.method === "health") {
			const params = paramsRecord(request.params, request.method);
			assertOnlyKeys(params, [], request.method);
			send({
				protocolVersion: SIDECAR_PROTOCOL_VERSION,
				id,
				ok: true,
				result: { node: process.version, ready: true },
			});
			return;
		}
		if (request.method === "shutdown") {
			const params = paramsRecord(request.params, request.method);
			assertOnlyKeys(params, [], request.method);
			shutdownStarted = true;
			await browser.stop();
			send({ protocolVersion: SIDECAR_PROTOCOL_VERSION, id, ok: true });
			process.exitCode = 0;
			lines.close();
			return;
		}
		if (request.method === "cancel") {
			const params = paramsRecord(request.params, request.method);
			assertOnlyKeys(params, ["id"], request.method);
			const targetId = params.id;
			if (typeof targetId !== "string" || targetId.length === 0) {
				throw new Error("cancel params.id must be a non-empty string.");
			}
			operations.get(targetId)?.abort();
			send({ protocolVersion: SIDECAR_PROTOCOL_VERSION, id, ok: true });
			return;
		}
		const controller = new AbortController();
		operations.set(id, controller);
		try {
			if (request.method === "browser.status") {
				const params = paramsRecord(request.params, request.method);
				assertOnlyKeys(params, ["tabId"], request.method);
				const tabId = params.tabId;
				if (
					tabId !== undefined &&
					(typeof tabId !== "number" ||
						!Number.isSafeInteger(tabId) ||
						tabId < 1)
				) {
					throw new Error(
						"browser.status params.tabId must be a positive integer.",
					);
				}
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.status(
						typeof tabId === "number" ? tabId : undefined,
					),
				});
				return;
			}
			if (request.method === "browser.command") {
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.handle(request.params, controller.signal),
				});
				return;
			}
			if (request.method === "browser.configure") {
				const params = paramsRecord(request.params, request.method);
				assertOnlyKeys(params, ["persistProfile", "visible"], request.method);
				if (
					typeof params.persistProfile !== "boolean" ||
					typeof params.visible !== "boolean"
				) {
					throw new Error(
						"browser.configure requires boolean persistProfile and visible params.",
					);
				}
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.configure({
						persistProfile: params.persistProfile,
						visible: params.visible,
					}),
				});
				return;
			}
			if (request.method === "browser.clear-profile") {
				const params = paramsRecord(request.params, request.method);
				assertOnlyKeys(params, [], request.method);
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.clearProfile(),
				});
				return;
			}
			if (request.method === "browser.takeover") {
				const params = paramsRecord(request.params, request.method);
				assertOnlyKeys(params, ["tabId"], request.method);
				const tabId = params.tabId;
				if (
					typeof tabId !== "number" ||
					!Number.isSafeInteger(tabId) ||
					tabId < 1
				) {
					throw new Error(
						"browser.takeover params.tabId must be a positive integer.",
					);
				}
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.takeover(tabId, controller.signal),
				});
				return;
			}
			if (request.method === "browser.resume") {
				const params = paramsRecord(request.params, request.method);
				assertOnlyKeys(params, ["tabId"], request.method);
				const tabId = params.tabId;
				if (
					typeof tabId !== "number" ||
					!Number.isSafeInteger(tabId) ||
					tabId < 1
				) {
					throw new Error(
						"browser.resume params.tabId must be a positive integer.",
					);
				}
				send({
					protocolVersion: SIDECAR_PROTOCOL_VERSION,
					id,
					ok: true,
					result: await browser.resume(tabId),
				});
				return;
			}
		} finally {
			operations.delete(id);
		}
		throw new Error(`Sidecar method is not implemented yet: ${request.method}`);
	} catch (error) {
		send({
			protocolVersion: SIDECAR_PROTOCOL_VERSION,
			id,
			ok: false,
			error: {
				code:
					error instanceof BrowserAutomationError
						? error.code
						: "INVALID_REQUEST",
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
}
