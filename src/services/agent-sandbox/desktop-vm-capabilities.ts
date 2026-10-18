import type { SandboxCapabilities } from "@memorall/agent-harness-sandbox";

export const DESKTOP_VM_PROVIDER_ID = "desktop-vm";
export const DESKTOP_VM_CAPABILITIES: SandboxCapabilities = {
	supported: [
		"runtime.code",
		"runtime.file",
		"runtime.command",
		"process.background",
		"process.stdin",
		"packages.install",
		"packages.manifest",
		"preview.start",
		"preview.request",
		"network.fetch",
		"workspace.mount",
		"workspace.flush",
	],
	packageManagers: ["npm"],
	limits: {
		maxConcurrentSessions: 1,
		maxOutputChars: 100_000,
		maxLogEntries: 500,
	},
	extensions: {
		runtime: "qemu-ubuntu-minimal",
		browserNative: false,
		ptyResize: false,
		python: {
			runtime: "native",
			packages: [],
			summary:
				"System Python 3; install project dependencies in a virtual environment.",
			notes: [
				"py invokes system python3; python/pip set up a persistent virtual environment on first use.",
			],
		},
		commands: [
			{
				names: [
					"node",
					"npm",
					"npx",
					"git",
					"ffmpeg",
					"ffprobe",
					"magick",
					"pip",
					"gcc",
					"make",
				],
				summary:
					"Real Linux tools, installed inside the VM when first invoked.",
				notes: [
					"First use requires internet and streams installation progress. Installed tools persist across app restarts.",
				],
			},
		],
		notes: [
			"Commands run in a hardware-virtualized Ubuntu Linux VM, never on the host. Shell pipelines, native packages and background processes are supported.",
			"The installation shares one VM and documents workspace between agents and memonOS; these are not separate per-agent security boundaries.",
			"Public HTTP/HTTPS uses a host-enforced proxy. Host services, private networks and direct outbound sockets are blocked. Use localhost for servers inside the guest.",
			"One preview origin per server, with WebSocket forwarding. Persistent REPL and snapshots are not available.",
			"Workspace files synchronize in bounded binary batches, up to 16 MiB per file; node_modules, .git and local caches remain inside the guest. Larger files remain guest-local.",
		],
	},
};
