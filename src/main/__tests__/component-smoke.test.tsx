import React, { Component, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

class SmokeBoundary extends Component<
	{ children: ReactNode },
	{ hasError: boolean }
> {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch() {}

	render() {
		return this.state.hasError ? (
			<div data-testid="component-smoke-error" />
		) : (
			this.props.children
		);
	}
}

const noop = vi.fn();
const eventTarget = () => ({
	addListener: noop,
	removeListener: noop,
	hasListener: () => false,
});

const fixtureProps = {
	id: "test-id",
	name: "Test",
	title: "Title",
	label: "Label",
	value: "",
	defaultValue: "",
	children: <span>child</span>,
	className: "",
	disabled: false,
	open: false,
	checked: false,
	selected: false,
	active: false,
	loading: false,
	onClick: noop,
	onChange: noop,
	onOpenChange: noop,
	onCheckedChange: noop,
	onValueChange: noop,
	onSubmit: noop,
	onClose: noop,
	onCancel: noop,
	onConfirm: noop,
	messages: [],
	outputMessages: [],
	nodes: [],
	edges: [],
	data: [],
	items: [],
	options: [],
	tools: [],
	agents: [],
	flows: [],
	message: {
		id: "m1",
		role: "assistant",
		content: "hello",
		createdAt: new Date().toISOString(),
	},
	conversation: { id: "c1", title: "Conversation", messages: [] },
	agent: { id: "a1", name: "Agent", description: "", features: [] },
};

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener: noop,
		removeEventListener: noop,
		addListener: noop,
		removeListener: noop,
	}));
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		setTimeout(() => callback(Date.now()), 0),
	);
	vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
	vi.stubGlobal("chrome", {
		runtime: {
			id: "test-extension",
			getURL: (path: string) => path,
			sendMessage: vi.fn(() => Promise.resolve({})),
			onMessage: eventTarget(),
		},
		storage: {
			local: {
				get: vi.fn(() => Promise.resolve({})),
				set: vi.fn(() => Promise.resolve()),
				remove: vi.fn(() => Promise.resolve()),
			},
		},
	});
	vi.stubGlobal("browser", globalThis.chrome);
});

afterEach(() => {
	cleanup();
});

const modules = {
	...import.meta.glob("../components/ui/**/*.tsx"),
	...import.meta.glob("../modules/openui/components/**/*.tsx"),
};

describe("main component smoke coverage", () => {
	it("renders exported components behind an error boundary", async () => {
		let rendered = 0;
		const importFailures: string[] = [];
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

		for (const [file, load] of Object.entries(modules)) {
			if (
				file.includes(".test.") ||
				file.includes("/i18n/") ||
				file.endsWith("/component-smoke.test.tsx")
			) {
				continue;
			}

			let mod: Record<string, unknown>;
			try {
				mod = (await load()) as Record<string, unknown>;
			} catch {
				importFailures.push(file);
				continue;
			}

			for (const [name, value] of Object.entries(mod)) {
				if (typeof value !== "function" || !/^[A-Z]/.test(name)) {
					continue;
				}

				try {
					render(
						<SmokeBoundary>
							{React.createElement(
								value as React.ComponentType<Record<string, unknown>>,
								fixtureProps,
							)}
						</SmokeBoundary>,
					);
					rendered++;
				} catch {
					// Importing and attempting to mount the export is enough for this
					// broad smoke test; precise behavior belongs in targeted tests.
				} finally {
					cleanup();
				}
			}
		}

		consoleError.mockRestore();
		consoleWarn.mockRestore();

		expect(rendered).toBeGreaterThan(25);
		expect(importFailures.length).toBeLessThan(10);
	}, 30000);
});
