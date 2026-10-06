import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
	MemonPiCodeBrowse,
	MemonPiCodeFolder,
	MemonPiCodeState,
} from "@/services/memon/types";
import type { MemonSend } from "../types";
import { PiCodeWindow } from "../windows/PiCodeWindow";

const HOME = "/agents/Bot";

const request = vi.fn(async (..._args: unknown[]) => null);
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: (...args: unknown[]) => request(...args) },
}));

const asking: MemonPiCodeState = {
	status: "idle",
	working: false,
	approval: {
		id: "p1",
		task: "Build a todo API in ~/todo, with tests.",
		requestedAt: 0,
	},
};

describe("PiCodeWindow", () => {
	it("puts the agent's request on top of the window and sends the user's answer", () => {
		const send = vi.fn(async () => null);
		render(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={asking}
				focused
				send={send as unknown as MemonSend}
			/>,
		);

		const card = screen.getByTestId("memon-pi-code-approval");
		expect(card.getAttribute("role")).toBe("alertdialog");
		expect(card.textContent).toContain(
			"Build a todo API in ~/todo, with tests.",
		);
		// pi starts only once the user allows it: nothing attaches yet.
		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.piCode.waiting",
		);
		expect(request).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("memonComputer.piCode.deny"));
		expect(send).toHaveBeenLastCalledWith("piCode.approval", {
			key: "m1",
			id: "p1",
			decision: "deny",
		});
		fireEvent.click(screen.getByText("memonComputer.piCode.approve"));
		expect(send).toHaveBeenLastCalledWith("piCode.approval", {
			key: "m1",
			id: "p1",
			decision: "approve",
		});
	});

	it("puts Stop over pi while it works, and stops pi's turn", async () => {
		request.mockImplementation(async (operation: unknown) =>
			operation === "piCode.attach"
				? ({ cursor: 0 } as never)
				: // The read waits for output that never comes.
					new Promise<null>(() => {}),
		);
		const send = vi.fn(async () => null);
		const working: MemonPiCodeState = {
			status: "running",
			working: true,
			transcript: [],
		};
		const view = render(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={working}
				focused
				send={send as unknown as MemonSend}
			/>,
		);

		const stop = await screen.findByTestId("memon-pi-code-stop");
		fireEvent.click(stop);
		expect(send).toHaveBeenLastCalledWith("piCode.stop", { key: "m1" });

		view.rerender(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={{ ...working, working: false }}
				focused
				send={send as unknown as MemonSend}
			/>,
		);
		expect(screen.queryByTestId("memon-pi-code-stop")).toBeNull();
		view.unmount();
		request.mockReset();
	});

	it("attaches again to a new start of pi, even one too fast to show starting", async () => {
		// The old pi says it closed; the new one never sends output.
		let reads = 0;
		request.mockImplementation(async (operation: unknown) => {
			if (operation === "piCode.attach") return { cursor: 0 } as never;
			reads += 1;
			return reads === 1
				? ({ data: "", cursor: 0, reset: false, closed: true } as never)
				: new Promise<null>(() => {});
		});
		const running = (instance: number): MemonPiCodeState => ({
			status: "running",
			instance,
			working: false,
			transcript: [],
		});
		const view = render(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={running(1)}
				focused
				send={vi.fn() as unknown as MemonSend}
			/>,
		);
		const attaches = () =>
			request.mock.calls.filter(([operation]) => operation === "piCode.attach")
				.length;
		await vi.waitFor(() => expect(attaches()).toBe(1));
		await vi.waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe(
				"memonComputer.piCode.starting",
			),
		);

		// /resume: still "running", but another pi.
		view.rerender(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={running(2)}
				focused
				send={vi.fn() as unknown as MemonSend}
			/>,
		);
		await vi.waitFor(() => expect(attaches()).toBe(2));
		await vi.waitFor(() => expect(screen.queryByRole("status")).toBeNull());
		view.unmount();
		request.mockReset();
	});

	it("sends a pasted picture to pi as a file, and leaves text to the terminal", async () => {
		request.mockImplementation(async (operation: unknown) =>
			operation === "piCode.attach"
				? ({ cursor: 0 } as never)
				: operation === "piCode.read"
					? new Promise<null>(() => {})
					: null,
		);
		const view = render(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={{ status: "running", working: false, transcript: [] }}
				focused
				send={vi.fn() as unknown as MemonSend}
			/>,
		);
		const screenHost = screen.getByTestId("memon-pi-code-screen");
		const paste = (content: { text?: string; files?: File[] }) =>
			fireEvent.paste(screenHost, {
				clipboardData: {
					files: content.files ?? [],
					items: [],
					types: [],
					getData: (type: string) =>
						type === "text/plain" ? (content.text ?? "") : "",
				},
			});
		const pastedImages = () =>
			request.mock.calls.filter(
				([operation]) => operation === "piCode.pasteImage",
			);

		expect(paste({ text: "hello" })).toBe(true);
		const shot = new File([new Uint8Array([1, 2, 3])], "image.png", {
			type: "image/png",
		});
		expect(paste({ files: [shot] })).toBe(false);

		await vi.waitFor(() => expect(pastedImages()).toHaveLength(1));
		expect(pastedImages()[0]).toEqual([
			"piCode.pasteImage",
			{ key: "m1", data: "AQID", mimeType: "image/png" },
		]);
		view.unmount();
		request.mockReset();
	});

	it("shows no request when nothing waits", () => {
		render(
			<PiCodeWindow
				machineKey="m1"
				home={HOME}
				state={{ status: "starting", working: false }}
				focused={false}
				send={vi.fn() as unknown as MemonSend}
			/>,
		);
		expect(screen.queryByTestId("memon-pi-code-approval")).toBeNull();
		expect(screen.getByRole("status").textContent).toBe(
			"memonComputer.piCode.starting",
		);
	});

	describe("the folder picker", () => {
		const recent: MemonPiCodeFolder[] = [
			{
				path: `${HOME}/todo`,
				lastUsed: Date.now() - 3_600_000,
				sessions: 2,
				latest: { file: "/s/a.jsonl", title: "Build a todo API" },
			},
		];
		const listings: Record<string, MemonPiCodeBrowse> = {
			[HOME]: {
				dir: HOME,
				parent: "/agents",
				folders: [
					{ name: ".pi", path: `${HOME}/.pi` },
					{ name: "projects", path: `${HOME}/projects` },
					{ name: "todo", path: `${HOME}/todo` },
				],
				files: ["Bot.md", "Memory.md"],
			},
			[`${HOME}/projects`]: {
				dir: `${HOME}/projects`,
				parent: HOME,
				folders: [
					{ name: "api", path: `${HOME}/projects/api` },
					{ name: "web", path: `${HOME}/projects/web` },
				],
				files: [],
			},
		};
		const resolve = (dir?: string) =>
			!dir || dir === "~" ? HOME : dir.replace(/^~/, HOME);

		const renderPicker = () => {
			request.mockImplementation(
				async (operation: unknown, payload: unknown) => {
					if (operation === "piCode.folders") return recent as never;
					if (operation === "piCode.browse") {
						const dir = resolve((payload as { dir?: string }).dir);
						const listing = listings[dir];
						if (!listing) throw new Error(`${dir} is not a folder.`);
						return listing as never;
					}
					return null;
				},
			);
			const send = vi.fn(async () => null);
			render(
				<PiCodeWindow
					machineKey="m1"
					home={HOME}
					state={{ status: "choosing", working: false }}
					focused
					send={send as unknown as MemonSend}
				/>,
			);
			return send;
		};
		const names = (testId: string) =>
			screen
				.queryAllByTestId(testId)
				.map((row) => row.querySelector("span.truncate")?.textContent);

		it("lists the folders used last and the home's folders, and opens or continues a recent one", async () => {
			const send = renderPicker();
			expect(screen.getByTestId("memon-pi-code-picker")).toBeTruthy();
			await vi.waitFor(() =>
				expect(names("memon-pi-code-recent")).toEqual(["todo"]),
			);
			await vi.waitFor(() =>
				// Hidden folders stay out of the way.
				expect(names("memon-pi-code-folder")).toEqual(["projects", "todo"]),
			);
			expect(screen.queryByRole("status")).toBeNull();
			// The whole path, the home by its own name; its files are seen too.
			expect(
				screen.getByRole("navigation").textContent?.replace(/\s+/g, ""),
			).toBe("agentsBot");
			expect(screen.getByTestId("memon-pi-code-files").textContent).toBe(
				"Bot.mdMemory.md",
			);

			fireEvent.click(screen.getByTestId("memon-pi-code-continue"));
			expect(send).toHaveBeenLastCalledWith(
				"piCode.open",
				{ key: "m1", cwd: "~/todo", continueLast: true },
				{ rethrow: true },
			);
			await vi.waitFor(() =>
				expect(
					(screen.getByTestId("memon-pi-code-open-here") as HTMLButtonElement)
						.disabled,
				).toBe(false),
			);
			// Enter opens the highlighted row: the folder used last.
			fireEvent.keyDown(screen.getByTestId("memon-pi-code-search"), {
				key: "Enter",
			});
			expect(send).toHaveBeenLastCalledWith(
				"piCode.open",
				{ key: "m1", cwd: "~/todo" },
				{ rethrow: true },
			);
			request.mockReset();
		});

		it("goes through folders by click, path or keys, and opens the one shown", async () => {
			const send = renderPicker();
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["projects", "todo"]),
			);
			fireEvent.click(screen.getAllByTestId("memon-pi-code-folder")[0]);
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["api", "web"]),
			);
			expect(screen.getByTestId("memon-pi-code-open-here").textContent).toBe(
				"memonComputer.piCode.picker.openHere",
			);
			fireEvent.click(screen.getByTestId("memon-pi-code-open-here"));
			expect(send).toHaveBeenLastCalledWith(
				"piCode.open",
				{ key: "m1", cwd: "~/projects" },
				{ rethrow: true },
			);

			// A typed path lists its folder; Enter opens the matching one.
			const search = screen.getByTestId("memon-pi-code-search");
			fireEvent.change(search, { target: { value: "~/projects/w" } });
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["web"]),
			);
			expect(screen.queryAllByTestId("memon-pi-code-recent")).toEqual([]);
			fireEvent.keyDown(search, { key: "Enter" });
			expect(send).toHaveBeenLastCalledWith(
				"piCode.open",
				{ key: "m1", cwd: "~/projects/web" },
				{ rethrow: true },
			);

			// Cleared, the folder gone through shows again; Backspace on the
			// empty line goes up from it.
			fireEvent.change(search, { target: { value: "" } });
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["api", "web"]),
			);
			fireEvent.keyDown(search, { key: "Backspace" });
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["projects", "todo"]),
			);
			request.mockReset();
		});

		it("makes a new folder and opens pi in it, refusing a name that is taken", async () => {
			const send = renderPicker();
			await vi.waitFor(() =>
				expect(names("memon-pi-code-folder")).toEqual(["projects", "todo"]),
			);
			fireEvent.click(screen.getByTestId("memon-pi-code-new-folder"));
			const name = screen.getByTestId("memon-pi-code-new-folder-name");
			fireEvent.change(name, { target: { value: "todo" } });
			fireEvent.keyDown(name, { key: "Enter" });
			expect(
				screen.getByText("memonComputer.piCode.picker.nameTaken"),
			).toBeTruthy();
			expect(send).not.toHaveBeenCalled();

			fireEvent.change(name, { target: { value: "game" } });
			fireEvent.keyDown(name, { key: "Enter" });
			expect(send).toHaveBeenLastCalledWith(
				"piCode.open",
				{ key: "m1", cwd: "~/game", create: true },
				{ rethrow: true },
			);
			request.mockReset();
		});

		it("opens the picker from pi's error, to try another folder", async () => {
			request.mockImplementation(async () => [] as never);
			render(
				<PiCodeWindow
					machineKey="m1"
					home={HOME}
					state={{ status: "error", working: false, error: "no model" }}
					focused
					send={vi.fn() as unknown as MemonSend}
				/>,
			);
			expect(screen.queryByTestId("memon-pi-code-picker")).toBeNull();
			fireEvent.click(screen.getByText("memonComputer.piCode.chooseFolder"));
			expect(screen.getByTestId("memon-pi-code-picker")).toBeTruthy();
			fireEvent.click(
				screen.getAllByText("memonComputer.piCode.picker.cancel")[0],
			);
			expect(screen.queryByTestId("memon-pi-code-picker")).toBeNull();
			request.mockReset();
		});

		it("says why a folder did not open", async () => {
			const send = renderPicker();
			send.mockRejectedValueOnce(
				new Error("pi code is working in ~/a; wait for it or stop it first."),
			);
			await vi.waitFor(() =>
				expect(names("memon-pi-code-recent")).toEqual(["todo"]),
			);
			fireEvent.click(screen.getAllByTestId("memon-pi-code-recent")[0]);
			expect((await screen.findByRole("alert")).textContent).toBe(
				"pi code is working in ~/a; wait for it or stop it first.",
			);
			request.mockReset();
		});
	});
});
