import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
	access,
	copyFile,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { VmEgressTransport } from "./vm-egress";
import { VmEgressProxy } from "./vm-network";
import { VmPreview } from "./vm-preview";
import { createSeedIso, seedFiles } from "./vm-seed";
import { VmGuestRestartError, VmRpc } from "./vm-wire";

const exec = promisify(execFile);
export interface VmManifest {
	schemaVersion: 1;
	architecture: "x64" | "arm64";
	image: string;
	imageSha256: string;
	qemu: string;
	qemuImg: string;
	firmware?: string;
}
export class VmRuntimeError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "VmRuntimeError";
	}
}
export const safeResource = (root: string, name: string): string => {
	if (
		!name ||
		isAbsolute(name) ||
		name.includes("\\") ||
		name.split("/").includes("..")
	)
		throw new Error("Invalid sandbox resource path");
	const destination = resolve(root, name);
	if (relative(root, destination).startsWith(".."))
		throw new Error("Sandbox resource leaves bundle");
	return destination;
};

export function qemuArguments(options: {
	manifest: VmManifest;
	runtime: string;
	disk: string;
	seed: string;
	controlPort: number;
	platform?: NodeJS.Platform;
}): string[] {
	const { manifest, runtime, disk, seed, controlPort } = options;
	const platform = options.platform ?? process.platform;
	const accelerator =
		platform === "win32" ? "whpx" : platform === "darwin" ? "hvf" : "kvm";
	const arm = manifest.architecture === "arm64";
	return [
		"-name",
		"memorall-sandbox",
		"-machine",
		`${arm ? "virt" : "q35"},accel=${accelerator}`,
		...(platform === "win32" ? [] : ["-cpu", "host"]),
		"-m",
		"2048",
		"-smp",
		"2",
		"-display",
		"none",
		"-nodefaults",
		"-no-reboot",
		"-L",
		join(runtime, "qemu", "share"),
		...(manifest.firmware
			? ["-bios", safeResource(runtime, manifest.firmware)]
			: []),
		"-drive",
		`file=${disk.replace(/,/g, ",,")},if=virtio,format=qcow2,cache=writeback`,
		"-drive",
		`file=${seed.replace(/,/g, ",,")},if=virtio,format=raw,readonly=on`,
		"-device",
		"virtio-serial-pci",
		"-chardev",
		`socket,id=control,host=127.0.0.1,port=${controlPort},reconnect-ms=1000`,
		"-device",
		"virtserialport,chardev=control,name=app.memorall.control",
		"-object",
		"rng-builtin,id=entropy",
		"-device",
		"virtio-rng-pci,rng=entropy",
		"-nic",
		"none",
		"-serial",
		"stdio",
		"-monitor",
		"none",
	];
}

/** One persistent, installation-local VM, matching the shared documents VFS.
 * Process/session isolation within it is deliberately not advertised as a
 * separate VM per agent. No user code is ever executed on the host.
 */
export class DesktopVmRuntime {
	private child: ChildProcess | null = null;
	private rpc: VmRpc | null = null;
	private connectingRpc: VmRpc | null = null;
	private starting: Promise<VmRpc> | null = null;
	private bootAbort: AbortController | null = null;
	private cleaning: Promise<void> | null = null;
	private proxy = new VmEgressProxy();
	private preview: VmPreview | null = null;
	private egress: VmEgressTransport | null = null;
	private control: ReturnType<typeof createServer> | null = null;
	private bootLog = "";
	private failure: string | null = null;
	private startedAt: number | null = null;
	private stopping = false;
	constructor(
		private readonly runtime = process.env.MEMORALL_VM_RUNTIME_DIR ?? "",
		private readonly data = process.env.MEMORALL_VM_DATA_DIR ??
			join(
				process.env.MEMORALL_DESKTOP_APP_DATA_DIR ?? process.cwd(),
				"sandbox-vm",
			),
	) {}
	status() {
		return {
			ready: this.rpc !== null,
			state: this.stopping
				? "stopping"
				: this.starting
					? "starting"
					: this.rpc
						? "ready"
						: this.failure
							? "unavailable"
							: "stopped",
			failure: this.failure,
			initializedAt: this.startedAt,
			bootLog: this.bootLog,
			network: this.proxy.stats,
		};
	}
	pids(): number[] {
		return this.child?.pid ? [this.child.pid] : [];
	}
	private async start(): Promise<VmRpc> {
		if (this.stopping)
			throw new Error("Sandbox is stopping. Retry after shutdown completes.");
		if (this.cleaning) await this.cleaning;
		if (this.rpc) return this.rpc;
		if (this.starting) return this.starting;
		this.bootAbort = new AbortController();
		this.starting = this.boot(this.bootAbort.signal);
		try {
			return await this.starting;
		} catch (error) {
			this.failure = error instanceof Error ? error.message : String(error);
			await this.cleanup();
			throw error;
		} finally {
			this.starting = null;
			this.bootAbort = null;
		}
	}
	private async boot(signal: AbortSignal): Promise<VmRpc> {
		this.failure = null;
		this.bootLog = "";
		if (!this.runtime)
			throw new VmRuntimeError(
				"SANDBOX_RESOURCES_MISSING",
				"Bundled sandbox resources are missing. Prepare the desktop VM runtime and rebuild the app.",
			);
		const manifest: VmManifest = JSON.parse(
			await readFile(join(this.runtime, "vm-runtime.json"), "utf8"),
		);
		if (
			manifest.schemaVersion !== 1 ||
			!["x64", "arm64"].includes(manifest.architecture) ||
			manifest.architecture !== process.arch
		)
			throw new VmRuntimeError(
				"SANDBOX_ARCHITECTURE",
				"Sandbox image does not match this computer's architecture.",
			);
		const image = safeResource(this.runtime, manifest.image);
		const qemu = safeResource(this.runtime, manifest.qemu);
		const img = safeResource(this.runtime, manifest.qemuImg);
		const hash = createHash("sha256");
		for await (const chunk of createReadStream(image)) hash.update(chunk);
		if (hash.digest("hex") !== manifest.imageSha256)
			throw new VmRuntimeError(
				"SANDBOX_IMAGE_CORRUPT",
				"Bundled Ubuntu image checksum does not match. Reinstall Memorall.",
			);
		await mkdir(this.data, { recursive: true });
		// A backing image must survive application updates. Rebasing a live
		// overlay onto a different Ubuntu build would silently corrupt its disk.
		const baseRecord = join(this.data, "base-image.json");
		const disk = join(this.data, "workspace.qcow2");
		const existingDisk = await access(disk).then(
			() => true,
			() => false,
		);
		let baseHash = manifest.imageSha256;
		try {
			baseHash = JSON.parse(await readFile(baseRecord, "utf8")).sha256;
		} catch (error) {
			if (existingDisk)
				throw new VmRuntimeError(
					"SANDBOX_BASE_INVALID",
					"Existing sandbox is missing readable base image metadata. Restore base-image.json before starting it.",
				);
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new VmRuntimeError(
					"SANDBOX_BASE_INVALID",
					"Sandbox base image metadata is unreadable.",
				);
		}
		if (!/^[a-f0-9]{64}$/.test(baseHash))
			throw new VmRuntimeError(
				"SANDBOX_BASE_INVALID",
				"Sandbox base image metadata is invalid.",
			);
		const base = join(this.data, `ubuntu-${baseHash}.qcow2`);
		try {
			await access(base);
		} catch {
			if (baseHash !== manifest.imageSha256)
				throw new VmRuntimeError(
					"SANDBOX_BASE_MISSING",
					"The workspace's original Ubuntu base image is missing. Restore it before starting the sandbox.",
				);
			await copyFile(image, base + ".partial");
			await rename(base + ".partial", base);
		}
		await writeFile(
			baseRecord + ".partial",
			JSON.stringify({ sha256: baseHash }),
			{ mode: 0o600 },
		);
		await rename(baseRecord + ".partial", baseRecord);
		try {
			await access(disk);
		} catch {
			await exec(
				img,
				["create", "-f", "qcow2", "-F", "qcow2", "-b", base, disk, "20G"],
				{ windowsHide: true, timeout: 30_000 },
			);
		}
		// Rebase only when the installation moved, preserving the pinned base.
		const info = JSON.parse(
			(
				await exec(img, ["info", "--output=json", disk], {
					windowsHide: true,
					timeout: 10_000,
				})
			).stdout,
		);
		if (info["full-backing-filename"] !== base)
			await exec(img, ["rebase", "-u", "-F", "qcow2", "-b", base, disk], {
				windowsHide: true,
				timeout: 10_000,
			});
		const guest = await readFile(join(this.runtime, "guest.py"), "utf8");
		const fingerprint = createHash("sha256").update(guest).digest("hex");
		// Cloud-init must also apply changes to the service and provisioning
		// configuration, even when guest.py itself has not changed.
		const seedFingerprint = createHash("sha256")
			.update(JSON.stringify(seedFiles(guest, "")))
			.digest("hex");
		const seed = join(this.data, "seed.iso");
		await writeFile(
			seed,
			createSeedIso(seedFiles(guest, `memorall-${seedFingerprint}`)),
			{ mode: 0o600 },
		);
		signal.throwIfAborted();
		const proxyPort = await this.proxy.start();
		const control = createServer();
		this.control = control;
		control.maxConnections = 1;
		let connectResolve!: (rpc: VmRpc) => void;
		let connectReject!: (error: Error) => void;
		const connection = new Promise<VmRpc>((resolve, reject) => {
			connectResolve = resolve;
			connectReject = reject;
		});
		control.once("connection", (socket) => {
			const rpc = new VmRpc(socket, true);
			this.connectingRpc = rpc;
			connectResolve(rpc);
		});
		await new Promise<void>((resolve, reject) => {
			control.once("error", reject);
			control.listen(0, "127.0.0.1", resolve);
		});
		signal.throwIfAborted();
		const controlPort = (control.address() as { port: number }).port;
		const child = spawn(
			qemu,
			qemuArguments({
				manifest,
				runtime: this.runtime,
				disk,
				seed,
				controlPort,
			}),
			{
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					LD_LIBRARY_PATH: join(this.runtime, "qemu", "lib"),
					DYLD_LIBRARY_PATH: join(this.runtime, "qemu", "lib"),
				},
			},
		);
		this.child = child;
		for (const output of [child.stdout, child.stderr])
			output?.on("data", (data: Buffer) => {
				this.bootLog = (this.bootLog + data.toString()).slice(-12000);
			});
		child.once("error", (error) => connectReject(error));
		child.once("exit", () => {
			connectReject(
				new VmRuntimeError(
					"SANDBOX_VIRTUALIZATION_UNAVAILABLE",
					`The sandbox VM stopped. Enable ${process.platform === "win32" ? "Windows Hypervisor Platform and CPU virtualization, then restart Windows" : process.platform === "linux" ? "KVM and access to /dev/kvm" : "hardware virtualization"}. ${this.bootLog.slice(-2000)}`,
				),
			);
			if (this.child === child && !this.stopping && !this.starting) {
				this.failure =
					"Sandbox VM exited. Run the command again to restart it.";
				void this.cleanup();
			}
		});
		let timer: ReturnType<typeof setTimeout> | undefined;
		// One shared startup budget covers both the upstream image's first-boot
		// provisioning and a guest service update. Native RPC budgets include it.
		const deadline = Date.now() + 300_000;
		const abort = () => connectReject(new Error("Sandbox startup cancelled"));
		signal.addEventListener("abort", abort, { once: true });
		try {
			signal.throwIfAborted();
			const rpc = await Promise.race([
				connection,
				new Promise<never>((_, reject) => {
					timer = setTimeout(
						() =>
							reject(
								new VmRuntimeError(
									"SANDBOX_BOOT_TIMEOUT",
									`Sandbox did not connect. ${this.bootLog.slice(-2000)}`,
								),
							),
						300_000,
					);
				}),
			]);
			this.egress = new VmEgressTransport(rpc, proxyPort);
			const readHealth = async (budget: number) => {
				try {
					return await rpc.request(
						"health",
						null,
						Math.max(1, Math.min(budget, deadline - Date.now())),
						signal,
					);
				} catch (error) {
					if (error instanceof VmGuestRestartError)
						return { provisioned: false, sourceHash: "" };
					throw error;
				}
			};
			let health = await readHealth(180_000);
			while (
				(!health.provisioned || health.sourceHash !== fingerprint) &&
				Date.now() < deadline
			) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				health = await readHealth(30_000);
			}
			if (!health.provisioned || health.sourceHash !== fingerprint)
				throw new VmRuntimeError(
					"SANDBOX_PROTOCOL_MISMATCH",
					"Sandbox guest update did not complete. Stop and start the sandbox again.",
				);
			rpc.completeBootstrap();
			this.rpc = rpc;
			this.preview = new VmPreview(rpc);
			this.startedAt = Date.now();
			rpc.once("disconnected", () => {
				if (this.rpc === rpc && !this.stopping) {
					this.failure =
						"Sandbox control channel disconnected. Start the sandbox again.";
					void this.cleanup();
				}
			});
			return rpc;
		} finally {
			if (timer) clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		}
	}
	async request(
		operation: string,
		payload: any,
		timeoutMs = 120_000,
		signal?: AbortSignal,
	): Promise<any> {
		if (signal?.aborted) throw new Error("Sandbox request cancelled");
		// Observing or controlling a previous process must never boot a new VM.
		// A renderer can have a poll in flight when the user presses Stop.
		if (
			[
				"runtime.listenCommand",
				"runtime.sendCommandInput",
				"runtime.stopCommand",
				"runtime.listCommands",
				"server.list",
				"server.stop",
				"sync.collect",
				"sync.ack",
			].includes(operation) &&
			(!this.rpc || this.stopping || this.starting)
		)
			throw new Error(
				"Sandbox is stopped or starting. Start the sandbox before accessing running processes.",
			);
		const rpc = await this.start();
		if (signal?.aborted) throw new Error("Sandbox request cancelled");
		if (operation === "server.renderUrl")
			return {
				port: payload.port,
				url: await this.preview!.url(payload.port, payload.path),
			};
		if (operation === "server.start") {
			const result = await rpc.request(
				operation,
				payload,
				Math.max(timeoutMs, 660_000),
				signal,
			);
			const url = await this.preview!.url(result.port);
			return { ...result, url, renderUrl: url };
		}
		if (operation === "server.list") {
			const { ports } = await rpc.request("ports.list");
			return {
				servers: await Promise.all(
					ports.map(async (port: number) => {
						const url = await this.preview!.url(port);
						return {
							port,
							kind: "express",
							url,
							renderUrl: url,
							startedBy: "process",
						};
					}),
				),
			};
		}
		return rpc.request(operation, payload, timeoutMs, signal);
	}
	async stop(): Promise<void> {
		this.stopping = true;
		this.bootAbort?.abort();
		try {
			await this.starting?.catch(() => undefined);
			await this.cleanup();
			this.failure = null;
		} finally {
			this.stopping = false;
		}
	}
	private async cleanup(): Promise<void> {
		if (this.cleaning) return this.cleaning;
		this.cleaning = this.cleanupResources();
		try {
			await this.cleaning;
		} finally {
			this.cleaning = null;
		}
	}
	private async cleanupResources(): Promise<void> {
		if (this.stopping && this.rpc) {
			await this.rpc
				.request("runtime.shutdown", null, 10_000)
				.catch(() => undefined);
			const child = this.child;
			if (child && child.exitCode === null && child.signalCode === null)
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 10_000);
					child.once("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				});
		}
		const rpc = this.rpc;
		this.rpc = null;
		rpc?.close();
		this.connectingRpc?.close();
		this.connectingRpc = null;
		await this.preview?.stop();
		this.preview = null;
		this.egress?.stop();
		this.egress = null;
		const child = this.child;
		this.child = null;
		child?.kill();
		if (child && child.exitCode === null && child.signalCode === null)
			await new Promise<void>((resolve) => {
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					resolve();
				}, 3_000);
				child.once("exit", () => {
					clearTimeout(timer);
					resolve();
				});
			});
		this.control?.close();
		this.control = null;
		await this.proxy.stop();
		this.startedAt = null;
	}
}
