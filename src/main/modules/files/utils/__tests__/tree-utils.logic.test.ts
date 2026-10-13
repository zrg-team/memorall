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

	/** A rebuild as the service reads it: new objects, and folders dated now. */
	const read = (stamp: number, size = 3) => [
		node({
			id: "/docs",
			name: "docs",
			path: "/docs",
			folder: {
				id: "/docs",
				name: "docs",
				path: "/docs",
				parentPath: null,
				childCount: 1,
				createdAt: new Date(stamp),
				modifiedAt: new Date(stamp),
			},
			children: [
				node({
					id: "/docs/a.md",
					name: "a.md",
					path: "/docs/a.md",
					type: "file",
					file: {
						id: "/docs/a.md",
						name: "a.md",
						path: "/docs/a.md",
						type: "markdown",
						mimeType: "text/markdown",
						size,
						createdAt: new Date(0),
						modifiedAt: new Date(0),
						metadata: {},
					},
				}),
			],
		}),
		node({ id: "/other", name: "other", path: "/other" }),
	];

	it("returns the previous tree when a rebuild changed nothing, folder dates aside", () => {
		const before = mergeTreeState([], read(1));

		expect(mergeTreeState(before, read(2))).toBe(before);
	});

	it("rebuilds only the path down to a changed node", () => {
		const before = mergeTreeState([], read(1));

		const after = mergeTreeState(before, read(2, 4));

		expect(after).not.toBe(before);
		expect(after[0]).not.toBe(before[0]);
		expect(after[0]?.children[0]?.file?.size).toBe(4);
		expect(after[1]).toBe(before[1]);
	});

	it("keeps a read mapped folder, and its count, the same object across rebuilds", () => {
		const child = node({ id: "/m/x", name: "x", path: "/m/x", type: "file" });
		const before = [
			node({
				id: "/m",
				name: "m",
				path: "/m",
				isLazy: false,
				isExpanded: true,
				children: [child],
				folder: { id: "/m", name: "m", path: "/m", childCount: 1 },
			}),
		];
		const fresh = [
			node({
				id: "/m",
				name: "m",
				path: "/m",
				isLazy: true,
				folder: { id: "/m", name: "m", path: "/m", childCount: 0 },
			}),
		];

		expect(mergeTreeState(before, fresh)).toBe(before);
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
