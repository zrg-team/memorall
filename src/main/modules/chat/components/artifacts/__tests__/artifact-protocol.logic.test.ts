import { describe, expect, it } from "vitest";
import {
	collectRuntimeArtifacts,
	normalizeArtifactType,
	parseArtifactSegments,
	replaceArtifactContent,
} from "../artifact-protocol";

describe("artifact protocol parsing", () => {
	it("splits text and complete artifact blocks", () => {
		const segments = parseArtifactSegments(
			'Intro <artifact type="text/html" title="Demo" identifier="demo" projectPath="/workspaces/app">HTML</artifact> Outro',
		);

		expect(segments).toEqual([
			{ kind: "text", text: "Intro " },
			expect.objectContaining({
				kind: "artifact",
				type: "html",
				title: "Demo",
				identifier: "demo",
				projectPath: "/workspaces/app",
				content: "HTML",
				blockIndex: 0,
			}),
			{ kind: "text", text: " Outro" },
		]);
	});

	it("supports the legacy memorall_artifact tag and project-path attr", () => {
		const segments = parseArtifactSegments(
			'Before <memorall_artifact type="md" title="Doc" project-path="/docs/a.md"># A</memorall_artifact>',
		);

		expect(segments.at(1)).toEqual(
			expect.objectContaining({
				kind: "artifact",
				type: "markdown",
				title: "Doc",
				projectPath: "/docs/a.md",
				content: "# A",
			}),
		);
	});

	it("hides incomplete streaming protocol markup", () => {
		expect(
			parseArtifactSegments('Visible <artifact type="html">partial'),
		).toEqual([{ kind: "text", text: "Visible " }]);
		expect(parseArtifactSegments("Visible <artifact")).toEqual([
			{ kind: "text", text: "Visible " },
		]);
	});

	it("normalizes mime types and aliases", () => {
		expect(normalizeArtifactType("text/x-markdown")).toBe("markdown");
		expect(normalizeArtifactType("txt")).toBe("text");
		expect(normalizeArtifactType("application/hyperframes")).toBe(
			"hyperframes",
		);
		expect(normalizeArtifactType("bodymovin")).toBe("lottie");
		expect(normalizeArtifactType("unknown")).toBe("html");
	});

	it("collects and deduplicates runtime artifacts from content and tool metadata", () => {
		const messages = [
			{ id: "u1", role: "user", content: "ignore" },
			{
				id: "a1",
				role: "assistant",
				content:
					'<artifact type="text" identifier="x" title="Same">hello</artifact>',
				parts: [
					{
						role: "assistant",
						tool_calls: [
							{
								id: "call-1",
								function: {
									name: "render_artifact",
									arguments: JSON.stringify({
										type: "text",
										identifier: "x",
										title: "Same",
										content: "hello",
									}),
								},
							},
						],
					},
					{
						role: "assistant",
						content:
							'<artifact type="markdown" identifier="y"># Extra</artifact>',
					},
				],
			},
		];

		const artifacts = collectRuntimeArtifacts(messages);

		expect(artifacts).toHaveLength(2);
		expect(artifacts.map((artifact) => artifact.id)).toEqual([
			"a1:0",
			"a1:part:2",
		]);
	});

	it("replaces the selected artifact content only", () => {
		const content =
			'<artifact type="text">one</artifact><artifact type="text">two</artifact>';

		expect(replaceArtifactContent(content, 1, "updated")).toBe(
			'<artifact type="text">one</artifact><artifact type="text">updated</artifact>',
		);
		expect(replaceArtifactContent(content, 3, "noop")).toBe(content);
	});
});
