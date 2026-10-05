import { describe, expect, it, vi } from "vitest";
import type { MemonPiCodeEntry } from "../../../types";
import {
	MemonPiCode,
	type MemonPiCodePort,
	type PiCodeRunner,
} from "../pi-code-app";

const HOME = "/agents/Bot";

/** A pi that takes prompts and finishes at once, unless told otherwise. */
const fakeRunner = (cwd: string, createdCwd = false) => {
	const submitted: Array<{ text: string; queue?: string }> = [];
	const entries: MemonPiCodeEntry[] = [];
	let idle = true;
	/** Prompts start a turn that runs until finish() or a stop. */
	let works = false;
	let disposed = false;
	let turn: { ended?: "done" | "error" | "stopped"; reply?: string } = {};
	const runner: PiCodeRunner = {
		status: () => ({ running: !idle, cwd, model: "openrouter/coder" }),
		view: () => ({
			entries,
			earlier: 0,
			...turn,
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
			entries.push({ kind: "user", text });
			if (works) {
				idle = false;
				return;
			}
			entries.push({ kind: "assistant", text: "Done." });
			turn = { ended: "done", reply: "Done." };
		},
		interrupt: vi.fn(async () => {
			idle = true;
			entries.push({ kind: "error", text: "stopped" });
			turn = { ...turn, ended: "stopped" };
		}),
		newSession: vi.fn(async () => {}),
		compact: vi.fn(async () => {}),
		// As pi's own: idle, quit, the signal or the timeout ends it.
		waitForIdle: (timeoutMs, signal) => {
			const deadline = Date.now() + timeoutMs;
			return new Promise((resolve) => {
				const tick = () => {
					if (disposed) return resolve(true);
					if (idle || signal?.aborted || Date.now() >= deadline)
						return resolve(idle);
					setTimeout(tick, 10);
				};
				tick();
			});
		},
		dispose: vi.fn(async () => {
			disposed = true;
		}),
		createdCwd,
	};
	return {
		runner,
		submitted,
		setIdle: (value: boolean) => {
			idle = value;
		},
		keepWorking: () => {
			works = true;
		},
		/** pi's turn ends: it answers, asks, fails or was stopped. */
		finish: (ended: "done" | "error" | "stopped", reply?: string) => {
			if (reply) entries.push({ kind: "assistant", text: reply });
			if (ended === "error")
				entries.push({ kind: "error", text: "rate limited" });
			if (ended === "stopped") entries.push({ kind: "error", text: "stopped" });
			turn = { ended, reply };
			idle = true;
		},
	};
};

const setup = () => {
	const runners: Array<ReturnType<typeof fakeRunner>> = [];
	/** Folders in Files; pi makes any other one it starts in. */
	const folders = new Set([HOME, `${HOME}/a`, `${HOME}/todo`]);
	/** What pi's /resume calls, from the latest start. */
	let resume: ((sessionFile: string, cwd: string) => void) | undefined;
	const port: MemonPiCodePort = {
		start: vi.fn(async ({ cwd, onResume }) => {
			const folder = cwd ?? HOME;
			const fake = fakeRunner(folder, !folders.has(folder));
			folders.add(folder);
			resume = onResume;
			runners.push(fake);
			return fake.runner;
		}),
	};
	let windowOpen = false;
	let front = true;
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
		inFront: () => windowOpen && front,
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
		/** The user brings another window to the front, or pi's back. */
		setFront: (value: boolean) => {
			front = value;
		},
		/** The user picks a saved session with /resume in pi. */
		resume: (sessionFile: string, cwd: string) => resume?.(sessionFile, cwd),
	};
};

const ANSWER_OR_CHECK =
	'If it asks you something, answer it with memon_code { action: "prompt", text }; ask the user only what you cannot decide. Otherwise check its work before you answer.';

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
			`Sent to pi code. pi code's turn is over; its reply is on the screen. ${ANSWER_OR_CHECK}`,
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
			waitSeconds: 0.05,
		});
		expect(steer).toBe(
			'Queued for pi code (after its current tools). pi code is still working (running bash). memon_code { action: "wait" } waits for it again; a prompt steers it; { action: "stop" } stops it.',
		);
		expect(pi.submitted.at(-1)).toEqual({
			text: "Use SQLite",
			queue: undefined,
		});

		expect(await piCode.act({ action: "stop" })).toBe(
			"Stopped pi code; its queued messages were dropped.",
		);
		expect(pi.runner.interrupt).toHaveBeenCalled();
		// The agent's own stop is not the user's.
		expect(await piCode.act({ action: "wait" })).toBe("pi code is stopped.");
	});

	it("a prompt waits until pi's turn ends, then hands back what pi asks", async () => {
		const { piCode, runners, setFront } = setup();
		const first = piCode.act({ action: "prompt", text: "Build it" });
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;
		const pi = runners[0];

		pi.keepWorking();
		const call = piCode.act({ action: "prompt", text: "Add auth" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		let returned = false;
		void call.then(() => {
			returned = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		// Still working: the call holds, no "wait" turns needed.
		expect(returned).toBe(false);

		pi.finish("done", "Sessions or JWT for auth?");
		expect(await call).toBe(
			`Sent to pi code. pi code's turn is over; its reply is on the screen. ${ANSWER_OR_CHECK}`,
		);

		// Another window in front: the screen does not show pi, the summary does.
		setFront(false);
		const asking = piCode.act({ action: "prompt", text: "Add a login page" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		pi.finish("done", "Which route, /login or /signin?");
		expect(await asking).toBe(
			`Sent to pi code. pi code's turn is over. Its reply:\nWhich route, /login or /signin?\n\n${ANSWER_OR_CHECK}`,
		);
	});

	it("the user stops pi from MemonOS: the waiting agent hears it was them", async () => {
		const { piCode, runners } = setup();
		const first = piCode.act({ action: "prompt", text: "Build it" });
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;
		const pi = runners[0];

		pi.keepWorking();
		const call = piCode.act({ action: "prompt", text: "Rewrite the API" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		await piCode.interrupt();
		const summary = await call;
		expect(pi.runner.interrupt).toHaveBeenCalled();
		expect(summary).toContain("Sent to pi code. The user stopped pi code.");
		expect(summary).toContain("Do not hand pi the same work again unchanged.");

		// Escape in pi's own window ends the turn the same way.
		const escaped = piCode.act({ action: "prompt", text: "Try again" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		pi.finish("stopped");
		expect(await escaped).toContain("The user stopped pi code.");
	});

	it("ends the wait when the user writes to the agent, or closes pi, or pi fails", async () => {
		const { piCode, runners, host } = setup();
		const first = piCode.act({ action: "prompt", text: "Build it" });
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;
		const pi = runners[0];

		let unread = 0;
		pi.setIdle(false);
		const call = piCode.act({ action: "wait" }, { inbox: () => unread });
		unread = 1;
		expect(await call).toBe(
			'pi code is still working (running bash). The user wrote to you: read it first. memon_code { action: "wait" } waits for it again; a prompt steers it; { action: "stop" } stops it.',
		);

		const failing = piCode.act({ action: "wait" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		pi.finish("error");
		expect(await failing).toBe("pi code stopped on an error: rate limited");

		pi.setIdle(false);
		const closing = piCode.act({ action: "wait" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		host.quit();
		expect(await closing).toBe(
			"The user closed pi code before it finished; its session is saved in ~/.pi/agent/sessions. Find out why before you go on.",
		);
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

	it("refuses while pi code is turned off, and moves pi to another folder while it is idle", async () => {
		const { piCode, setEnabled, runners, port } = setup();
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
		expect(await first).toMatch(/^Sent to pi code\. /);

		// Idle in ~/a: pi starts again in ~/b, without asking the user again.
		const moved = await piCode.act({
			action: "prompt",
			text: "Other",
			cwd: "~/b",
		});
		expect(moved).toContain(
			"pi code moved from ~/a to ~/b; its session there is saved (/resume in pi opens it).",
		);
		// A folder that was not there is called out: the agent may have guessed it.
		expect(moved).toContain(
			"~/b was not there: pi made it, empty. If the project is elsewhere, prompt again with its folder as cwd.",
		);
		expect(runners[0].runner.dispose).toHaveBeenCalled();
		expect(port.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ cwd: `${HOME}/b` }),
		);
		expect(runners[1].submitted).toEqual([{ text: "Other", queue: undefined }]);
		expect(piCode.state()?.approval).toBeUndefined();

		// Working: pi is not moved under it.
		runners[1].keepWorking();
		await piCode.act({ action: "prompt", text: "Long job", waitSeconds: 0 });
		await expect(
			piCode.act({ action: "prompt", text: "Back", cwd: "~/a" }),
		).rejects.toThrow(
			'pi code is working in ~/b. Wait for it or stop it ({ action: "stop" }), then hand it work in ~/a.',
		);
	});

	it("/resume starts pi again on the saved session; a waiting agent hears it", async () => {
		const { piCode, runners, port, resume, isWindowOpen } = setup();
		const first = piCode.act({
			action: "prompt",
			text: "Build it",
			cwd: "~/a",
		});
		piCode.answerApproval((await asked(piCode)).id, "approve");
		await first;

		runners[0].keepWorking();
		const waiting = piCode.act({ action: "prompt", text: "Add tests" });
		await new Promise((resolve) => setTimeout(resolve, 30));
		const saved = `${HOME}/.pi/agent/sessions/--agents-Bot-a--/older.jsonl`;
		resume(saved, `${HOME}/a`);
		expect(await waiting).toBe(
			"Sent to pi code. pi code opened another saved session (/resume); its conversation is on the screen. Hand pi the work again if it still matters.",
		);
		await vi.waitFor(() => expect(piCode.state()?.status).toBe("running"));
		expect(port.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ cwd: `${HOME}/a`, sessionFile: saved }),
		);
		expect(runners[0].runner.dispose).toHaveBeenCalled();
		// The same window, and the run's answer stands.
		expect(isWindowOpen()).toBe(true);
		await piCode.act({ action: "prompt", text: "Go on" });
		expect(runners[1].submitted.at(-1)?.text).toBe("Go on");

		// Again, from the resumed pi: a session of another folder opens there,
		// and each start of pi is a new instance for the window to attach to.
		const firstInstance = piCode.state()?.instance;
		const other = `${HOME}/.pi/agent/sessions/--projects-game--/game.jsonl`;
		resume(other, "/projects/game");
		await vi.waitFor(() => expect(runners).toHaveLength(3));
		await vi.waitFor(() => expect(piCode.state()?.status).toBe("running"));
		expect(port.start).toHaveBeenLastCalledWith(
			expect.objectContaining({ cwd: "/projects/game", sessionFile: other }),
		);
		expect(runners[1].runner.dispose).toHaveBeenCalled();
		expect(piCode.state()?.cwd).toBe("/projects/game");
		expect(piCode.state()?.instance).toBeGreaterThan(firstInstance ?? 0);
		await piCode.act({ action: "prompt", text: "Slow the intro" });
		expect(runners[2].submitted.at(-1)?.text).toBe("Slow the intro");
	});
});
