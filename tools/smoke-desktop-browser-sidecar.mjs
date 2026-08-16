import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const protocolVersion = 3;
const source = "memorall:web-browser-command";
const triples = {
	"win32-x64": "x86_64-pc-windows-msvc",
	"win32-arm64": "aarch64-pc-windows-msvc",
	"darwin-x64": "x86_64-apple-darwin",
	"darwin-arm64": "aarch64-apple-darwin",
	"linux-x64": "x86_64-unknown-linux-gnu",
	"linux-arm64": "aarch64-unknown-linux-gnu",
};
const triple = triples[`${process.platform}-${process.arch}`];
if (!triple)
	throw new Error(
		`Unsupported desktop smoke target: ${process.platform}-${process.arch}`,
	);
const runtimePath = resolve(
	`publish/.cache/tauri-sidecars/memorall-node-${triple}${process.platform === "win32" ? ".exe" : ""}`,
);
const appData = mkdtempSync(join(tmpdir(), "memorall-browser-smoke-"));
const browserRuntimePath = resolve(
	"publish/.cache/tauri-resources/browser-runtime",
);
const browserExecutables = {
	"win32-x64": "browseros/Chrome-bin/chrome.exe",
	"darwin-x64":
		"browseros/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
	"darwin-arm64":
		"browseros/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
	"linux-x64": "browseros/chrome-linux64/chrome",
	"linux-arm64": "browseros/chrome-linux/chrome",
};
const runtimeTarget = `${process.platform}-${process.arch}`;
const runtimeLock = JSON.parse(
	readFileSync(resolve("apps/desktop/browser-runtime.lock.json"), "utf8"),
);
const packagedAutomation =
	runtimeLock.browser.targets[runtimeTarget]?.automation;
const browserExecutable = resolve(
	browserRuntimePath,
	browserExecutables[runtimeTarget],
);
const browserosServer = resolve(
	browserRuntimePath,
	"browseros",
	process.platform === "win32" ? "browseros-server.exe" : "browseros-server",
);
const lightpandaExecutable = resolve(
	browserRuntimePath,
	"lightpanda",
	process.platform === "win32" ? "lightpanda.exe" : "lightpanda",
);
const scriptPath = resolve(
	"publish/.cache/tauri-resources/desktop-sidecar/index.mjs",
);
const image = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	if (url.pathname === "/redirect") {
		response.writeHead(302, { location: "/fixture" });
		response.end();
		return;
	}
	if (url.pathname === "/image") {
		if (!request.headers.cookie?.includes("fixture-token=allowed")) {
			response.writeHead(401).end();
			return;
		}
		response.writeHead(200, { "content-type": "image/png" });
		response.end(image);
		return;
	}
	if (url.pathname === "/slow") {
		setTimeout(() => {
			response.writeHead(200, { "content-type": "text/html" });
			response.end(
				"<!doctype html><title>Slow</title><main>late content</main>",
			);
		}, 250);
		return;
	}
	response.writeHead(200, { "content-type": "text/html" });
	response.end(`<!doctype html>
		<title>Desktop fixture</title>
		<input id="name" placeholder="Name">
		<input id="persist" value="" oninput="localStorage.setItem('fixture-marker', this.value)">
		<button id="apply" onclick="document.querySelector('main').textContent = document.querySelector('#name').value">Apply</button>
		<main>ready</main>
		<script>
			document.cookie = 'fixture-token=allowed; SameSite=Lax';
			document.querySelector('#persist').value = localStorage.getItem('fixture-marker') || '';
			setTimeout(() => { const node = document.createElement('aside'); node.id = 'dynamic'; node.textContent = 'appeared'; document.body.append(node); }, 60);
		</script>`);
});

await new Promise((resolveListen) =>
	server.listen(0, "127.0.0.1", resolveListen),
);
const address = server.address();
if (!address || typeof address === "string")
	throw new Error("Fixture server did not bind.");
const baseUrl = `http://127.0.0.1:${address.port}`;

const child = spawn(runtimePath, [scriptPath], {
	stdio: ["pipe", "pipe", "pipe"],
	env: {
		...process.env,
		MEMORALL_DESKTOP_APP_DATA_DIR: appData,
		MEMORALL_BROWSEROS_BROWSER_PATH: browserExecutable,
		MEMORALL_BROWSEROS_SERVER_PATH: browserosServer,
		MEMORALL_LIGHTPANDA_PATH: lightpandaExecutable,
		MEMORALL_BROWSER_AUTOMATION: packagedAutomation,
		MEMORALL_BROWSEROS_VERSION: "0.0.37",
		MEMORALL_BROWSER_RENDERER_VERSION: "148.0.7985.97",
		MEMORALL_LIGHTPANDA_VERSION: "0.3.6",
		// Native CI can itself run inside an OS sandbox. Production never sets this.
		MEMORALL_BROWSER_DISABLE_SANDBOX: "1",
	},
});
const pending = new Map();
let nextId = 0;
let stderr = "";
let shutdownRequested = false;
const verbose = process.env.MEMORALL_SMOKE_VERBOSE === "1";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
	stderr += chunk;
	if (verbose) process.stderr.write(chunk);
});
createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
	"line",
	(line) => {
		const response = JSON.parse(line);
		const request = pending.get(response.id);
		if (!request) return;
		pending.delete(response.id);
		if (response.ok) request.resolve(response.result);
		else
			request.reject(
				new Error(`${response.error?.code}: ${response.error?.message}`),
			);
	},
);

const request = (method, params, fragmented = false) =>
	new Promise((resolveRequest, rejectRequest) => {
		const id = `smoke-${++nextId}`;
		let timer;
		pending.set(id, {
			resolve: (value) => {
				clearTimeout(timer);
				if (verbose) console.log(`completed ${id} ${method}`);
				resolveRequest(value);
			},
			reject: (error) => {
				clearTimeout(timer);
				rejectRequest(error);
			},
		});
		if (verbose)
			console.log(
				`started ${id} ${method}${params?.command ? ` (${params.command})` : ""}`,
			);
		const frame = `${JSON.stringify({ protocolVersion, id, method, params })}\n`;
		if (fragmented) {
			const middle = Math.floor(frame.length / 2);
			child.stdin.write(frame.slice(0, middle));
			setTimeout(() => child.stdin.write(frame.slice(middle)), 5);
		} else {
			child.stdin.write(frame);
		}
		timer = setTimeout(() => {
			if (pending.delete(id)) {
				rejectRequest(
					new Error(
						`Timed out waiting for ${method}${params?.command ? ` (${params.command})` : ""}.`,
					),
				);
			}
		}, 60_000);
	});

const command = (value) => request("browser.command", { source, ...value });

try {
	const health = await request("health", {}, true);
	if (!health.ready) throw new Error("Sidecar health did not become ready.");
	const [firstStatus, secondStatus] = await Promise.all([
		request("browser.status", {}),
		request("browser.status", {}),
	]);
	const expectedFullEngine =
		process.env.MEMORALL_BROWSEROS_DISABLED === "1" ||
		packagedAutomation !== "browseros-and-cdp"
			? "chromium"
			: "browseros";
	if (
		!firstStatus.ready ||
		!secondStatus.ready ||
		!firstStatus.engines?.some(
			(engine) =>
				engine.engine === expectedFullEngine && engine.readiness === "ready",
		)
	) {
		throw new Error(
			`Bundled ${expectedFullEngine} lane did not launch: ${JSON.stringify(firstStatus)}`,
		);
	}

	const sessionId = "browser-smoke-session";
	const opened = await command({
		command: "open",
		sessionId,
		url: `${baseUrl}/redirect`,
		mode: "tab",
		timeoutMs: 5_000,
		maxHtmlChars: 100_000,
	});
	if (!opened.success || opened.snapshot.title !== "Desktop fixture") {
		throw new Error(`Open failed: ${JSON.stringify(opened)}`);
	}
	const tabId = opened.surface.tabId;
	const queried = await command({
		command: "dom-query",
		sessionId,
		tabId,
		selector: "input#name",
		maxResults: 5,
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	if (!queried.success || queried.elements[0]?.acceptsTextInput !== true) {
		throw new Error("DOM query did not return the input.");
	}
	await command({
		command: "dom-action",
		sessionId,
		tabId,
		action: "input",
		selector: "#name",
		value: "bundled browser",
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	const clicked = await command({
		command: "dom-action",
		sessionId,
		tabId,
		action: "click",
		selector: "#apply",
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	if (!clicked.success || !clicked.snapshot.text.includes("bundled browser")) {
		throw new Error("DOM input/click did not update rendered text.");
	}
	const waited = await command({
		command: "wait-selector",
		sessionId,
		tabId,
		selector: "#dynamic",
		state: "present",
		timeoutMs: 2_000,
		intervalMs: 25,
		maxHtmlChars: 100_000,
	});
	if (!waited.success || !waited.matched)
		throw new Error("Selector wait failed.");
	const screenshot = await command({ command: "screenshot", sessionId, tabId });
	if (!screenshot.success || screenshot.width < 1 || screenshot.height < 1) {
		throw new Error(
			`Viewport screenshot dimensions are incorrect: ${JSON.stringify(screenshot)}`,
		);
	}
	const fetched = await command({
		command: "fetch-image",
		sessionId,
		tabId,
		url: `${baseUrl}/image`,
	});
	if (!fetched.success || fetched.mimeType !== "image/png") {
		throw new Error("Authenticated in-page image fetch failed.");
	}
	const invalidSelector = await command({
		command: "dom-query",
		sessionId,
		tabId,
		selector: "[",
		maxResults: 5,
		timeoutMs: 1_000,
		maxHtmlChars: 100_000,
	});
	if (invalidSelector.success)
		throw new Error("Invalid selector was accepted.");
	const blocked = await command({
		command: "open",
		sessionId: "blocked",
		url: "data:text/html,blocked",
		mode: "tab",
		timeoutMs: 1_000,
		maxHtmlChars: 1_000,
	});
	if (blocked.success || !blocked.error.includes("UNSUPPORTED_URL_SCHEME")) {
		throw new Error("Blocked URL scheme was accepted.");
	}
	const partial = await command({
		command: "open",
		sessionId: "partial-timeout",
		url: `${baseUrl}/slow`,
		mode: "tab",
		timeoutMs: 25,
		maxHtmlChars: 10_000,
	});
	const partialTabId = Number(partial.error?.match(/browser tab (\d+)/)?.[1]);
	if (partial.success || !Number.isSafeInteger(partialTabId)) {
		throw new Error(
			`Navigation timeout did not retain a recoverable page handle: ${JSON.stringify(partial)}`,
		);
	}
	await new Promise((resolveWait) => setTimeout(resolveWait, 350));
	const recovered = await command({
		command: "snapshot",
		sessionId: "partial-timeout",
		tabId: partialTabId,
		timeoutMs: 2_000,
		maxHtmlChars: 10_000,
	});
	if (!recovered.success || !recovered.snapshot.text.includes("late content")) {
		throw new Error("Timed-out navigation did not recover through snapshot.");
	}
	await command({
		command: "close",
		sessionId: "partial-timeout",
		tabId: partialTabId,
	});
	await command({ command: "close", sessionId, tabId });
	const closedStatus = await request("browser.status", { tabId });
	if (closedStatus.exists || closedStatus.activeSessions !== 0) {
		throw new Error("Browser session did not close cleanly.");
	}

	await request("browser.configure", {
		persistProfile: true,
		visible: false,
	});
	const persistentSession = "persistent-1";
	const persistentOpen = await command({
		command: "open",
		sessionId: persistentSession,
		url: `${baseUrl}/fixture`,
		mode: "tab",
		timeoutMs: 5_000,
		maxHtmlChars: 100_000,
	});
	await command({
		command: "dom-action",
		sessionId: persistentSession,
		tabId: persistentOpen.surface.tabId,
		action: "input",
		selector: "#persist",
		value: "survives-restart",
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	await request("browser.configure", {
		persistProfile: false,
		visible: false,
	});
	await request("browser.configure", {
		persistProfile: true,
		visible: false,
	});
	const reopened = await command({
		command: "open",
		sessionId: "persistent-2",
		url: `${baseUrl}/fixture`,
		mode: "tab",
		timeoutMs: 5_000,
		maxHtmlChars: 100_000,
	});
	const persisted = await command({
		command: "dom-query",
		sessionId: "persistent-2",
		tabId: reopened.surface.tabId,
		selector: "#persist",
		maxResults: 1,
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	if (persisted.elements[0]?.value !== "survives-restart") {
		throw new Error(
			"Opt-in browser profile did not survive a runtime restart.",
		);
	}
	const clearedStatus = await request("browser.clear-profile", {});
	if (!clearedStatus.ready || clearedStatus.activeSessions !== 0) {
		throw new Error("Clearing browser data did not relaunch a clean runtime.");
	}
	const afterClear = await command({
		command: "open",
		sessionId: "persistent-cleared",
		url: `${baseUrl}/fixture`,
		mode: "tab",
		timeoutMs: 5_000,
		maxHtmlChars: 100_000,
	});
	const cleared = await command({
		command: "dom-query",
		sessionId: "persistent-cleared",
		tabId: afterClear.surface.tabId,
		selector: "#persist",
		maxResults: 1,
		timeoutMs: 2_000,
		maxHtmlChars: 100_000,
	});
	if (cleared.elements[0]?.value !== "") {
		throw new Error("Clear browser data retained local storage.");
	}
	await request("shutdown", {});
	shutdownRequested = true;
	console.log(
		`Desktop sidecar v3 smoke passed with ${firstStatus.engine} ${firstStatus.engineVersion} and Chromium ${firstStatus.rendererVersion}.`,
	);
} finally {
	if (!shutdownRequested && child.exitCode === null) {
		await request("shutdown", {}).catch(() => {});
	}
	child.stdin.end();
	if (child.exitCode === null) child.kill();
	await new Promise((resolveExit) => {
		if (child.exitCode !== null) {
			resolveExit();
			return;
		}
		const timeout = setTimeout(resolveExit, 10_000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolveExit();
		});
	});
	server.close();
	try {
		rmSync(appData, {
			recursive: true,
			force: true,
			maxRetries: process.platform === "win32" ? 8 : 3,
			retryDelay: 250,
		});
	} catch (error) {
		if (verbose)
			console.warn(`Deferred smoke profile cleanup: ${String(error)}`);
	}
	if (stderr.trim() && !verbose) process.stderr.write(stderr);
}
