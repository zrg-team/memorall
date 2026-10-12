import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderIndexStateView } from "@/services/folder-index/operation-types";
import { FolderIndexProvider, useFolderIndex } from "../FolderIndexContext";

const mocks = vi.hoisted(() => ({
	request: vi.fn(),
	mountedPaths: new Set<string>(),
}));
vi.mock("@/services/folder-index/folder-index-client", () => ({
	folderIndexClient: { request: mocks.request },
}));
vi.mock("@/main/modules/files/hooks/use-native-mounts", () => ({
	useNativeMounts: () => ({ mountedPaths: mocks.mountedPaths }),
}));

let state: FolderIndexStateView;
let entryCount: number;
const Probe = () => {
	const index = useFolderIndex();
	React.useEffect(() => {
		index?.loadEntries("/Music");
	}, [index?.loadEntries]);
	return (
		<>
			<output data-testid="running">
				{index?.isRunning() ? "Indexing" : "Idle"}
			</output>
			<output data-testid="entries">
				{index?.entriesOf("/Music")?.byFile.size ?? 0}
			</output>
		</>
	);
};

beforeEach(() => {
	vi.useFakeTimers();
	entryCount = 1;
	state = {
		types: [
			{
				id: "embeddings",
				label: "Embeddings",
				description: "Content",
				tools: [],
			},
		],
		settings: {
			skipPatterns: [],
			maxFileBytes: 1024,
			askBeforeMapped: true,
			agentsMayAsk: true,
		},
		folders: [
			{
				path: "/Music",
				on: ["embeddings"],
				off: [],
				effective: ["embeddings"],
				mapped: false,
				status: [
					{
						typeId: "embeddings",
						entries: 1,
						files: 1,
						chunks: 1,
						updatedAt: "before",
					},
				],
			},
		],
		running: [],
	};
	mocks.request.mockImplementation(async (operation: string) => {
		if (operation === "state.get") return structuredClone(state);
		if (operation === "folder.entries")
			return {
				effective: ["embeddings"],
				entries: {
					embeddings: Array.from({ length: entryCount }, (_, i) => ({
						path: `/Music/${i}.mp3`,
						type: "Embeddings",
					})),
				},
			};
		throw new Error(`Unexpected operation ${operation}`);
	});
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});
const mount = async () => {
	let view: ReturnType<typeof render>;
	await act(async () => {
		view = render(
			<FolderIndexProvider>
				<Probe />
			</FolderIndexProvider>,
		);
	});
	return view!;
};

describe("Files indexing status", () => {
	it("notices an automatic run from idle, polls it faster, and refreshes entries on completion", async () => {
		await mount();
		expect(screen.getByTestId("running")).toHaveTextContent("Idle");
		state.running = ["embeddings:/Music"];
		await act(async () => {
			vi.advanceTimersByTime(5000);
		});
		expect(screen.getByTestId("running")).toHaveTextContent("Indexing");
		state.running = [];
		state.folders[0].status[0].updatedAt = "after";
		entryCount = 2;
		await act(async () => {
			vi.advanceTimersByTime(1500);
		});
		expect(screen.getByTestId("running")).toHaveTextContent("Idle");
		expect(screen.getByTestId("entries")).toHaveTextContent("2");
	});
	it("refreshes a short automatic run that completed between idle polls", async () => {
		await mount();
		state.folders[0].status[0].updatedAt = "short-run-completed";
		entryCount = 3;
		await act(async () => {
			vi.advanceTimersByTime(5000);
		});
		expect(screen.getByTestId("running")).toHaveTextContent("Idle");
		expect(screen.getByTestId("entries")).toHaveTextContent("3");
	});
	it("does not poll when there are no configured indexes, and stops on unmount", async () => {
		state.folders = [];
		const view = await mount();
		const before = mocks.request.mock.calls.length;
		await act(async () => {
			vi.advanceTimersByTime(20_000);
		});
		expect(mocks.request).toHaveBeenCalledTimes(before);
		view.unmount();
		vi.advanceTimersByTime(20_000);
		expect(mocks.request).toHaveBeenCalledTimes(before);
	});
});
