import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const harnessRoot = path.join(root, "packages", "agent-harness");
const output = path.join(os.tmpdir(), "memorall-agent-harness-packs");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const workspaces = [];
for (const entry of await readdir(harnessRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = path.join(harnessRoot, entry.name, "package.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.name) workspaces.push(manifest);
  } catch {
    // Non-workspace directory.
  }
}

for (const manifest of workspaces) {
  const fileName = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  const target = path.join(output, fileName);
  execFileSync("yarn", ["workspace", manifest.name, "pack", "--out", target], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const listing = execFileSync("tar", ["-tf", target], { encoding: "utf8" });
  for (const required of ["package/package.json", "package/dist/index.js", "package/dist/index.d.ts"]) {
    if (!listing.split(/\r?\n/).includes(required)) {
      throw new Error(`${manifest.name} tarball is missing ${required}`);
    }
  }
  if (listing.split(/\r?\n/).some((name) => name.startsWith("package/src/"))) {
    throw new Error(`${manifest.name} tarball contains private source files`);
  }
  if (listing.split(/\r?\n/).some((name) => name.endsWith(".tsbuildinfo"))) {
    throw new Error(`${manifest.name} tarball contains TypeScript build metadata`);
  }
}

console.log(`Packed and inspected ${workspaces.length} workspaces in ${output}`);
