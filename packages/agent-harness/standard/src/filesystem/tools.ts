import { minimatch } from "minimatch";
import { z } from "zod";
import type { BaseTool, HarnessPlugin } from "@memorall/agent-harness-core";
import { FILESYSTEM_SERVICE, type HarnessFileSystem } from "./contracts.js";

const normalizePath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/").replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const joinPath = (base: string, name: string): string =>
  normalizePath(`${base.replace(/\/$/, "")}/${name}`);

const readText = (fs: HarnessFileSystem, path: string): Promise<string> =>
  fs.readFile(normalizePath(path), { encoding: "utf8" });

const walkFiles = async (
  fs: HarnessFileSystem,
  root: string,
  maxResults: number,
): Promise<string[]> => {
  const output: string[] = [];
  const queue = [normalizePath(root)];
  while (queue.length && output.length < maxResults) {
    const directory = queue.shift()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = joinPath(directory, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile()) output.push(target);
      if (output.length >= maxResults) break;
    }
  }
  return output;
};

const result = (content: string, structuredContent: Record<string, unknown>) => ({
  content,
  structuredContent: structuredContent as never,
});

export const createFilesystemTools = (): BaseTool<any>[] => [
  {
    name: "fs_read",
    description: "Read a UTF-8 text file from the workspace.",
    schema: z.object({ path: z.string().min(1) }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
    execute: async ({ path }, { services }) => {
      const content = await readText(services.get(FILESYSTEM_SERVICE), path);
      return result(content, { path: normalizePath(path), content });
    },
  },
  {
    name: "fs_write",
    description: "Write or replace a UTF-8 text file in the workspace.",
    schema: z.object({ path: z.string().min(1), content: z.string() }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { destructiveHint: true, idempotentHint: true },
    execute: async ({ path, content }, { services }) => {
      await services.get(FILESYSTEM_SERVICE).writeFile(normalizePath(path), content);
      return result(`Wrote ${path}`, { path: normalizePath(path), bytes: new TextEncoder().encode(content).byteLength });
    },
  },
  {
    name: "fs_edit",
    description: "Replace exact text in an existing UTF-8 file.",
    schema: z.object({
      path: z.string().min(1),
      old_text: z.string(),
      new_text: z.string(),
      replace_all: z.boolean().optional(),
    }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { destructiveHint: true },
    execute: async ({ path, old_text, new_text, replace_all }, { services }) => {
      const fs = services.get(FILESYSTEM_SERVICE);
      const current = await readText(fs, path);
      const matches = old_text ? current.split(old_text).length - 1 : 0;
      if (matches === 0) return { content: `Text not found in ${path}`, isError: true };
      if (!replace_all && matches > 1) {
        return { content: `Text occurs ${matches} times in ${path}; set replace_all or provide more context`, isError: true };
      }
      const next = replace_all ? current.split(old_text).join(new_text) : current.replace(old_text, new_text);
      await fs.writeFile(normalizePath(path), next);
      return result(`Edited ${path}`, { path: normalizePath(path), replacements: replace_all ? matches : 1 });
    },
  },
  {
    name: "fs_ls",
    description: "List files and directories at a workspace path.",
    schema: z.object({ path: z.string().optional() }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
    execute: async ({ path = "/" }, { services }) => {
      const entries = await services.get(FILESYSTEM_SERVICE).readdir(normalizePath(path), { withFileTypes: true });
      const values = entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" }));
      return result(values.map(({ name, type }) => `${type === "directory" ? "d" : "f"} ${name}`).join("\n"), {
        path: normalizePath(path), entries: values,
      });
    },
  },
  {
    name: "fs_glob",
    description: "Find workspace files matching a glob pattern.",
    schema: z.object({ pattern: z.string().min(1), path: z.string().optional(), max_results: z.number().int().min(1).max(1000).optional() }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
    execute: async ({ pattern, path = "/", max_results = 200 }, { services }) => {
      const files = await walkFiles(services.get(FILESYSTEM_SERVICE), path, Math.max(max_results * 10, 1000));
      const base = normalizePath(path).replace(/\/$/, "");
      const matches = files.filter((file) => minimatch(file.slice(base.length).replace(/^\//, ""), pattern)).slice(0, max_results);
      return result(matches.join("\n"), { matches, truncated: matches.length === max_results });
    },
  },
  {
    name: "fs_grep",
    description: "Search UTF-8 workspace files for text or a regular expression.",
    schema: z.object({
      pattern: z.string(), path: z.string().optional(), glob: z.string().optional(),
      is_regex: z.boolean().optional(), case_sensitive: z.boolean().optional(),
      max_results: z.number().int().min(1).max(1000).optional(),
    }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { readOnlyHint: true, idempotentHint: true, parallelSafeHint: true },
    execute: async ({ pattern, path = "/", glob = "**/*", is_regex, case_sensitive, max_results = 200 }, { services }) => {
      const fs = services.get(FILESYSTEM_SERVICE);
      const files = (await walkFiles(fs, path, 5000)).filter((file) => minimatch(file.replace(/^\//, ""), glob) || minimatch(file, glob));
      const matcher = is_regex
        ? new RegExp(pattern, case_sensitive ? "" : "i")
        : undefined;
      const needle = case_sensitive ? pattern : pattern.toLowerCase();
      const matches: Array<{ path: string; line: number; text: string }> = [];
      for (const file of files) {
        let content: string;
        try { content = await readText(fs, file); } catch { continue; }
        for (const [index, line] of content.split(/\r?\n/).entries()) {
          const found = matcher ? matcher.test(line) : (case_sensitive ? line : line.toLowerCase()).includes(needle);
          if (found) matches.push({ path: file, line: index + 1, text: line });
          if (matches.length >= max_results) break;
        }
        if (matches.length >= max_results) break;
      }
      return result(matches.map((match) => `${match.path}:${match.line}:${match.text}`).join("\n"), { matches, truncated: matches.length === max_results });
    },
  },
  {
    name: "fs_mkdir",
    description: "Create a workspace directory.",
    schema: z.object({ path: z.string().min(1), recursive: z.boolean().optional() }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { idempotentHint: true },
    execute: async ({ path, recursive = true }, { services }) => {
      await services.get(FILESYSTEM_SERVICE).mkdir(normalizePath(path), { recursive });
      return result(`Created ${path}`, { path: normalizePath(path) });
    },
  },
  {
    name: "fs_remove",
    description: "Remove a workspace file or directory.",
    schema: z.object({ path: z.string().min(1), recursive: z.boolean().optional(), force: z.boolean().optional() }),
    requiredServices: [FILESYSTEM_SERVICE],
    annotations: { destructiveHint: true, idempotentHint: true },
    execute: async ({ path, recursive, force }, { services }) => {
      await services.get(FILESYSTEM_SERVICE).rm(normalizePath(path), { recursive, force });
      return result(`Removed ${path}`, { path: normalizePath(path) });
    },
  },
];

export const filesystemPlugin = (): HarnessPlugin => ({
  id: "agent-harness.standard.filesystem",
  version: "0.1.0",
  register: ({ registerTool }) => {
    for (const tool of createFilesystemTools()) registerTool(tool.name, () => tool);
  },
});
