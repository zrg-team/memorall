import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { coAgentAnchorStyles } from "../anchorStyles";
import { CoAgentAnchorTrigger } from "../CoAgentAnchorPrompt";
import type { CoAgentContextAnchor } from "@/co-agent/dom/context-anchor";

vi.mock("motion/react", () => ({
	motion: {
		div: ({
			children,
			...rest
		}: { children?: React.ReactNode } & Record<string, unknown>) => (
			<div {...(rest as Record<string, never>)}>{children}</div>
		),
	},
	useMotionValue: (value: number) => ({ set: () => {}, get: () => value }),
	useSpring: (value: unknown) => value,
}));

const anchor = {
	kind: "hover",
	tagName: "div",
	rect: { top: 100, left: 100, width: 50, height: 20 },
} as unknown as CoAgentContextAnchor;

const renderTrigger = (overrides: Record<string, unknown> = {}) => {
	const props = {
		anchor,
		onAskAboutThis: vi.fn(),
		onAsk: vi.fn(),
		onSmartSelect: vi.fn(),
		onCanvasSelect: vi.fn(),
		isSmartSelectActive: false,
		isCanvasSelectActive: false,
		...overrides,
	};
	const view = render(
		<CoAgentAnchorTrigger
			{...(props as unknown as ComponentProps<typeof CoAgentAnchorTrigger>)}
		/>,
	);
	return { ...view, props };
};

const segments = () =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			".memorall-co-agent-anchor-trigger",
		),
	);

describe("the floating ask control", () => {
	it("offers both pickers between the two ways of asking", () => {
		renderTrigger();
		const order = segments();

		expect(order).toHaveLength(4);
		// Ask about this | smart | canvas | Ask — the pickers sit in the middle,
		// which is the whole point of putting them in this control.
		expect(order[0].textContent).not.toBe("");
		expect(order[1].className).toContain("--icon");
		expect(order[2].className).toContain("--icon");
		expect(order[3].textContent).not.toBe("");
	});

	it("labels the icon-only segments", () => {
		renderTrigger();

		for (const icon of segments().filter((node) =>
			node.className.includes("--icon"),
		)) {
			expect(icon.textContent?.trim()).toBe("");
			expect(icon.getAttribute("aria-label")).toBeTruthy();
			expect(icon.getAttribute("title")).toBeTruthy();
		}
	});

	it("starts each picker", async () => {
		const user = userEvent.setup();
		const { props } = renderTrigger();
		const [, smart, canvas] = segments();

		await user.click(smart);
		expect(props.onSmartSelect).toHaveBeenCalledTimes(1);

		await user.click(canvas);
		expect(props.onCanvasSelect).toHaveBeenCalledTimes(1);
	});

	it("shows which picker is running", () => {
		renderTrigger({ isCanvasSelectActive: true });

		const active = document.querySelectorAll(
			'.memorall-co-agent-anchor-trigger[data-active="true"]',
		);
		expect(active).toHaveLength(1);
		expect(active[0].getAttribute("aria-pressed")).toBe("true");
	});
});

describe("the floating ask control's theme", () => {
	/**
	 * It floats over the page beside the dock, so it has to read as the same
	 * surface. Painting it with --foreground made it follow the theme backwards:
	 * a white pill next to a dark dock.
	 */
	const groupRule =
		/\.memorall-co-agent-anchor-trigger-group\s*\{([^}]*)\}/.exec(
			coAgentAnchorStyles,
		)?.[1] ?? "";
	const pillRule = /\.memorall-co-agent-anchor-trigger\s*\{([^}]*)\}/.exec(
		coAgentAnchorStyles,
	)?.[1];

	it("paints the pill as a surface, not as inverted ink", () => {
		expect(pillRule).toBeTruthy();
		expect(pillRule).toContain("background: hsl(var(--popover))");
		expect(pillRule).toContain("color: hsl(var(--foreground))");
	});

	it("paints the segmented group as the same surface", () => {
		expect(groupRule).toContain("background: hsl(var(--popover))");
		expect(groupRule).not.toContain("background: hsl(var(--foreground))");
	});
});
