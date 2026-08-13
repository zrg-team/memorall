import { copyFile, mkdir, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const triples = {
	"win32-x64": "x86_64-pc-windows-msvc",
	"win32-arm64": "aarch64-pc-windows-msvc",
	"darwin-x64": "x86_64-apple-darwin",
	"darwin-arm64": "aarch64-apple-darwin",
	"linux-x64": "x86_64-unknown-linux-gnu",
	"linux-arm64": "aarch64-unknown-linux-gnu",
};
const key = `${process.platform}-${process.arch}`;
const triple = triples[key];
if (!triple) throw new Error(`Unsupported desktop target: ${key}`);

const extension = process.platform === "win32" ? ".exe" : "";
const destination = resolve(
	process.cwd(),
	`publish/.cache/tauri-sidecars/memorall-node-${triple}${extension}`,
);
await mkdir(dirname(destination), { recursive: true });
await copyFile(process.execPath, destination);
if (process.platform !== "win32") await chmod(destination, 0o755);
console.log(`Staged real Node ${process.version} runtime at ${destination}`);
