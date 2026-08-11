import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const harnessRoot = path.join(root, "packages", "agent-harness");
const packageNames = [
  "core",
  "langgraph",
  "standard",
  "sandbox",
  "mcp",
  "browser",
  "node",
  "compatibility",
  "full",
];
const universal = new Set([
  "core",
  "langgraph",
  "standard",
  "sandbox",
  "mcp",
  "compatibility",
  "full",
]);
const nodeBuiltins = new Set([
  "assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events",
  "fs", "http", "https", "module", "net", "os", "path", "perf_hooks", "process",
  "readline", "stream", "timers", "tls", "tty", "url", "util", "vm", "worker_threads",
  "zlib",
]);

const filesUnder = async (directory) => {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await filesUnder(target)));
    else output.push(target);
  }
  return output;
};

const packageNameOf = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

const errors = [];
const versions = new Set();

const rootManifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const umbrellaManifest = JSON.parse(await readFile(path.join(harnessRoot, "package.json"), "utf8"));
const requireScript = (manifest, owner, name, fragments = []) => {
  const script = manifest.scripts?.[name];
  if (typeof script !== "string" || script.length === 0) {
    errors.push(`${owner}: missing ${name} script`);
    return;
  }
  for (const fragment of fragments) {
    if (!script.includes(fragment)) errors.push(`${owner}: ${name} must include ${fragment}`);
  }
};

for (const workspacePath of ["packages/agent-harness", "packages/agent-harness/*"]) {
  if (!rootManifest.workspaces?.includes(workspacePath)) {
    errors.push(`root: missing Yarn workspace ${workspacePath}`);
  }
}
requireScript(rootManifest, "root", "prepare:dev", ["harness:build"]);
requireScript(rootManifest, "root", "dev", ["prepare:dev", "harness:watch", "extension:dev"]);
requireScript(rootManifest, "root", "dev:no-reload", [
  "prepare:dev",
  "harness:watch",
  "extension:dev:no-reload",
]);
requireScript(rootManifest, "root", "harness:watch", ["tsc -b", "--watch"]);
requireScript(rootManifest, "root", "watch", ["yarn dev"]);
requireScript(rootManifest, "root", "package", ["harness:build"]);
for (const name of ["build", "build:prod", "build:chrome", "build:edge", "build:firefox", "build:all"]) {
  requireScript(rootManifest, "root", name, ["prepare:build"]);
}
for (const name of ["build", "clean", "dev", "watch", "typecheck", "test"]) {
  requireScript(umbrellaManifest, "agent-harness workspace", name);
}
requireScript(umbrellaManifest, "agent-harness workspace", "dev", ["tsc -b", "--watch"]);
requireScript(umbrellaManifest, "agent-harness workspace", "watch", ["yarn dev"]);

const isRuntimeGlobalUse = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
    (ts.isElementAccessExpression(parent) && parent.expression === node) ||
    (ts.isCallExpression(parent) && parent.expression === node) ||
    (ts.isNewExpression(parent) && parent.expression === node) ||
    parent.kind === ts.SyntaxKind.TypeOfExpression
  );
};

for (const workspace of packageNames) {
  const workspaceRoot = path.join(harnessRoot, workspace);
  const manifest = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
  versions.add(manifest.version);
  if (manifest.private !== true) errors.push(`${workspace}: package must remain private`);
  if (manifest.sideEffects !== false) errors.push(`${workspace}: sideEffects must be false`);
  if (manifest.type !== "module") errors.push(`${workspace}: package must be ESM`);
  if (!manifest.exports?.["."]) errors.push(`${workspace}: missing explicit root export`);
  for (const name of ["build", "clean", "dev", "watch", "typecheck", "test", "pack"]) {
    requireScript(manifest, workspace, name);
  }
  requireScript(manifest, workspace, "dev", ["tsc -b", "--watch"]);
  requireScript(manifest, workspace, "watch", ["yarn dev"]);
  for (const [subpath, conditions] of Object.entries(manifest.exports ?? {})) {
    if (!conditions || typeof conditions !== "object") {
      errors.push(`${workspace}: export ${subpath} must use an explicit condition map`);
      continue;
    }
    const keys = Object.keys(conditions);
    if (keys[0] !== "types") errors.push(`${workspace}: export ${subpath} must put types first`);
    for (const condition of ["types", "import", "default"]) {
      if (typeof conditions[condition] !== "string") {
        errors.push(`${workspace}: export ${subpath} is missing ${condition}`);
      }
    }
    if ("require" in conditions) errors.push(`${workspace}: CommonJS export is not supported`);
  }
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  if (workspace !== "compatibility" && declared.has("@memorall/agent-harness-compat")) {
    errors.push(`${workspace}: normal packages cannot depend on compatibility`);
  }

  const sourceFiles = (await filesUnder(path.join(workspaceRoot, "src"))).filter(
    (file) => file.endsWith(".ts") && !file.includes(`${path.sep}__tests__${path.sep}`),
  );
  for (const file of sourceFiles) {
    const sourceText = await readFile(file, "utf8");
    const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    const relative = path.relative(root, file);
    const locallyDeclared = new Set();
    const collectDeclarations = (node) => {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) || ts.isImportClause(node) || ts.isImportSpecifier(node)) &&
        node.name && ts.isIdentifier(node.name)
      ) {
        locallyDeclared.add(node.name.text);
      }
      ts.forEachChild(node, collectDeclarations);
    };
    collectDeclarations(source);
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const value = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : undefined;
        if (value) {
          if (value.startsWith("@/") || value.startsWith("flow-") || value.includes("/src/")) {
            errors.push(`${relative}: forbidden application import ${value}`);
          }
          if (!value.startsWith(".") && !value.startsWith("node:")) {
            const packageName = packageNameOf(value);
            if (!declared.has(packageName)) errors.push(`${relative}: undeclared dependency ${packageName}`);
            if (packageName === "@memorall/agent-harness") {
              errors.push(`${relative}: leaf packages cannot import the full facade`);
            }
          }
          const builtin = value.startsWith("node:") ? value.slice(5).split("/")[0] : value.split("/")[0];
          if ((universal.has(workspace) || workspace === "browser") && nodeBuiltins.has(builtin)) {
            errors.push(`${relative}: Node built-in ${value} is forbidden in ${workspace}`);
          }
        }
      }
      if (ts.isIdentifier(node)) {
        const forbidden = universal.has(workspace)
          ? new Set(["window", "document", "DOMParser", "HTMLElement", "chrome", "process", "Buffer"])
          : workspace === "browser"
            ? new Set(["chrome", "process", "Buffer"])
            : workspace === "node"
              ? new Set(["window", "document", "DOMParser", "HTMLElement", "chrome"])
              : new Set();
        if (forbidden.has(node.text) && !locallyDeclared.has(node.text) && isRuntimeGlobalUse(node)) {
          errors.push(`${relative}: forbidden runtime global ${node.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

if (versions.size !== 1) errors.push(`Harness package versions are not lockstep: ${[...versions].join(", ")}`);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Agent harness boundaries and development scripts passed for ${packageNames.length} packages.`);
}
