import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemonVideoState } from "@/services/memon/types";
import type { MemonSend } from "../types";
import { VideoWindow } from "../windows/VideoWindow";

const request = vi.fn(async (..._args: unknown[]) => null as unknown);
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		onFilesystemChanged: () => () => undefined,
		readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
		writeFile: vi.fn(async () => undefined),
	},
}));

const save = vi.fn(async (project: string) => `${project}/renders/launch.mp4`);
vi.mock(
	"@/main/modules/chat/components/artifacts/hyperframes/hyperframes-renders",
	() => ({ saveHyperframesRender: (path: string) => save(path) }),
);

vi.mock(
	"@/main/modules/chat/components/artifacts/hyperframes/use-hyperframes-composition",
	() => ({
		useHyperframesComposition: () => ({
			status: "ready",
			composition: { html: "<html></html>", inlineScripts: [] },
			html: "<html></html>",
			width: 1920,
			height: 1080,
		}),
	}),
);

type PlayerProps = {
	exportRequest?: { id: number };
	onExported?: (result: {
		blob: Blob;
		filename: string;
		requestId?: number;
	}) => Promise<string | undefined>;
	onExportRequestStarted?: (id: number) => void;
	toolbarStart?: React.ReactNode;
};
let lastPlayer: PlayerProps | undefined;
vi.mock(
	"@/main/modules/chat/components/artifacts/hyperframes/HyperframesPlayer",
	() => ({
		HyperframesPlayer: (props: PlayerProps) => {
			lastPlayer = props;
			return (
				<div data-testid="player">
					{props.toolbarStart}
					{props.exportRequest
						? `request ${props.exportRequest.id}`
						: "no request"}
				</div>
			);
		},
	}),
);

const HOME = "/agents/Bot";
const send = () =>
	vi.fn(async () => null) as unknown as MemonSend & ReturnType<typeof vi.fn>;

const openProject: MemonVideoState = {
	status: "open",
	kind: "project",
	path: "/projects/launch",
	name: "launch",
	width: 1920,
	height: 1080,
	duration: 18,
	renders: ["/projects/launch/renders/launch.mp4"],
};

afterEach(() => {
	request.mockReset();
	save.mockClear();
	lastPlayer = undefined;
});

describe("VideoWindow", () => {
	it("lists the HyperFrames projects and opens the one picked", async () => {
		request.mockImplementation(async (operation) =>
			operation === "video.projects"
				? [
						{
							path: "/projects/launch",
							name: "launch",
							width: 1920,
							height: 1080,
							duration: 18,
							renders: [],
						},
					]
				: null,
		);
		const sent = send();
		render(
			<VideoWindow
				machineKey="m1"
				state={{ status: "choosing", renders: [] }}
				home={HOME}
				send={sent}
			/>,
		);

		const project = await screen.findByTestId("memon-video-project");
		expect(project.textContent).toContain("launch");
		expect(project.textContent).toContain("1920×1080 · 18s");
		fireEvent.click(project);
		await waitFor(() =>
			expect(sent).toHaveBeenCalledWith(
				"video.open",
				{ key: "m1", path: "/projects/launch" },
				{ rethrow: true },
			),
		);
	});

	it("says there is nothing yet when there are no projects", async () => {
		request.mockImplementation(async () => []);
		render(
			<VideoWindow
				machineKey="m1"
				state={undefined}
				home={HOME}
				send={send()}
			/>,
		);
		expect(await screen.findByText("memonComputer.video.empty")).toBeTruthy();
	});

	it("plays the open project, lists its renders and goes back to the list", () => {
		const sent = send();
		render(
			<VideoWindow
				machineKey="m1"
				state={openProject}
				home={HOME}
				send={sent}
			/>,
		);

		expect(screen.getByTestId("player").textContent).toContain("no request");
		expect(screen.getByText("launch.mp4")).toBeTruthy();
		fireEvent.click(screen.getByTitle("memonComputer.video.allProjects"));
		expect(sent).toHaveBeenCalledWith("video.close", { key: "m1" });
	});

	it("runs the agent's export request and reports the saved MP4 back", async () => {
		const sent = send();
		render(
			<VideoWindow
				machineKey="m1"
				state={{ ...openProject, exportRequest: { id: 3, fps: 24 } }}
				home={HOME}
				send={sent}
			/>,
		);
		expect(screen.getByTestId("player").textContent).toContain("request 3");

		lastPlayer?.onExportRequestStarted?.(3);
		await waitFor(() =>
			expect(request).toHaveBeenCalledWith("video.exportStarted", {
				key: "m1",
				requestId: 3,
			}),
		);

		const saved = await lastPlayer?.onExported?.({
			blob: new Blob(["mp4"]),
			filename: "launch.mp4",
			requestId: 3,
		});
		expect(save).toHaveBeenCalledWith("/projects/launch");
		expect(saved).toBe("/projects/launch/renders/launch.mp4");
		expect(sent).toHaveBeenCalledWith("video.exported", {
			key: "m1",
			path: "/projects/launch/renders/launch.mp4",
			requestId: 3,
		});
	});
});
