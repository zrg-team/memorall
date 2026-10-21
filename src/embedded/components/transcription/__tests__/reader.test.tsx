import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { enEmbeddedLocale } from "@/embedded/i18n/locales/en";
import type { TabTranscriptionProgress } from "@/services/tab-transcription/types";
import { EmbeddedTranscription } from "../EmbeddedTranscription";
import { transcriptionStyles } from "../styles";

vi.mock("@/embedded/hooks/use-embedded-language", () => ({
	useEmbeddedTranslation:
		() =>
		(
			key: keyof typeof enEmbeddedLocale.transcription,
			values: Record<string, unknown> = {},
		) =>
			enEmbeddedLocale.transcription[key].replace(/\{(\w+)\}/g, (_, name) =>
				String(values[name] ?? name),
			),
}));
const progress: TabTranscriptionProgress = {
	session: {
		id: "session",
		title: "A video worth remembering",
		tabId: 7,
		url: "https://example.com",
		startedAt: Date.now(),
		status: "recording",
		noteStyle: "none",
		model: {
			provider: "transformer-media",
			serviceName: "transformer-media",
			modelId: "asr",
		},
	},
	phase: "recording",
	capturedMs: 10000,
	savedMs: 10000,
	transcribedMs: 5000,
	totalChunks: 2,
	savedChunks: 2,
	completedChunks: 1,
	failedChunks: 0,
	pendingChunks: 1,
	currentChunkId: "b",
	chunks: [
		{
			id: "a",
			index: 0,
			startMs: 0,
			endMs: 5000,
			status: "done",
			text: "Xin chào mọi người.",
		},
		{
			id: "b",
			index: 1,
			startMs: 5000,
			endMs: 10000,
			status: "pending",
			text: "<|0.00|>Nội dung đang cập nhật<|5.",
		},
	],
};
const actions = () => ({
	stop: vi.fn(async () => {}),
	perform: vi.fn(async () => undefined),
	openStudio: vi.fn(),
	close: vi.fn(),
});

describe("quiet transcript reader", () => {
	it("stops recording, then offers an explicit Close without requiring any follow-up action", async () => {
		const handlers = actions();
		const { container, rerender } = render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		expect(await screen.findByText("Xin chào mọi người.")).toBeVisible();
		expect(screen.getByText("Nội dung đang cập nhật")).toBeVisible();
		expect(container.textContent).not.toContain("<|0.00|>");
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Close transcript" }),
		).toBeVisible();
		expect(container.querySelectorAll(".mt-paragraph")).toHaveLength(1);
		expect(container.querySelector(".mt-text")).toHaveTextContent(
			"Xin chào mọi người. Nội dung đang cập nhật",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(handlers.stop).toHaveBeenCalledWith("none");
		expect(handlers.perform).not.toHaveBeenCalled();
		expect(handlers.openStudio).not.toHaveBeenCalled();
		expect(handlers.close).not.toHaveBeenCalled();
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		rerender(
			<EmbeddedTranscription
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next steps" })).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(handlers.perform).not.toHaveBeenCalled();
		expect(container).toBeEmptyDOMElement();
	});
	it("waits for stop acknowledgement without opening choices or sending duplicate stop requests", async () => {
		let acknowledge!: () => void;
		const handlers = {
			...actions(),
			stop: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						acknowledge = resolve;
					}),
			),
		};
		render(
			<EmbeddedTranscription
				state={{ session: null, progress }}
				actions={handlers}
			/>,
		);
		await screen.findByText("Xin chào mọi người.");
		expect(screen.getByRole("status")).toHaveTextContent("Live");
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(handlers.stop).toHaveBeenCalledOnce();
		expect(handlers.stop).toHaveBeenCalledWith("none");
		expect(screen.getByRole("button", { name: "Finishing…" })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Close transcript" }),
		).toBeEnabled();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(handlers.close).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Finishing…" }));
		expect(handlers.stop).toHaveBeenCalledOnce();
		await act(async () => acknowledge());
		expect(handlers.close).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
	});
	it("keeps the panel visible when stopping fails and lets the user retry", async () => {
		const handlers = {
			...actions(),
			stop: vi.fn(async (_style: string) => {}),
		};
		handlers.stop.mockRejectedValueOnce(new Error("Recorder unavailable"));
		render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(
			await screen.findByText("Could not stop the session. Please try again."),
		).toBeVisible();
		expect(handlers.close).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: "Stop recording" }),
		).toBeEnabled();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(handlers.stop).toHaveBeenCalledTimes(2);
		expect(handlers.close).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
	});
	it("stops in Studio without automatically opening the next-step menu", async () => {
		const handlers = actions();
		const { rerender } = render(
			<EmbeddedTranscription
				variant="page"
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(handlers.stop).toHaveBeenCalledWith("none");
		expect(handlers.close).not.toHaveBeenCalled();
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		rerender(
			<EmbeddedTranscription
				variant="page"
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(screen.getByText("Xin chào mọi người.")).toBeVisible();
		expect(handlers.perform).not.toHaveBeenCalled();
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		expect(
			screen.getByRole("menuitem", { name: /Create a summary/ }),
		).toBeEnabled();
	});
	it("opens saved transcripts at the beginning and does not jump down on a refresh", async () => {
		const height = vi
			.spyOn(HTMLElement.prototype, "scrollHeight", "get")
			.mockReturnValue(2000);
		try {
			const done = {
				...progress,
				phase: "complete" as const,
				session: { ...progress.session, status: "complete" as const },
			};
			const { rerender } = render(
				<EmbeddedTranscription
					variant="page"
					state={{ session: null, progress: done }}
					actions={actions()}
				/>,
			);
			await screen.findByText("Xin chào mọi người.");
			const reader = screen.getByLabelText("Reading");
			expect(reader.scrollTop).toBe(0);
			rerender(
				<EmbeddedTranscription
					variant="page"
					state={{
						session: null,
						progress: {
							...done,
							chunks: [
								...done.chunks,
								{
									id: "c",
									index: 2,
									startMs: 10000,
									endMs: 15000,
									status: "done",
									text: "Last saved paragraph.",
								},
							],
						},
					}}
					actions={actions()}
				/>,
			);
			await screen.findByText("Last saved paragraph.");
			expect(reader.scrollTop).toBe(0);
			expect(
				screen.queryByRole("button", { name: /Back to live/ }),
			).not.toBeInTheDocument();
			expect(screen.getByRole("button", { name: "Next steps" })).toBeVisible();
		} finally {
			height.mockRestore();
		}
	});
	it("keeps note failures inside the reader with technical details collapsed", async () => {
		const done = {
			...progress,
			phase: "complete" as const,
			session: {
				...progress.session,
				status: "complete" as const,
				summaryStatus: "failed" as const,
				summaryError: "Provider denied this model",
			},
		};
		const { container } = render(
			<EmbeddedTranscription
				variant="page"
				state={{ session: null, progress: done }}
				actions={actions()}
			/>,
		);
		const notice = container.querySelector(".mt-issue")!;
		expect(notice.parentElement).toHaveClass("memorall-transcription-page");
		expect(
			screen.getByText("Notes could not be created. Your transcript is saved."),
		).toBeVisible();
		expect(screen.getByText("Provider denied this model")).not.toBeVisible();
		await userEvent.click(notice.querySelector("summary")!);
		expect(screen.getByText("Provider denied this model")).toBeVisible();
	});
	it("opens the saved recording's thread and keeps navigation errors visible", async () => {
		const handlers = {
			...actions(),
			openStudio: vi.fn(async (_sessionId?: string) => {}),
		};
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		render(
			<EmbeddedTranscription
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Transcript" })).toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		handlers.openStudio.mockRejectedValueOnce(
			new Error("Could not open recording"),
		);
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Open thread" }),
		);
		expect(handlers.openStudio).toHaveBeenCalledWith("session");
		expect(
			await screen.findByText(
				"This action could not finish. Your transcript is saved.",
			),
		).toBeVisible();
		await userEvent.click(
			screen.getByRole("menuitem", { name: "Open thread" }),
		);
		await waitFor(() =>
			expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
		);
	});
	it("preserves older words and the scroll position while the user reads back", async () => {
		const handlers = actions();
		const { rerender } = render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		const reader = screen.getByLabelText("Reading");
		Object.defineProperties(reader, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { value: 200 },
		});
		reader.scrollTop = 0;
		fireEvent.wheel(reader, { deltaY: -100 });
		fireEvent.scroll(reader);
		expect(
			await screen.findByRole("button", { name: /Back to live/ }),
		).toBeVisible();
		const next = {
			...progress,
			chunks: [
				{
					id: "c",
					index: 2,
					startMs: 10000,
					endMs: 15000,
					status: "done" as const,
					text: "New words arrived.",
				},
			],
		};
		rerender(
			<EmbeddedTranscription
				state={{ session: progress.session, progress: next }}
				actions={handlers}
			/>,
		);
		expect(await screen.findByText("New words arrived.")).toBeVisible();
		expect(screen.getByText("Xin chào mọi người.")).toBeVisible();
		expect(reader.scrollTop).toBe(0);
		await userEvent.click(screen.getByRole("button", { name: /Back to live/ }));
		expect(reader.scrollTop).toBe(1000);
	});
	it("does not pause following when layout changes dispatch a scroll event", async () => {
		const handlers = actions();
		const { rerender } = render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await screen.findByText("Xin chào mọi người.");
		const reader = screen.getByLabelText("Reading");
		Object.defineProperties(reader, {
			scrollHeight: { configurable: true, value: 1000 },
			clientHeight: { value: 200 },
		});
		reader.scrollTop = 0;
		fireEvent.scroll(reader);
		expect(
			screen.queryByRole("button", { name: /Back to live/ }),
		).not.toBeInTheDocument();
		const next = {
			...progress,
			chunks: [
				...progress.chunks,
				{
					id: "c",
					index: 2,
					startMs: 10000,
					endMs: 15000,
					status: "done" as const,
					text: "Following new words.",
				},
			],
		};
		rerender(
			<EmbeddedTranscription
				state={{ session: progress.session, progress: next }}
				actions={handlers}
			/>,
		);
		await screen.findByText("Following new words.");
		expect(reader.scrollTop).toBe(1000);
	});
	it("minimizes without stopping capture and restores the same text", async () => {
		const handlers = actions();
		render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Minimize transcript" }),
		);
		expect(handlers.stop).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getAllByRole("button", { name: "Open live transcript" })[0],
		);
		expect(screen.getByText("Xin chào mọi người.")).toBeVisible();
	});
	it("uses shared theme tokens, app fonts and a bounded, scrollable reader", () => {
		expect(transcriptionStyles).toContain('"Space Grotesk"');
		expect(transcriptionStyles).toContain("hsl(var(--background))");
		expect(transcriptionStyles).toContain("overscroll-behavior: contain");
		expect(transcriptionStyles).toContain("prefers-reduced-motion");
	});
	it("can stop from the minimized reader and close separately without an output menu", async () => {
		const handlers = actions();
		const { container } = render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Minimize transcript" }),
		);
		expect(handlers.stop).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("button", { name: "Stop recording" }),
		);
		expect(handlers.stop).toHaveBeenCalledOnce();
		expect(handlers.stop).toHaveBeenCalledWith("none");
		expect(handlers.close).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(handlers.perform).not.toHaveBeenCalled();
		expect(container).toBeEmptyDOMElement();
	});
	it.each([false, true])(
		"dismisses the live window without invoking any action (minimized: %s)",
		async (minimize) => {
			const handlers = actions();
			const props = {
				state: { session: progress.session, progress },
				actions: handlers,
			};
			const { container, rerender } = render(
				<EmbeddedTranscription {...props} />,
			);
			await screen.findByText("Xin chào mọi người.");
			if (minimize)
				await userEvent.click(
					screen.getByRole("button", { name: "Minimize transcript" }),
				);
			const close = screen.getByRole("button", {
				name: "Close transcript",
			});
			expect(close).toHaveAttribute("title", "Close transcript");
			await userEvent.click(close);
			expect(handlers.close).toHaveBeenCalledOnce();
			expect(handlers.stop).not.toHaveBeenCalled();
			expect(handlers.perform).not.toHaveBeenCalled();
			expect(container).toBeEmptyDOMElement();
			const done = {
				...progress,
				phase: "complete" as const,
				session: { ...progress.session, status: "complete" as const },
			};
			rerender(
				<EmbeddedTranscription
					{...props}
					state={{ session: null, progress: done }}
					reveal={1}
				/>,
			);
			expect(await screen.findByText("Xin chào mọi người.")).toBeVisible();
			expect(
				screen.getByRole("button", { name: "Close transcript" }),
			).toBeVisible();
		},
	);
	it("closes a saved panel while its next-step menu is open", async () => {
		const handlers = actions();
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		const { container } = render(
			<EmbeddedTranscription
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		expect(screen.getByRole("menu")).toBeVisible();
		await userEvent.click(
			screen.getByRole("button", { name: "Close transcript" }),
		);
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(container).toBeEmptyDOMElement();
	});
	it("keeps Close visible beside Next steps so a saved transcript needs no follow-up action", async () => {
		const handlers = actions();
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		const { container } = render(
			<EmbeddedTranscription
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		expect(screen.getByRole("button", { name: "Next steps" })).toBeVisible();
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(handlers.stop).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
		expect(container).toBeEmptyDOMElement();
	});
	it("closes directly from the live footer without stopping or launching another action", async () => {
		const handlers = actions();
		const { container } = render(
			<EmbeddedTranscription
				state={{ session: progress.session, progress }}
				actions={handlers}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(handlers.stop).not.toHaveBeenCalled();
		expect(handlers.perform).not.toHaveBeenCalled();
		expect(container).toBeEmptyDOMElement();
	});
	it("uses Escape to dismiss the menu first, then the floating transcript", async () => {
		const handlers = actions();
		const done = {
			...progress,
			phase: "complete" as const,
			session: { ...progress.session, status: "complete" as const },
		};
		const { container } = render(
			<EmbeddedTranscription
				state={{ session: null, progress: done }}
				actions={handlers}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "Next steps" }));
		await userEvent.keyboard("{Escape}");
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Close transcript" }),
		).toBeVisible();
		expect(handlers.close).not.toHaveBeenCalled();
		await userEvent.keyboard("{Escape}");
		expect(handlers.close).toHaveBeenCalledOnce();
		expect(container).toBeEmptyDOMElement();
	});
});
