import { describe, expect, it } from "vitest";
import {
	assignAssistantPartKeys,
	assignContentSegmentKeys,
} from "../stable-part-keys";

describe("stable render keys", () => {
	it("keeps existing text keys stable when execution or tool parts are appended", () => {
		const initial = assignAssistantPartKeys([
			{ type: "text", text: "hello" },
		]).map(({ key }) => key);
		const next = assignAssistantPartKeys([
			{ type: "text", text: "hello world" },
			{ type: "execution", id: "step-1" },
			{ type: "tool", id: "tool-1" },
		]).map(({ key }) => key);

		expect(initial[0]).toBe("text-0");
		expect(next[0]).toBe(initial[0]);
	});

	it("keys OpenUI blocks by ordinal within kind, not array position", () => {
		const initial = assignContentSegmentKeys([
			{ kind: "openui", content: "root = CardBlock(...)" },
		]);
		const next = assignContentSegmentKeys([
			{ kind: "text", text: "Intro\n" },
			{ kind: "openui", content: "root = CardBlock(...)" },
		]);

		expect(initial[0].key).toBe("openui-0");
		expect(next[1].key).toBe(initial[0].key);
	});
});
