import React from "react";
import type { MemonCursorState } from "@/services/memon/types";

/**
 * The agent's cursor, scoped to the desktop: a blue arrow with a pulsing ring
 * at its tip and a label naming what it does. It is drawn here rather than by
 * the global AgentCursor, whose moveTo event targets the whole app window and
 * would clamp to it.
 */
export const MemonAgentCursor: React.FC<{
	cursor: MemonCursorState | null;
	visible: boolean;
	desktopRef: React.RefObject<HTMLDivElement | null>;
	/** Re-measure when the layout under the cursor changes. */
	revision: number;
}> = ({ cursor, visible, desktopRef, revision }) => {
	const [point, setPoint] = React.useState<{ x: number; y: number } | null>(
		null,
	);

	React.useLayoutEffect(() => {
		const desktop = desktopRef.current;
		if (!desktop || !cursor?.windowId) {
			setPoint(null);
			return;
		}
		const frame = desktop.querySelector(
			`[data-memon-window="${cursor.windowId}"]`,
		);
		const target =
			(cursor.ref &&
				frame?.querySelector(`[data-memon-ref="${cursor.ref}"]`)) ||
			frame;
		if (!target) {
			setPoint(null);
			return;
		}
		const box = desktop.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		setPoint({
			x: rect.left - box.left + Math.min(rect.width / 2, 28),
			y: rect.top - box.top + Math.min(rect.height / 2, 16),
		});
	}, [cursor, desktopRef, revision]);

	if (!visible || !cursor || !point) return null;
	return (
		<div
			className="pointer-events-none absolute left-0 top-0 z-[9000] transition-transform duration-500 ease-out motion-reduce:transition-none"
			style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
		>
			<span className="absolute -left-3 -top-3 h-6 w-6 animate-ping rounded-full border-2 border-blue-500 motion-reduce:animate-none" />
			<svg
				width="24"
				height="24"
				viewBox="0 0 24 24"
				aria-hidden="true"
				className="relative -left-[3px] -top-[2px] drop-shadow-[0_3px_6px_rgb(30_64_175/0.45)]"
			>
				<path
					d="M3 1.5l17 9-7.4 1.9L8.9 20z"
					fill="#2563EB"
					stroke="#FFFFFF"
					strokeWidth="1.6"
					strokeLinejoin="round"
				/>
			</svg>
			{cursor.label ? (
				<span className="absolute left-5 top-5 flex h-7 max-w-[260px] items-center rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-600/30">
					<span className="truncate">{cursor.label}</span>
				</span>
			) : null}
		</div>
	);
};

const prefersReducedMotion = () =>
	typeof window !== "undefined" &&
	window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const hasFinePointer = () =>
	typeof window !== "undefined" &&
	window.matchMedia?.("(pointer: fine)").matches === true;

/**
 * The user's own pointer over the computer: an orange arrow with a name tag,
 * so it never reads as the bot's blue cursor. Over a control that carries a
 * ref, the tag shows that ref. It is purely visual: the layer ignores the
 * pointer, and the system pointer comes back over iframes, resize handles and
 * while a capture is being picked. Mount it outside the captured desktop so
 * screenshots never include it.
 */
export const MemonUserCursor: React.FC<{
	areaRef: React.RefObject<HTMLElement | null>;
	enabled: boolean;
	label: string;
}> = ({ areaRef, enabled, label }) => {
	const layerRef = React.useRef<HTMLDivElement>(null);
	const refTagRef = React.useRef<HTMLSpanElement>(null);
	const rippleRef = React.useRef<HTMLSpanElement>(null);

	React.useEffect(() => {
		const area = areaRef.current;
		const layer = layerRef.current;
		if (!enabled || !area || !layer || !hasFinePointer()) return;
		area.setAttribute("data-memon-user-cursor", "");
		let frame = 0;
		let x = 0;
		let y = 0;
		const place = () => {
			frame = 0;
			layer.style.transform = `translate(${x}px, ${y}px)`;
		};
		const hide = () => {
			layer.style.visibility = "hidden";
		};
		const move = (event: PointerEvent) => {
			if (event.pointerType !== "mouse") return hide();
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest("iframe, .cursor-nwse-resize")) return hide();
			const box = area.getBoundingClientRect();
			x = event.clientX - box.left;
			y = event.clientY - box.top;
			const text = Boolean(
				target?.closest("input, textarea, [contenteditable='true']"),
			);
			const hot =
				!text &&
				Boolean(
					target?.closest(
						"button, a[href], select, summary, [role='button'], [role='tab'], [role='menuitem']",
					),
				);
			layer.setAttribute("data-mode", text ? "text" : hot ? "hot" : "idle");
			const ref =
				target?.closest("[data-memon-ref]")?.getAttribute("data-memon-ref") ??
				"";
			const tag = refTagRef.current;
			if (tag) {
				tag.textContent = ref;
				tag.style.display = ref ? "" : "none";
			}
			layer.style.visibility = "visible";
			if (!frame) frame = requestAnimationFrame(place);
		};
		const out = (event: PointerEvent) => {
			const next = event.relatedTarget;
			if (!(next instanceof Node) || !area.contains(next)) hide();
		};
		const down = () => {
			const ripple = rippleRef.current;
			if (!ripple || prefersReducedMotion() || !ripple.animate) return;
			ripple.animate(
				[
					{ transform: "scale(0.3)", opacity: 1 },
					{ transform: "scale(1.4)", opacity: 0 },
				],
				{ duration: 450, easing: "ease-out" },
			);
		};
		area.addEventListener("pointermove", move);
		area.addEventListener("pointerout", out);
		area.addEventListener("pointerleave", hide);
		area.addEventListener("pointerdown", down);
		return () => {
			area.removeEventListener("pointermove", move);
			area.removeEventListener("pointerout", out);
			area.removeEventListener("pointerleave", hide);
			area.removeEventListener("pointerdown", down);
			area.removeAttribute("data-memon-user-cursor");
			if (frame) cancelAnimationFrame(frame);
			hide();
		};
	}, [areaRef, enabled]);

	return (
		<div
			ref={layerRef}
			aria-hidden="true"
			className="group pointer-events-none invisible absolute left-0 top-0 z-[9500] will-change-transform"
		>
			<span
				ref={rippleRef}
				className="absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-orange-400 opacity-0"
			/>
			<svg
				width="26"
				height="26"
				viewBox="0 0 26 26"
				aria-hidden="true"
				className="absolute -left-[3px] -top-[2px] origin-[3px_2px] drop-shadow-[0_3px_5px_rgb(0_0_0/0.45)] transition-transform duration-150 group-data-[mode=hot]:scale-[1.14] group-data-[mode=text]:hidden motion-reduce:transition-none"
			>
				<path
					d="M5.2 3.1c-.8-.5-1.8.1-1.8 1v16.3c0 1 1.2 1.5 1.9.8l3.9-3.7c.3-.3.7-.4 1.1-.4h5.6c1 0 1.5-1.2.8-1.9z"
					fill="#FB923C"
					stroke="#FFFFFF"
					strokeWidth="1.7"
					strokeLinejoin="round"
				/>
			</svg>
			<svg
				width="14"
				height="26"
				viewBox="0 0 14 26"
				aria-hidden="true"
				className="absolute -left-[7px] -top-[13px] hidden drop-shadow-[0_2px_4px_rgb(0_0_0/0.5)] group-data-[mode=text]:block"
			>
				<path
					d="M3 2h8M3 24h8M7 2v22"
					stroke="#FB923C"
					strokeWidth="2.4"
					strokeLinecap="round"
				/>
			</svg>
			<span className="absolute left-5 top-[22px] flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[4px_12px_12px_12px] bg-orange-400 pl-1 pr-2 text-xs font-semibold text-orange-950 shadow-lg shadow-orange-500/30 transition-transform duration-150 group-data-[mode=hot]:translate-x-0.5 group-data-[mode=hot]:translate-y-0.5 group-data-[mode=text]:left-3 group-data-[mode=text]:top-3.5 motion-reduce:transition-none">
				<span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-950 text-[9px] font-bold uppercase text-orange-300">
					{label.slice(0, 1)}
				</span>
				{label}
				<span
					ref={refTagRef}
					style={{ display: "none" }}
					className="border-l border-orange-950/30 pl-1.5 font-mono font-medium"
				/>
			</span>
		</div>
	);
};
