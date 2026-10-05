import { describe, expect, it, vi } from "vitest";
import type { MemonPiCodeEntry } from "../../../types";
import {
	MemonPiCode,
	type MemonPiCodePort,
	type PiCodeRunner,
} from "../pi-code-app";

const HOME = "/agents/Bot";

/** A pi that takes prompts and finishes at once, unless told otherwise. */
const fakeRunner = (cwd: string) => {
	const submitted: Array<{ text: string; queue?: string }> = [];
	const entries: MemonPiCodeEntry[] = [];
	let idle = true;
	const runner: PiCodeRunner = {
		status: () => ({ running: !idle, cwd, model: "openrouter/coder" }),
		view: () => ({
			entries,
			earlier: 0,
			thinkingLevel: "off",
			queued: [],
			activity: idle ? undefined : "running bash",
		}),
		attach: () => 0,
		read: async (cursor) => ({ data: "", cursor, reset: false }),
		input: vi.fn(),
		resize: () => {},
		submit: async (text, queue) => {
			submitted.push({ text, queue });
			entries.push(
				{ kind: "user", text },
				{ kind: "assistant", text: "Done." },
			);
		},
		interrupt: vi.fn(async () => {}),
		newSession: vi.fn(async () => {}),
		compact: vi.fn(async () => {}),
		waitForIdle: async () => idle,
		dispose: vi.fn(async () => {}),
	};
	return {
		runner,
		submitted,
		setIdle: (value: boolean) => {
			idle = value;
		},
	};
};

const setup = () => {
	const runners: Array<ReturnType<typeof fakeRunner>> = [];
	const port: MemonPiCodePort = {
		start: vi.fn(async ({ cwd }) => {
			const fake = fakeRunner(cwd ?? HOME);
			runners.push(fake);
			return fake.runner;
		}),
	};
	let windowOpen = false;
	let enabled = true;
	let runId: string | null = "run-1";
	const host = {
		sessionKey: "machine",
		agentId: () => "agent-1",
		home: () => HOME,
		changed: vi.fn(),
		quit: vi.fn(() => {
			windowOpen = false;
			void piCode.stop();
		}),
		enabled: () => enabled,
		// The machine's openWindow("pi") starts pi.
		show: vi.fn(() => {
			const opened = !windowOpen;
			windowOpen = true;
			piCode.start();
			return opened;
		}),
		cursorLabel: vi.fn(),
		runId: () => runId,
	};
	const piCode = new MemonPiCode(host, port);
	return {
		piCode,
		port,
		host,
		runners,
		isWindowOpen: () => windowOpen,
		setEnabled: (value: boolean) => {
			enabled = value;
		},
		setRun: (value: string | null) => {
			runId = value;
		},
	};
};

/** Lets the agent's call reach its question. */
const asked = async (piCode: MemonPiCode) => {
	await vi.waitFor(() => expect(piCode.state()?.approval).toBeDefined());
	const approval = piCode.state()?.approval;
	if (!approval) throw new Error("no question");
	return approval;
};

describe("pi code, driven by the Memon agent", () => {
	it("asks the user in the pi window first; allowed, pi starts in the folder and gets the work", async () => {
		const { piCode, port, host, runners, isWindowOpen, setRun } = setup();

		const call = piCode.act({
			action: "prompt",
			text: "Build a todo API with tests",
			cwd: "~/todo",
		});
		const approval = await asked(piCode);
		// The question waits in the open window; pi itself is not started yet.
		expect(approval.task).toBe("Build a todo API with tests");
		expect(piCode.state()).toMatchObject({ status: "idle", working: false });
		expect(isWindowOpen()).toBe(true);
		expect(port.start).not.toHaveBeenCalled();
		expect(host.cursorLabel).toHaveBeenCalledWith("Waiting for your approval");

		piCode.answerApproval(approval.id, "approve");
		const summary = await call;
		expect(summary).toBe(
			"Sent to pi code. pi code is done; its answer is on the screen. Check its work before you answer.",
		);
		expect(port.start).toHaveBeenCalledWith(
			expect.objectContaining({ home: HOME, cwd: `${HOME}/todo` }),
		);
		expect(runners[0].submitted).toEqual([
			{ text: "Build a todo API with tests", queue: undefined },
		]);
		expect(piCode.state()).toMatchObject({
			status: "running",
			cwd: `${HOME}/todo`,
			transcript: [
				{ kind: "user", text: "Build a todo API with tests" },
				{ kind: "assistant", text: "Done." },
			],
		});

		// Allowed once per run: a follow-up in the same run goes straight in.
		await piCode.act({ action: "prompt", text: "Add a README" });
		expect(runners[0].submitted).toHaveLength(2);

		// The next message is a new run: the user is asked again.
		setRun("run-2");
		const next = piCode.act({ action: "prompt", text: "Add auth" });
		const again = await asked(piCode);
		piCode.answerApproval(again.id, "approve");
		await next;
		expect(runners[0].submitted.map((entry) => entry.text)).toEqual([
			"Build a todo API with tests",
			"Add a README",
			"Add auth",
		]);
	});

	it("declined: pi never starts, the window goes, and the agent codes it itself and remembers", async () => {
		const { piCode, port, host, isWindowOpen } = setup();

		const call = piCode.act({ action: "prompt", text: "Fix the failing test" });
		const approval = await asked(piCode);
		piCode.answerApproval(approval.id, "deny");
		const summary = await call;

		expect(summary).toContain("The user declined pi code for this.");
		expect(summary).toContain(
			"Do the coding yourself with the Terminal and Files.",
		);
		expect(summary).toContain(
			'memon_memory { action: "add", text: "Code it myself; the user does not want pi code." }',
		);
		expect(summary).toContain("do not use pi code again unless the user asks");
		expect(port.start).not.toHaveBeenCalled();
		expect(host.quit).toHaveBeenCalled();
		expect(isWindowOpen()).toBe(false);
		expect(piCode.state()).toBeUndefined();
	});

	it("keeps a window the user had open when they decline", async () => {
		const { piCode, host } = setup();
		host.show();
		await vi.waitFor(() => expect(piCode.state()?.status).toBe("running"));

		const call = piCode.act({ action: "prompt", text: "Refactor" });
		piCode.answerApproval((await asked(piCode)).id, "deny");
		await call;
		expect(host.quit).not.toHaveBeenCalled();
		expect(piCode.state()?.status).toBe("running");
	});

	it("Stop releases the agent's waiting call; closing the window answers it too", async () => {
		const { piCode } = setup();
		const stopped = piCode.act({ action: "prompt", text: "Build it" });
		await asked(piCode);
		piCode.cancelWaits();
		expect(await stopped).toBe("The user stopped the run before answering.");

		const closed = piCode.act({ action: "prompt", text: "Build it" });
		await asked(piCode);
		await piCode.stop();
		expect(await closed).toBe(
			"The user closed pi code instead of answering. Do the coding yourself with the Terminal and Files.",
		);
		expect(piCode.state()).toBeUndefined();
	});

	it("says when pi is still working, and steers or stops it on request", async () => {
		const { piCode, runners } = setup();
		const first = piCode.act({
			action: "prompt",
			text: "Build it",
			waitSeconds: 1,
		});
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;
		const pi = runners[0];
		pi.setIdle(false);

		const steer = await piCode.act({
			action: "prompt",
			text: "Use SQLite",
			waitSeconds: 1,
		});
		expect(steer).toBe(
			'Queued for pi code (after its current tools). pi code is still working (running bash). memon_code { action: "wait" } waits for it; a prompt steers it; { action: "stop" } stops it.',
		);
		expect(pi.submitted.at(-1)).toEqual({
			text: "Use SQLite",
			queue: undefined,
		});

		expect(await piCode.act({ action: "stop" })).toBe(
			"Stopped pi code; its queued messages were dropped.",
		);
		expect(pi.runner.interrupt).toHaveBeenCalled();
	});

	it("types keys into pi after asking, as the user would", async () => {
		const { piCode, runners } = setup();
		const call = piCode.act({
			action: "keys",
			text: "/name api",
			key: "enter",
		});
		const approval = await asked(piCode);
		expect(approval.task).toBe('Type in pi: "/name api" then enter');
		piCode.answerApproval(approval.id, "approve");
		await call;
		expect(runners[0].runner.input).toHaveBeenCalledWith("/name api\r");
	});

	it("refuses while pi code is turned off, and keeps one folder per session", async () => {
		const { piCode, setEnabled } = setup();
		setEnabled(false);
		await expect(
			piCode.act({ action: "prompt", text: "Build it" }),
		).rejects.toThrow(/turned off for this agent/);

		setEnabled(true);
		const first = piCode.act({
			action: "prompt",
			text: "Build it",
			cwd: "~/a",
		});
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;
		await expect(
			piCode.act({ action: "prompt", text: "Other", cwd: "~/b" }),
		).rejects.toThrow(
			'pi code works in ~/a. Close it first ({ action: "close" }) to start it in ~/b',
		);
	});
});
