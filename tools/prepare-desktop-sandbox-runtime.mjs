import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
	readFileSync(join(root, "apps/desktop/sandbox-runtime.lock.json"), "utf8"),
);
const cache = join(root, "publish/.cache/sandbox-downloads");
const output = join(root, "publish/.cache/tauri-resources/sandbox-runtime");
const target = `${process.platform}-${process.arch}`;
const image = lock.ubuntu.targets[process.arch];
if (!image)
	throw new Error(`Unsupported sandbox architecture: ${process.arch}`);
mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
const hashFile = async (path) => {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
};
async function download(url, name, expected) {
	const path = join(cache, name);
	if (existsSync(path) && (await hashFile(path)) === expected) return path;
	console.log(`Downloading sandbox resource: ${name}`);
	const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
	if (!response.ok || !response.body)
		throw new Error(`Download failed (${response.status}): ${url}`);
	const partial = path + ".partial";
	await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
	if ((await hashFile(partial)) !== expected) {
		await rm(partial, { force: true });
		throw new Error(`Checksum mismatch: ${name}`);
	}
	await rename(partial, path);
	return path;
}
function run(command, args) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		windowsHide: true,
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`${command} failed: ${result.error?.message ?? result.stderr}`,
		);
	return result.stdout;
}
function files(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? files(join(dir, entry.name))
			: [join(dir, entry.name)],
	);
}

const asset = lock.qemu.targets[target];
let qemuSource = process.env.MEMORALL_QEMU_DIR;
if (!qemuSource && asset) {
	const archive = await download(
		lock.qemu.baseUrl + asset.file,
		asset.file,
		asset.sha256,
	);
	qemuSource = join(cache, `${target}-${asset.sha256.slice(0, 16)}`);
	if (!existsSync(join(qemuSource, ".complete"))) {
		mkdirSync(qemuSource, { recursive: true });
		run("tar", ["-xf", archive, "-C", qemuSource]);
		writeFileSync(join(qemuSource, ".complete"), asset.sha256);
	}
}
if (!qemuSource && process.platform === "darwin" && process.arch === "x64") {
	// The portable upstream does not publish Intel Mac artifacts. Build-time
	// Homebrew is allowed; its binaries and transitive dylibs are bundled below.
	qemuSource = run("brew", ["--prefix", "qemu"]).trim();
}
if (!qemuSource || !existsSync(qemuSource))
	throw new Error(
		`QEMU is missing for ${target}. Set MEMORALL_QEMU_DIR to a complete native QEMU distribution before building.`,
	);
qemuSource = resolve(qemuSource);
const sourceFiles = files(qemuSource);
const suffix = process.platform === "win32" ? ".exe" : "";
const systemName = `qemu-system-${process.arch === "arm64" ? "aarch64" : "x86_64"}${suffix}`;
const system = sourceFiles.find((path) => basename(path) === systemName);
const img = sourceFiles.find((path) => basename(path) === `qemu-img${suffix}`);
if (!system || !img)
	throw new Error(
		`QEMU distribution must contain ${systemName} and qemu-img${suffix}`,
	);
const nativeOutput = join(output, "qemu");
if (
	relative(root, nativeOutput).replaceAll("\\", "/") !==
	"publish/.cache/tauri-resources/sandbox-runtime/qemu"
)
	throw new Error("Unsafe QEMU staging directory");
await rm(nativeOutput, { recursive: true, force: true });
mkdirSync(join(nativeOutput, "bin"), { recursive: true });
mkdirSync(join(nativeOutput, "lib"), { recursive: true });
mkdirSync(join(nativeOutput, "share"), { recursive: true });
for (const binary of [system, img]) {
	cpSync(binary, join(nativeOutput, "bin", basename(binary)));
	if (process.platform !== "win32")
		chmodSync(join(nativeOutput, "bin", basename(binary)), 0o755);
}
for (const path of sourceFiles) {
	const name = basename(path);
	const windowsSystemLibrary =
		process.platform === "win32" &&
		(/^(api-ms-|ext-ms-)/i.test(name) ||
			existsSync(
				join(process.env.SYSTEMROOT ?? "C:/Windows", "System32", name),
			));
	if (/\.(dll|dylib|so(?:\.\d+)*)$/i.test(name) && !windowsSystemLibrary)
		cpSync(
			path,
			join(nativeOutput, process.platform === "win32" ? "bin" : "lib", name),
			{ dereference: true },
		);
	const firmwareNames =
		process.arch === "arm64"
			? ["edk2-aarch64-code.fd"]
			: [
					"bios.bin",
					"bios-256k.bin",
					"bios-microvm.bin",
					"kvmvapic.bin",
					"linuxboot_dma.bin",
					"pvh.bin",
				];
	if (firmwareNames.includes(name))
		cpSync(path, join(nativeOutput, "share", name));
	if (/^(COPYING|LICENSE|NOTICE|BUILD-INFO)/i.test(basename(path))) {
		const destination = join(
			nativeOutput,
			"licenses",
			relative(qemuSource, path),
		);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(path, destination);
	}
}
if (process.platform === "darwin") {
	const pending = [
		join(nativeOutput, "bin", systemName),
		join(nativeOutput, "bin", `qemu-img${suffix}`),
		...files(join(nativeOutput, "lib")),
	];
	const seen = new Set();
	while (pending.length) {
		const binary = pending.shift();
		if (seen.has(binary)) continue;
		seen.add(binary);
		const dependencies = run("otool", ["-L", binary])
			.split("\n")
			.slice(1)
			.map((line) => line.trim().split(" ")[0])
			.filter(
				(path) =>
					path?.startsWith("/") &&
					!path.startsWith("/usr/lib/") &&
					!path.startsWith("/System/"),
			);
		for (const dependency of dependencies) {
			const dest = join(nativeOutput, "lib", basename(dependency));
			if (!existsSync(dest)) {
				cpSync(dependency, dest, { dereference: true });
				pending.push(dest);
			}
			run("install_name_tool", [
				"-change",
				dependency,
				`@executable_path/../lib/${basename(dependency)}`,
				binary,
			]);
		}
	}
	const entitlements = join(cache, "qemu-entitlements.plist");
	writeFileSync(
		entitlements,
		'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.hypervisor</key><true/></dict></plist>',
	);
	for (const binary of seen)
		run("codesign", [
			"--force",
			"--sign",
			process.env.MEMORALL_QEMU_SIGN_IDENTITY ?? "-",
			"--entitlements",
			entitlements,
			binary,
		]);
}

const baseImage = await download(
	lock.ubuntu.baseUrl + image.file,
	image.file,
	image.sha256,
);
const imageOut = join(output, "ubuntu-minimal.qcow2");
if (!existsSync(imageOut) || (await hashFile(imageOut)) !== image.sha256)
	cpSync(baseImage, imageOut);
cpSync(
	join(root, "apps/desktop/sidecar/guest/guest.py"),
	join(output, "guest.py"),
);
const firmware =
	process.arch === "arm64" ? "qemu/share/edk2-aarch64-code.fd" : undefined;
if (firmware && !existsSync(join(output, firmware)))
	throw new Error("Arm64 QEMU bundle is missing its UEFI firmware");
writeFileSync(
	join(output, "vm-runtime.json"),
	JSON.stringify(
		{
			schemaVersion: 1,
			architecture: process.arch,
			image: "ubuntu-minimal.qcow2",
			imageSha256: image.sha256,
			imageRelease: lock.ubuntu.release,
			qemu: `qemu/bin/${systemName}`,
			qemuImg: `qemu/bin/qemu-img${suffix}`,
			firmware,
		},
		null,
		2,
	) + "\n",
);
cpSync(
	join(root, "apps/desktop/sandbox-runtime.lock.json"),
	join(output, "sandbox-runtime.lock.json"),
);
writeFileSync(
	join(output, "THIRD_PARTY_NOTICES.txt"),
	`Memorall Linux sandbox\nQEMU ${lock.qemu.version} (GPL-2.0)\nCorresponding source: ${lock.qemu.source}\nPortable build source: ${lock.qemu.builderSource}\nUbuntu Minimal ${lock.ubuntu.release}: ${lock.ubuntu.baseUrl}\nUbuntu packages retain their respective licenses in /usr/share/doc inside the image.\n`,
);
const env = {
	...process.env,
	LD_LIBRARY_PATH: join(nativeOutput, "lib"),
	DYLD_LIBRARY_PATH: join(nativeOutput, "lib"),
};
for (const binary of [systemName, `qemu-img${suffix}`]) {
	const result = spawnSync(join(nativeOutput, "bin", binary), ["--version"], {
		encoding: "utf8",
		env,
		windowsHide: true,
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`Bundled ${binary} is not executable: ${result.error?.message ?? result.stderr}`,
		);
}
const total = files(output).reduce((sum, path) => sum + statSync(path).size, 0);
console.log(
	`Staged bundled Ubuntu Minimal and QEMU for ${target}: ${(total / 1024 / 1024).toFixed(1)} MiB. Tools install inside the guest on first use.`,
);
