import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__testing,
	pickDefaultGgufFile,
	searchHubGgufModels,
	supportsGgufSpeechSearch,
} from "../gguf-hub-search";

const AUDIO_IN = "clip.has_audio_encoder";
const AUDIO_OUT = "clip.has_gen_audio_encoder";

/** A projector header holding the given boolean keys, as GGUF stores them. */
function header(flags: Record<string, boolean>): ArrayBuffer {
	const parts: number[] = [];
	for (const [key, value] of Object.entries(flags)) {
		parts.push(...new Array(8).fill(0));
		parts.push(...new TextEncoder().encode(key));
		parts.push(7, 0, 0, 0, value ? 1 : 0);
	}
	return new Uint8Array(parts).buffer;
}

interface FakeRepo {
	id: string;
	downloads: number;
	tags: string[];
	flags?: Record<string, boolean>;
	chat?: boolean;
	noProjector?: boolean;
	projectorStatus?: number;
}

const omni = (id: string, downloads = 10): FakeRepo => ({
	id,
	downloads,
	tags: ["any-to-any"],
	flags: { [AUDIO_IN]: true, [AUDIO_OUT]: true },
	chat: true,
});
const hearsOnly = (id: string, downloads = 10): FakeRepo => ({
	id,
	downloads,
	tags: ["any-to-any"],
	flags: { [AUDIO_IN]: true },
	chat: true,
});
const ttsOnly = (id: string, downloads = 10): FakeRepo => ({
	id,
	downloads,
	tags: ["text-to-speech"],
	flags: { [AUDIO_IN]: true, [AUDIO_OUT]: true },
	chat: false,
});
const visionOnly = (id: string, downloads = 10): FakeRepo => ({
	id,
	downloads,
	tags: ["any-to-any"],
	flags: { "clip.has_vision_encoder": true },
	chat: true,
});

function hub(repos: FakeRepo[]) {
	return vi.fn(async (input: string, init?: RequestInit) => {
		const url = new URL(input);
		if (url.pathname === "/api/models") {
			const tag = url.searchParams.get("pipeline_tag") ?? "";
			return {
				ok: true,
				json: async () =>
					repos
						.filter((repo) => repo.tags.includes(tag))
						.map((repo) => ({
							id: repo.id,
							downloads: repo.downloads,
							likes: 1,
							gguf: repo.chat ? { chat_template: "{{ x }}" } : {},
							siblings: [
								{ rfilename: "model-Q4_K_M.gguf" },
								...(repo.noProjector
									? []
									: [{ rfilename: "mmproj-model-Q8_0.gguf" }]),
							],
						})),
			} as Response;
		}
		expect((init?.headers as Record<string, string>).Range).toMatch(
			/^bytes=0-/,
		);
		const repo = repos.find((item) => url.pathname.startsWith(`/${item.id}/`));
		if (repo?.projectorStatus) {
			return { ok: false, status: repo.projectorStatus } as Response;
		}
		return {
			ok: true,
			arrayBuffer: async () => header(repo?.flags ?? {}),
		} as Response;
	});
}

const search = async (
	category: Parameters<typeof searchHubGgufModels>[0],
	repos: FakeRepo[],
) => {
	const found = await searchHubGgufModels(category, "", {
		fetch: hub(repos) as unknown as typeof fetch,
	});
	return found.map((model) => model.id);
};

const mixed = [
	omni("org/omni"),
	hearsOnly("org/hears"),
	ttsOnly("org/tts"),
	visionOnly("org/vision"),
];

beforeEach(() => {
	__testing.clearProjectorCache();
});

describe("searchHubGgufModels", () => {
	it("suggests only models that hear, speak and converse for voice chat", async () => {
		expect(await search("speech-to-speech", mixed)).toEqual(["org/omni"]);
	});

	it("suggests models that hear for transcription, but not a voice imitator", async () => {
		expect((await search("speech-to-text", mixed)).sort()).toEqual([
			"org/hears",
			"org/omni",
		]);
	});

	it("suggests anything that can speak for text to speech", async () => {
		expect((await search("text-to-speech", mixed)).sort()).toEqual([
			"org/omni",
			"org/tts",
		]);
	});

	it("ignores a repo with no projector without fetching one", async () => {
		const fetcher = hub([{ ...omni("org/plain"), noProjector: true }]);
		const found = await searchHubGgufModels("speech-to-speech", "", {
			fetch: fetcher as unknown as typeof fetch,
		});
		expect(found).toEqual([]);
		expect(
			fetcher.mock.calls.some(([url]) => String(url).includes("/resolve/")),
		).toBe(false);
	});

	it("ignores a false flag", async () => {
		expect(
			await search("speech-to-speech", [
				{
					...omni("org/off"),
					flags: { [AUDIO_IN]: true, [AUDIO_OUT]: false },
				},
			]),
		).toEqual([]);
	});

	it("sorts by downloads and removes duplicates across tags", async () => {
		expect(
			await search("speech-to-speech", [
				{ ...omni("org/small", 5), tags: ["any-to-any", "text-to-speech"] },
				omni("org/big", 500),
				omni("org/mid", 50),
			]),
		).toEqual(["org/big", "org/mid", "org/small"]);
	});

	it("reports matches as they are found", async () => {
		const updates: string[][] = [];
		await searchHubGgufModels("speech-to-speech", "", {
			fetch: hub([
				omni("org/a", 2),
				omni("org/b", 1),
			]) as unknown as typeof fetch,
			onUpdate: (models) => updates.push(models.map((model) => model.id)),
		});
		expect(updates.at(-1)).toEqual(["org/a", "org/b"]);
		expect(updates.length).toBe(2);
	});

	it("leaves out a repo whose projector cannot be read, and keeps the rest", async () => {
		expect(
			await search("speech-to-speech", [
				{ ...omni("org/gated"), projectorStatus: 401 },
				omni("org/open"),
			]),
		).toEqual(["org/open"]);
	});

	it("reads each projector once", async () => {
		const fetcher = hub([omni("org/a")]);
		const options = { fetch: fetcher as unknown as typeof fetch };
		await searchHubGgufModels("speech-to-speech", "", options);
		await searchHubGgufModels("text-to-speech", "", options);
		expect(
			fetcher.mock.calls.filter(([url]) => String(url).includes("/resolve/")),
		).toHaveLength(1);
	});

	it("asks the Hub for GGUF repos matching the search text", async () => {
		const fetcher = hub([]);
		await searchHubGgufModels("text-to-speech", " qwen ", {
			fetch: fetcher as unknown as typeof fetch,
		});
		const url = new URL(fetcher.mock.calls[0]?.[0] as string);
		expect(url.searchParams.get("filter")).toBe("gguf");
		expect(url.searchParams.get("search")).toBe("qwen");
		expect(url.searchParams.getAll("expand[]")).toEqual(
			expect.arrayContaining(["siblings", "gguf"]),
		);
	});

	it("survives one tag failing", async () => {
		const working = hub([omni("org/a")]);
		const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
			new URL(url).searchParams.get("pipeline_tag") === "text-to-speech"
				? ({ ok: false, status: 500 } as Response)
				: working(url, init),
		);
		const found = await searchHubGgufModels("speech-to-speech", "", {
			fetch: fetcher as unknown as typeof fetch,
		});
		expect(found.map((model) => model.id)).toEqual(["org/a"]);
	});

	it("searches only the speech studios", async () => {
		expect(supportsGgufSpeechSearch("speech-to-speech")).toBe(true);
		expect(supportsGgufSpeechSearch("speech-to-text")).toBe(true);
		expect(supportsGgufSpeechSearch("text-to-speech")).toBe(true);
		expect(supportsGgufSpeechSearch("image-tools")).toBe(false);
		expect(supportsGgufSpeechSearch("decision")).toBe(false);
		expect(supportsGgufSpeechSearch("chat")).toBe(false);
		await expect(searchHubGgufModels("chat")).resolves.toEqual([]);
	});
});

describe("pickDefaultGgufFile", () => {
	const named = (...names: string[]) => names.map((name) => ({ name }));

	it("prefers Q4_K_M, then Q8_0, then the smallest", () => {
		expect(
			pickDefaultGgufFile(named("m-Q2.gguf", "m-Q8_0.gguf", "m-Q4_K_M.gguf")),
		).toEqual({ name: "m-Q4_K_M.gguf" });
		expect(pickDefaultGgufFile(named("m-Q2.gguf", "m-Q8_0.gguf"))).toEqual({
			name: "m-Q8_0.gguf",
		});
		expect(pickDefaultGgufFile(named("m-Q2.gguf", "m-F16.gguf"))).toEqual({
			name: "m-Q2.gguf",
		});
	});

	it("takes any 4-bit quantization before a larger 8-bit one", () => {
		expect(
			pickDefaultGgufFile(named("m-Q4_0.gguf", "m-Q8_0.gguf", "m-BF16.gguf")),
		).toEqual({ name: "m-Q4_0.gguf" });
		expect(
			pickDefaultGgufFile(named("m-UD-Q2_K_XL.gguf", "m-UD-Q4_K_XL.gguf")),
		).toEqual({ name: "m-UD-Q4_K_XL.gguf" });
	});

	it("has nothing to pick from an empty repo", () => {
		expect(pickDefaultGgufFile([])).toBeUndefined();
	});
});
