import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemonFileEntry } from "../../../types";
import { MemonVideo } from "../video-app";

const COMPOSITION = `<div data-composition-id="main" data-width="1080" data-height="1920" data-duration="12"></div>
<script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = tl;</script>`;

/** Files with real folders: a folder is any prefix of a file path. */
const memoryFiles = (files: Record<string, string>) => {
	const folders = () => {
		const set = new Set<string>(["/"]);
		for (const path of Object.keys(files)) {
			const parts = path.split("/").filter(Boolean);
			for (let i = 1; i < parts.length; i++) {
				set.add(`/${parts.slice(0, i).join("/")}`);
			}
		}
		return set;
	};
	return {
		list: async (dir: string): Promise<MemonFileEntry[]> => {
			const prefix = dir === "/" ? "/" : `${dir}/`;
			const entries = new Map<string, MemonFileEntry>();
			for (const path of [...Object.keys(files), ...folders()]) {
				if (!path.startsWith(prefix) || path === dir) continue;
				const name = path.slice(prefix.length).split("/")[0];
				if (!name) continue;
				const full = `${prefix}${name}`;
				entries.set(full, {
					name,
					path: full,
					type: full in files ? "file" : "dir",
				});
			}
			if (entries.size === 0 && !folders().has(dir)) throw new Error("ENOENT");
			return [...entries.values()];
		},
		read: async (path: string) => {
			const content = files[path];
			if (content === undefined) throw new Error("ENOENT");
			return content;
		},
		isDirectory: async (path: string) => folders().has(path),
		exists: async (path: string) => path in files || folders().has(path),
	};
};

const createVideo = (
	files: Record<string, string>,
	options: { windowOpen?: boolean } = {},
) => {
	const show = vi.fn();
	const changed = vi.fn();
	const video = new MemonVideo({
		home: () => "/agents/demo",
		files: memoryFiles(files),
		changed,
		show,
		windowOpen: () => options.windowOpen ?? true,
	});
	return { video, show, changed };
};

describe("MemonVideo", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lists HyperFrames projects with their size, length and renders", async () => {
		const { video } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
			"/projects/launch/renders/launch.mp4": "mp4",
			"/projects/site/index.html": "<html>not a composition</html>",
			"/agents/demo/projects/reel/index.html": COMPOSITION,
		});

		const projects = await video.projects();

		expect(projects).toEqual([
			{
				path: "/projects/launch",
				name: "launch",
				width: 1080,
				height: 1920,
				duration: 12,
				renders: ["/projects/launch/renders/launch.mp4"],
			},
			expect.objectContaining({ path: "/agents/demo/projects/reel" }),
		]);
	});

	it("opens a project from its folder or its index.html, and shows the window", async () => {
		const { video, show } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
		});

		await video.open("/projects/launch/index.html");
		expect(video.state()).toMatchObject({
			status: "open",
			kind: "project",
			path: "/projects/launch",
			width: 1080,
		});
		expect(show).toHaveBeenCalled();

		await video.open("/projects/launch");
		expect(video.state()?.path).toBe("/projects/launch");
	});

	it("plays video files and refuses anything else", async () => {
		const { video } = createVideo({
			"/agents/demo/clip.mp4": "mp4",
			"/projects/site/index.html": "<html></html>",
			"/notes.md": "# notes",
		});

		await video.open("~/clip.mp4");
		expect(video.state()).toMatchObject({
			kind: "video",
			path: "/agents/demo/clip.mp4",
		});
		await expect(video.open("/projects/site")).rejects.toThrow(
			"not a HyperFrames project",
		);
		await expect(video.open("/notes.md")).rejects.toThrow(
			"not a video or a HyperFrames project",
		);
	});

	it("lists the projects when opened with nothing to play, and goes back to them", async () => {
		const { video } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
		});
		expect(video.state()).toBeUndefined();
		video.choose();
		expect(video.state()).toEqual({ status: "choosing", renders: [] });

		await video.open("/projects/launch");
		video.choose();
		expect(video.state()?.status).toBe("open");

		video.close();
		expect(video.state()?.status).toBe("choosing");
	});

	it("hands the agent's export to the window and waits for the saved MP4", async () => {
		const { video } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
		});
		await video.open("/projects/launch");

		const done = video.exportOpenProject({ fps: 24 });
		const request = video.state()?.exportRequest;
		expect(request).toEqual({ id: 1, fps: 24 });

		video.exportStarted(1);
		await vi.advanceTimersByTimeAsync(60_000);
		await video.exported("/projects/launch/renders/launch.mp4", 1);

		await expect(done).resolves.toEqual({
			path: "/projects/launch/renders/launch.mp4",
		});
		expect(video.state()?.exportRequest).toBeUndefined();
		expect(video.state()?.lastExport).toBe(
			"/projects/launch/renders/launch.mp4",
		);
	});

	it("fails the agent's export when no window on screen starts it", async () => {
		const { video } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
		});
		await video.open("/projects/launch");

		const done = video.exportOpenProject();
		const failed = expect(done).rejects.toThrow("No one has the computer open");
		await vi.advanceTimersByTimeAsync(31_000);
		await failed;
		expect(video.state()?.exportRequest).toBeUndefined();
	});

	it("reports the window's export failure to the agent", async () => {
		const { video } = createVideo({
			"/projects/launch/index.html": COMPOSITION,
		});
		await video.open("/projects/launch");

		const done = video.exportOpenProject();
		video.exportStarted(1);
		video.exportFailed(1, "Export failed: no encoder");
		await expect(done).rejects.toThrow("no encoder");
	});

	it("needs an open project and a window to export", async () => {
		const { video } = createVideo(
			{ "/projects/launch/index.html": COMPOSITION },
			{ windowOpen: false },
		);
		await expect(video.exportOpenProject()).rejects.toThrow(
			"Open a HyperFrames project",
		);
		await video.open("/projects/launch");
		await expect(video.exportOpenProject()).rejects.toThrow("not open");
	});
});
