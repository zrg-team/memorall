import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
	access,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { BrowserSettings } from "./browser-runtime-types";
import { BrowserAutomationError } from "./browser-runtime-types";

const trace = (message: string): void => {
	if (process.env.MEMORALL_SMOKE_VERBOSE === "1")
		process.stderr.write(`[managed-browser] ${message}\n`);
};

export interface RuntimeConnection {
	// Absent on targets whose packaged browser speaks standard CDP only.
	endpoint?: string;
	token?: string;
	cdpEndpoint?: string;
}

// The BrowserOS server drives its browser through CDP extensions that only the
// BrowserOS Chromium build implements, and it exits rather than run without
// them. browser-runtime.lock.json records which packaged browser can serve that
// protocol; the desktop host forwards the pinned target's capability here.
const browserOsAutomationSupported = (): boolean =>
	(process.env.MEMORALL_BROWSER_AUTOMATION ??
		(process.platform === "win32" ? "browseros-and-cdp" : "cdp")) ===
	"browseros-and-cdp";

const freePort = async (): Promise<number> =>
	await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to reserve a loopback port."));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});

// Managed processes are otherwise silent, so their own diagnostics are the only
// way to explain a start-up failure on a machine we cannot attach to.
const captureDiagnostics = (child: ChildProcess): (() => string) => {
	let buffer = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		buffer = `${buffer}${chunk}`.slice(-2_000);
	});
	return () => buffer.trim();
};

const waitForPort = async (
	port: number,
	child: ChildProcess,
	label: string,
	diagnostics: () => string,
	timeoutMs = 20_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			const output = diagnostics();
			throw new Error(
				`Managed ${label} exited with code ${String(child.exitCode)}.${
					output ? ` Output: ${output}` : ""
				}`,
			);
		}
		const ready = await new Promise<boolean>((resolve) => {
			const socket = connect({ host: "127.0.0.1", port });
			const settle = (value: boolean) => {
				socket.destroy();
				resolve(value);
			};
			socket.once("connect", () => settle(true));
			socket.once("error", () => settle(false));
			socket.setTimeout(250, () => settle(false));
		});
		if (ready) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const output = diagnostics();
	throw new Error(
		`Timed out waiting for the managed ${label} on loopback port ${port}.${
			output ? ` Output: ${output}` : ""
		}`,
	);
};

const hasExited = (child: ChildProcess): boolean =>
	child.exitCode !== null || child.signalCode !== null;

const waitForExit = async (
	child: ChildProcess,
	timeoutMs: number,
): Promise<boolean> => {
	if (hasExited(child)) return true;
	return await new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
};

// Chromium only writes localStorage, cookies and preferences out to a
// persistent profile during an orderly shutdown, and the runtime reuses that
// same profile directory the moment it restarts. Killing the process instead
// silently discards whatever had not been flushed yet, so ask the browser to
// close itself first and fall back to signals only when it will not.
const closeBrowserGracefully = async (
	child: ChildProcess,
	cdpEndpoint: string | undefined,
): Promise<boolean> => {
	if (hasExited(child)) return true;
	if (!cdpEndpoint) return false;
	let socket: WebSocket | undefined;
	try {
		const response = await fetch(`${cdpEndpoint}/json/version`, {
			signal: AbortSignal.timeout(2_000),
		});
		const { webSocketDebuggerUrl } = (await response.json()) as {
			webSocketDebuggerUrl?: string;
		};
		if (!webSocketDebuggerUrl) return false;
		socket = new WebSocket(webSocketDebuggerUrl);
		const opened = socket;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("CDP shutdown socket timed out.")),
				3_000,
			);
			opened.addEventListener(
				"open",
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
			opened.addEventListener(
				"error",
				() => {
					clearTimeout(timer);
					reject(new Error("CDP shutdown socket failed."));
				},
				{ once: true },
			);
		});
		opened.send(JSON.stringify({ id: 1, method: "Browser.close", params: {} }));
		const exited = await waitForExit(child, 10_000);
		trace(`graceful browser shutdown ${exited ? "completed" : "timed out"}`);
		return exited;
	} catch (error) {
		trace(`graceful browser shutdown unavailable: ${String(error)}`);
		return false;
	} finally {
		try {
			socket?.close();
		} catch {
			// The socket is already gone once the browser exits.
		}
	}
};

const terminateTree = async (child: ChildProcess | null): Promise<void> => {
	if (!child || hasExited(child) || !child.pid) return;
	if (process.platform === "win32") {
		await new Promise<void>((resolve) => {
			const killer = spawn(
				"taskkill",
				["/PID", String(child.pid), "/T", "/F"],
				{
					stdio: "ignore",
					windowsHide: true,
				},
			);
			const timeout = setTimeout(() => {
				killer.kill();
				resolve();
			}, 5_000);
			killer.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
			killer.once("error", () => {
				clearTimeout(timeout);
				child.kill();
				resolve();
			});
		});
		await waitForExit(child, 5_000);
		return;
	}
	try {
		process.kill(-child.pid, "SIGTERM");
	} catch {
		child.kill("SIGTERM");
	}
	// A restart reuses the profile directory, so the old process has to be gone
	// before the next one claims it.
	if (await waitForExit(child, 5_000)) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
	await waitForExit(child, 2_000);
};

const terminateWindowsPath = async (
	targetPath: string | null,
	includeDescendants = false,
): Promise<void> => {
	if (process.platform !== "win32" || !targetPath) return;
	const script = String.raw`
& {
  $target = [System.IO.Path]::GetFullPath($env:MEMORALL_MANAGED_PROCESS_PATH)
  $prefix = $target.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $includeDescendants = $env:MEMORALL_MANAGED_PROCESS_DESCENDANTS -eq '1'
  Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      if (-not $_.Path) { return $false }
      $candidate = [System.IO.Path]::GetFullPath($_.Path)
      $candidate.Equals($target, [System.StringComparison]::OrdinalIgnoreCase) -or
        ($includeDescendants -and $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase))
    } catch { $false }
  } | Stop-Process -Force -ErrorAction SilentlyContinue
}`;
	await new Promise<void>((resolve) => {
		const killer = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
			{
				stdio: "ignore",
				windowsHide: true,
				env: {
					...process.env,
					MEMORALL_MANAGED_PROCESS_PATH: targetPath,
					MEMORALL_MANAGED_PROCESS_DESCENDANTS: includeDescendants ? "1" : "0",
				},
			},
		);
		const timeout = setTimeout(() => {
			killer.kill();
			resolve();
		}, 5_000);
		killer.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
		killer.once("error", () => {
			clearTimeout(timeout);
			resolve();
		});
	});
};

const removeDirectoryInBackground = (directory: string): void => {
	if (process.platform !== "win32") {
		void rm(directory, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 250,
		}).catch(() => {});
		return;
	}
	const cleanup = spawn(
		"powershell.exe",
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Start-Sleep -Milliseconds 500; Remove-Item -LiteralPath $env:MEMORALL_RETIRED_BROWSER_PROFILE -Recurse -Force -ErrorAction SilentlyContinue",
		],
		{
			stdio: "ignore",
			windowsHide: true,
			detached: true,
			env: { ...process.env, MEMORALL_RETIRED_BROWSER_PROFILE: directory },
		},
	);
	cleanup.unref();
};

const removeEphemeralProfile = (profileDirectory: string): void => {
	const temporaryRoot = `${resolve(tmpdir())}${sep}`.toLowerCase();
	const target = resolve(profileDirectory);
	if (
		!target.toLowerCase().startsWith(temporaryRoot) ||
		!target.toLowerCase().includes(`${sep}memorall-browseros-`)
	) {
		trace(`refused to remove unexpected ephemeral profile path: ${target}`);
		return;
	}
	removeDirectoryInBackground(target);
};

export class ManagedBrowserOsRuntime {
	private browser: ChildProcess | null = null;
	private server: ChildProcess | null = null;
	private connection: RuntimeConnection | null = null;
	private profileDirectory: string | null = null;
	private browserExecutable: string | null = null;
	private serverExecutable: string | null = null;
	private starting: Promise<RuntimeConnection> | null = null;

	constructor(
		private readonly appDataDirectory: string,
		private readonly settings: () => BrowserSettings,
	) {}

	async ensure(): Promise<RuntimeConnection> {
		const externalEndpoint = process.env.MEMORALL_BROWSEROS_MCP_URL;
		if (externalEndpoint) {
			return {
				endpoint: externalEndpoint,
				token: process.env.MEMORALL_BROWSEROS_TOKEN,
				cdpEndpoint: process.env.MEMORALL_BROWSEROS_CDP_URL,
			};
		}
		if (
			this.connection &&
			this.browser?.exitCode === null &&
			(!browserOsAutomationSupported() || this.server?.exitCode === null)
		) {
			return this.connection;
		}
		if (!this.starting) this.starting = this.startManaged();
		try {
			return await this.starting;
		} finally {
			this.starting = null;
		}
	}

	async stop(): Promise<void> {
		const server = this.server;
		const browser = this.browser;
		const cdpEndpoint = this.connection?.cdpEndpoint;
		this.server = null;
		this.browser = null;
		this.connection = null;
		trace("terminating BrowserOS server");
		await terminateTree(server);
		if (browser) {
			trace("closing the managed browser");
			await closeBrowserGracefully(browser, cdpEndpoint);
		}
		trace("terminating Chromium root process");
		await terminateTree(browser);
		trace("terminating remaining exact-path Chromium children");
		await terminateWindowsPath(
			this.browserExecutable ? dirname(this.browserExecutable) : null,
			true,
		);
		trace("terminating remaining exact-path BrowserOS server processes");
		await terminateWindowsPath(this.serverExecutable);
		trace("managed processes terminated");
		this.browserExecutable = null;
		this.serverExecutable = null;
		if (this.profileDirectory && !this.settings().persistProfile) {
			// Recursive cache deletion can take tens of seconds on Windows. A
			// detached, exact-path helper lets settings restarts continue and avoids
			// keeping the sidecar event loop alive during app shutdown.
			removeEphemeralProfile(this.profileDirectory);
		}
		this.profileDirectory = null;
	}

	async clearPersistentProfile(): Promise<void> {
		const profile = resolve(this.appDataDirectory, "browser-profile");
		const appDataRoot = `${resolve(this.appDataDirectory)}${sep}`.toLowerCase();
		if (!profile.toLowerCase().startsWith(appDataRoot)) {
			throw new BrowserAutomationError(
				"PROFILE_PATH_INVALID",
				"Managed browser profile resolved outside the application data directory.",
			);
		}
		const retired = resolve(
			this.appDataDirectory,
			`browser-profile.deleted-${Date.now()}-${randomBytes(6).toString("hex")}`,
		);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			try {
				await rename(profile, retired);
				removeDirectoryInBackground(retired);
				return;
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String(error.code)
						: "";
				if (code === "ENOENT") return;
				if (!["EBUSY", "EPERM", "EACCES"].includes(code) || attempt === 19) {
					throw error;
				}
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
			}
		}
	}

	private async startManaged(): Promise<RuntimeConnection> {
		await this.stop();
		const browserPath = process.env.MEMORALL_BROWSEROS_BROWSER_PATH;
		const serverPath = process.env.MEMORALL_BROWSEROS_SERVER_PATH;
		if (!browserPath || !serverPath) {
			throw new BrowserAutomationError(
				"BROWSEROS_RESOURCES_MISSING",
				"BrowserOS runtime paths were not provided by the desktop host.",
			);
		}
		try {
			await Promise.all([access(browserPath), access(serverPath)]);
		} catch {
			throw new BrowserAutomationError(
				"BROWSEROS_RESOURCES_MISSING",
				`Bundled BrowserOS resources are missing (${browserPath}, ${serverPath}).`,
			);
		}
		const settings = this.settings();
		this.browserExecutable = browserPath;
		this.serverExecutable = serverPath;
		const profileDirectory = settings.persistProfile
			? join(this.appDataDirectory, "browser-profile")
			: await mkdtemp(join(tmpdir(), "memorall-browseros-"));
		this.profileDirectory = profileDirectory;
		await mkdir(profileDirectory, { recursive: true });
		const manageServer = browserOsAutomationSupported();
		const [serverPort, cdpPort] = await Promise.all([freePort(), freePort()]);
		const token = randomBytes(32).toString("hex");
		const configPath = join(this.appDataDirectory, "browseros", "server.json");
		if (manageServer) {
			await mkdir(dirname(configPath), { recursive: true });
			await writeFile(
				configPath,
				JSON.stringify({
					ports: { server: serverPort, cdp: cdpPort },
					directories: {
						resources: join(dirname(serverPath), "resources"),
					},
					flags: { devMode: false },
					auth: { token },
					replay: { retentionDays: 1 },
				}),
				"utf8",
			);
		}
		const detached = process.platform !== "win32";
		const browser = spawn(
			browserPath,
			[
				`--remote-debugging-port=${cdpPort}`,
				"--remote-debugging-address=127.0.0.1",
				`--user-data-dir=${profileDirectory}`,
				"--no-first-run",
				"--disable-default-apps",
				"--deny-permission-prompts",
				"--window-size=1280,800",
				"--force-device-scale-factor=1",
				...(process.env.MEMORALL_BROWSER_DISABLE_SANDBOX === "1"
					? ["--no-sandbox"]
					: []),
				...(settings.visible ? [] : ["--headless=new", "--disable-gpu"]),
			],
			{ stdio: ["ignore", "ignore", "pipe"], windowsHide: true, detached },
		);
		this.browser = browser;
		try {
			await waitForPort(
				cdpPort,
				browser,
				"browser process",
				captureDiagnostics(browser),
			);
			if (!manageServer) {
				this.connection = { cdpEndpoint: `http://127.0.0.1:${cdpPort}` };
				return this.connection;
			}
			const server = spawn(serverPath, ["--config", configPath], {
				stdio: ["ignore", "ignore", "pipe"],
				windowsHide: true,
				detached,
				env: {
					...process.env,
					BROWSERCLAW_DIR: join(this.appDataDirectory, "browseros"),
				},
			});
			this.server = server;
			await waitForPort(
				serverPort,
				server,
				"BrowserOS server",
				captureDiagnostics(server),
			);
			this.connection = {
				endpoint: `http://127.0.0.1:${serverPort}/mcp`,
				token,
				cdpEndpoint: `http://127.0.0.1:${cdpPort}`,
			};
			return this.connection;
		} catch (error) {
			await this.stop();
			throw new BrowserAutomationError(
				"BROWSEROS_START_FAILED",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	getCdpEndpoint(): string | undefined {
		return (
			this.connection?.cdpEndpoint ?? process.env.MEMORALL_BROWSEROS_CDP_URL
		);
	}
}
