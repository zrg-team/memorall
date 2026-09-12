import { describe, expect, it } from "vitest";

import {
	expandNodePath,
	findNodeById,
	findNodeByPath,
	mergeTreeState,
	toggleNodeExpand,
	updateNodeByPath,
} from "../tree-utils";

const tree = [
	{
		id: "root",
		name: "Root",
		path: "/root",
		type: "folder",
		isExpanded: false,
		children: [
			{
				id: "child",
				name: "Child",
				path: "/root/child",
				type: "folder",
				isExpanded: false,
				children: [
					{
						id: "file",
						name: "File",
						path: "/root/child/file.md",
						type: "file",
					},
				],
			},
		],
	},
] as any;

describe("document tree utilities", () => {
	it("finds nested nodes by id or path", () => {
		expect(findNodeById(tree, "file")?.path).toBe("/root/child/file.md");
		expect(findNodeById(tree, "missing")).toBeNull();
		expect(findNodeByPath(tree, "/root/child")?.id).toBe("child");
		expect(findNodeByPath(tree, "/missing")).toBeNull();
	});

	it("toggles and expands nodes immutably", () => {
		const toggled = toggleNodeExpand(tree, "child");
		expect(toggled).not.toBe(tree);
		expect(toggled[0].children?.[0].isExpanded).toBe(true);
		expect(tree[0].children?.[0].isExpanded).toBe(false);

		const expanded = expandNodePath(tree, "/root/child/file.md");
		expect(expanded[0].isExpanded).toBe(true);
		expect(expanded[0].children?.[0].isExpanded).toBe(true);
		expect(expandNodePath(tree, "/other")).toEqual(tree);
	});
});

/**
 * Every filesystem change rebuilds the tree from scratch, and the rebuild knows
 * nothing about what the user has open or which mapped folders have already
 * been read from disk. Without carrying that over, a mapped folder collapsed
 * and had to be re-read whenever anything anywhere changed — including the
 * agent writing an unrelated file.
 */
describe("mergeTreeState", () => {
	const node = (partial: Record<string, unknown>): any => ({
		isExpanded: false,
		children: [],
		type: "folder",
		...partial,
	});

	it("keeps folders open across a rebuild", () => {
		const before = [node({ id: "a", name: "a", path: "/a", isExpanded: true })];
		const fresh = [node({ id: "a", name: "a", path: "/a", isExpanded: false })];

		expect(mergeTreeState(before, fresh)[0]?.isExpanded).toBe(true);
	});

	it("keeps a mapped folder's contents instead of re-reading them", () => {
		const loadedChild = node({
			id: "f",
			name: "design.md",
			path: "/mapped/design.md",
			type: "file",
		});
		const before = [
			node({
				id: "m",
				name: "mapped",
				path: "/mapped",
				isLazy: false,
				children: [loadedChild],
			}),
		];
		// The rebuild hands mapped folders back deferred and empty.
		const fresh = [
			node({ id: "m", name: "mapped", path: "/mapped", isLazy: true }),
		];

		const merged = mergeTreeState(before, fresh);

		expect(merged[0]?.children).toEqual([loadedChild]);
		expect(merged[0]?.isLazy).toBe(false);
	});

	it("takes new contents for folders that were never read", () => {
		const before = [
			node({ id: "m", name: "mapped", path: "/mapped", isLazy: true }),
		];
		const fresh = [
			node({
				id: "m",
				name: "mapped",
				path: "/mapped",
				isLazy: true,
				children: [node({ id: "n", name: "new.md", path: "/mapped/new.md" })],
			}),
		];

		expect(mergeTreeState(before, fresh)[0]?.children).toHaveLength(1);
	});

	it("drops nodes that are gone and keeps ones that are new", () => {
		const before = [node({ id: "a", name: "a", path: "/a", isExpanded: true })];
		const fresh = [node({ id: "b", name: "b", path: "/b" })];

		expect(mergeTreeState(before, fresh).map((n) => n.path)).toEqual(["/b"]);
	});
});

describe("updateNodeByPath", () => {
	it("leaves untouched branches identity-equal so memoised rows do not redraw", () => {
		const sibling = node0("/keep");
		const tree = [sibling, node0("/change")];

		const next = updateNodeByPath(tree, "/change", (n) => ({
			...n,
			isExpanded: true,
		}));

		expect(next[0]).toBe(sibling);
		expect(next[1]?.isExpanded).toBe(true);
	});
});

function node0(path: string): any {
	return {
		id: path,
		name: path.slice(1),
		path,
		type: "folder",
		isExpanded: false,
		children: [],
	};
}
