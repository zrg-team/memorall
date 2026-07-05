import { describe, expect, it } from "vitest";

import {
	expandNodePath,
	findNodeById,
	findNodeByPath,
	toggleNodeExpand,
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
