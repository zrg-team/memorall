import { afterEach, describe, expect, it, vi } from "vitest";
import { createTabTranscriptionControls } from "./tab-transcription";
import type { TranscriptionViewActions } from "./tab-transcription-view";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});
const session = {
	id: "meeting",
	tabId: 7,
	status: "recording",
	noteStyle: "none",
};

describe("tab transcription relay", () => {
	it("loads the shared UI only for an active recording and polls live text every 300ms", async () => {
		vi.useFakeTimers();
		const view = { update: vi.fn(), destroy: vi.fn() };
		const mount = vi.fn(async () => view);
		const request = vi.fn().mockResolvedValue({ success: true, session: null });
		const controls = createTabTranscriptionControls(request, vi.fn(), mount);
		controls.restore();
		await vi.advanceTimersByTimeAsync(0);
		expect(mount).not.toHaveBeenCalled();
		request.mockResolvedValue({
			success: true,
			session,
			progress: { phase: "recording", session, chunks: [] },
		});
		controls.show();
		await vi.advanceTimersByTimeAsync(0);
		expect(mount).toHaveBeenCalledOnce();
		expect(view.update).toHaveBeenCalledWith(
			expect.objectContaining({ session }),
			true,
		);
		await vi.advanceTimersByTimeAsync(300);
		expect(view.update).toHaveBeenCalledTimes(2);
		request.mockResolvedValue({
			success: true,
			session: null,
			progress: {
				phase: "failed",
				session: { ...session, error: "Model failed" },
			},
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(view.update).toHaveBeenLastCalledWith(
			expect.objectContaining({
				progress: expect.objectContaining({ phase: "failed" }),
			}),
			false,
		);
		const calls = request.mock.calls.length;
		await vi.advanceTimersByTimeAsync(5000);
		expect(request).toHaveBeenCalledTimes(calls);
		controls.dispose();
		expect(view.destroy).toHaveBeenCalledOnce();
	});
	it("relays finish and post-recording action failures to the shared view", async () => {
		vi.useFakeTimers();
		let actions!: TranscriptionViewActions;
		const request = vi.fn().mockResolvedValue({ success: true, session });
		const open = vi.fn();
		const controls = createTabTranscriptionControls(
			request,
			open,
			async (value) => {
				actions = value;
				return { update: vi.fn(), destroy: vi.fn() };
			},
		);
		controls.show();
		await vi.advanceTimersByTimeAsync(0);
		await actions.stop("notes");
		expect(request).toHaveBeenCalledWith({
			action: "stop",
			noteStyle: "notes",
		});
		request.mockResolvedValue({
			success: false,
			error: "Recording unavailable",
		});
		await expect(actions.perform("save")).rejects.toThrow(
			"Recording unavailable",
		);
		await actions.openStudio("meeting");
		expect(open).toHaveBeenCalledWith("meeting");
		controls.dispose();
	});
	it("disposes a UI that finishes loading after the content script was destroyed", async () => {
		vi.useFakeTimers();
		let resolve!: (value: any) => void;
		const view = { update: vi.fn(), destroy: vi.fn() };
		const controls = createTabTranscriptionControls(
			vi.fn().mockResolvedValue({ success: true, session }),
			vi.fn(),
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		controls.show();
		await vi.advanceTimersByTimeAsync(0);
		controls.dispose();
		resolve(view);
		await vi.advanceTimersByTimeAsync(0);
		expect(view.destroy).toHaveBeenCalledOnce();
		expect(view.update).not.toHaveBeenCalled();
	});
	it("dismisses the view and polling without a stop command, ignores in-flight progress, and reopens on show", async () => {
		vi.useFakeTimers();
		let actions!: TranscriptionViewActions;
		const view = { update: vi.fn(), destroy: vi.fn() };
		const request = vi.fn().mockResolvedValue({ success: true, session });
		const mount = vi.fn(async (value: TranscriptionViewActions) => {
			actions = value;
			return view;
		});
		const controls = createTabTranscriptionControls(request, vi.fn(), mount);
		controls.show();
		await vi.advanceTimersByTimeAsync(0);
		let resolve!: (value: unknown) => void;
		request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		await vi.advanceTimersByTimeAsync(300);
		actions.close!();
		expect(view.destroy).toHaveBeenCalledOnce();
		resolve({ success: true, session });
		controls.restore();
		await vi.advanceTimersByTimeAsync(5000);
		expect(request).toHaveBeenCalledTimes(2);
		expect(view.update).toHaveBeenCalledOnce();
		expect(
			request.mock.calls.every(([command]) => command.action === "status"),
		).toBe(true);
		controls.show();
		await vi.advanceTimersByTimeAsync(0);
		expect(mount).toHaveBeenCalledTimes(2);
		expect(view.update).toHaveBeenCalledTimes(2);
		controls.dispose();
	});
});
