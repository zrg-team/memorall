import {
	CO_AGENT_CONTAINER_ID,
	CO_AGENT_STATUS_EVENT,
} from "@/co-agent/constants";

const AGENT_CURSOR_EVENT = "memorall:agent-cursor";
/** How long the cursor lingers after the last movement. */
const CURSOR_IDLE_MS = 2_600;
/** How long the status bubble stays after the last message. */
const STATUS_IDLE_MS = 4_000;

export interface CoAgentOverlayOptions {
	/**
	 * Render the moving cursor.
	 *
	 * False inside Memorall's own window, where the React `AgentCursorOverlay`
	 * mounted by `App.tsx` already listens to the same event — two renderers
	 * would draw two cursors.
	 */
	cursor?: boolean;
	status?: boolean;
}

interface CursorDetail {
	selector?: string;
	index?: number;
	point?: { x: number; y: number };
	rect?: { x: number; y: number; width: number; height: number };
	message?: string;
	mode?: "moveTo" | "jumpTo";
	scrollIntoView?: boolean;
	hide?: boolean;
}

/**
 * The co-agent's visible half, without React.
 *
 * Deliberately dependency-free: this is injected into arbitrary third-party
 * pages in the managed browser, where pulling in React and an animation library
 * would mean shipping half a megabyte into every page and risking a fight with
 * the page's own framework, its CSP, or Trusted Types. The React overlay is
 * still used inside Memorall's own window; both are renderers of the same two
 * window events, which are the actual contract.
 *
 * Everything lives in a shadow root. That is not only for style isolation: the
 * page-reading code walks `document` and would otherwise describe the co-agent's
 * own UI back to the model as part of the page.
 */
export const createCoAgentOverlay = (
	options: CoAgentOverlayOptions = {},
): (() => void) => {
	const showCursor = options.cursor ?? true;
	const showStatus = options.status ?? true;

	const existing = document.getElementById(CO_AGENT_CONTAINER_ID);
	if (existing) return () => existing.remove();

	const host = document.createElement("div");
	host.id = CO_AGENT_CONTAINER_ID;
	host.setAttribute("aria-hidden", "true");
	host.style.cssText =
		"position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
	const root = host.attachShadow({ mode: "open" });

	const style = document.createElement("style");
	style.textContent = `
:host { all: initial; }
.cursor {
  position: fixed; top: 0; left: 0; width: 22px; height: 22px;
  transform: translate3d(-100px,-100px,0); opacity: 0;
  transition: transform 420ms cubic-bezier(.22,.61,.36,1), opacity 180ms ease;
  will-change: transform, opacity;
}
.cursor svg { display:block; filter: drop-shadow(0 2px 4px rgba(0,0,0,.35)); }
.label {
  position: fixed; top: 0; left: 0; max-width: 260px;
  transform: translate3d(-100px,-100px,0); opacity: 0;
  transition: transform 520ms cubic-bezier(.22,.61,.36,1), opacity 180ms ease;
  padding: 5px 9px; border-radius: 8px;
  background: #10b981; color: #fff;
  font: 500 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 4px 12px rgba(0,0,0,.25);
}
.dock {
  position: fixed; right: 18px; bottom: 18px; max-width: 320px;
  display: flex; align-items: center; gap: 8px;
  padding: 9px 13px; border-radius: 999px;
  background: rgba(17,17,19,.94); color: #f4f4f5;
  font: 500 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.32);
  opacity: 0; transform: translateY(8px);
  transition: opacity 200ms ease, transform 200ms ease;
}
.dock.is-visible { opacity: 1; transform: translateY(0); }
.dot {
  width: 7px; height: 7px; border-radius: 50%; background: #10b981;
  flex: 0 0 auto; animation: pulse 1.4s ease-in-out infinite;
}
.text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) {
  .cursor, .label, .dock { transition: none; }
  .dot { animation: none; }
}`;
	root.appendChild(style);

	const cursor = document.createElement("div");
	cursor.className = "cursor";
	cursor.innerHTML =
		'<svg viewBox="0 0 20 20" width="22" height="22" xmlns="http://www.w3.org/2000/svg">' +
		'<path d="M3 2l13 6.5-5.6 1.6L8.2 16z" fill="#10b981" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/>' +
		"</svg>";

	const label = document.createElement("div");
	label.className = "label";

	const dock = document.createElement("div");
	dock.className = "dock";
	const dot = document.createElement("span");
	dot.className = "dot";
	const text = document.createElement("span");
	text.className = "text";
	dock.append(dot, text);

	if (showCursor) root.append(cursor, label);
	if (showStatus) root.appendChild(dock);
	document.body.appendChild(host);

	let cursorTimer: ReturnType<typeof setTimeout> | null = null;
	let statusTimer: ReturnType<typeof setTimeout> | null = null;

	const hideCursor = () => {
		cursor.style.opacity = "0";
		label.style.opacity = "0";
	};

	const place = (x: number, y: number, message?: string) => {
		cursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
		cursor.style.opacity = "1";
		if (message) {
			label.textContent = message;
			// Below-right of the pointer, nudged back inside the viewport.
			const left = Math.min(x + 26, window.innerWidth - 270);
			const top = Math.min(y + 20, window.innerHeight - 40);
			label.style.transform = `translate3d(${Math.round(Math.max(8, left))}px, ${Math.round(Math.max(8, top))}px, 0)`;
			label.style.opacity = "1";
		} else {
			label.style.opacity = "0";
		}
		if (cursorTimer) clearTimeout(cursorTimer);
		cursorTimer = setTimeout(hideCursor, CURSOR_IDLE_MS);
	};

	const resolvePoint = (
		detail: CursorDetail,
	): { x: number; y: number } | null => {
		if (detail.selector) {
			const matches = document.querySelectorAll(detail.selector);
			const element = matches.item(detail.index ?? 0);
			if (element instanceof HTMLElement) {
				if (detail.scrollIntoView !== false) {
					// Guarded: this runs inside pages we do not control, where the
					// method can be missing or overridden, and a throw here would
					// take the whole cursor listener down with it.
					try {
						element.scrollIntoView?.({
							behavior: detail.mode === "jumpTo" ? "auto" : "smooth",
							block: "center",
							inline: "nearest",
						});
					} catch {
						// Scrolling is a nicety; pointing at the element is not.
					}
				}
				const box = element.getBoundingClientRect();
				// Small controls get pointed at in the middle; large regions near
				// their top-left, where reading starts.
				const small = box.width <= 220 && box.height <= 72;
				return small
					? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
					: { x: box.left + box.width * 0.18, y: box.top + box.height * 0.22 };
			}
			return null;
		}
		if (detail.point) return { x: detail.point.x, y: detail.point.y };
		if (detail.rect) {
			return {
				x: detail.rect.x + detail.rect.width / 2,
				y: detail.rect.y + detail.rect.height / 2,
			};
		}
		return null;
	};

	const onCursor = (event: Event) => {
		const detail = (event as CustomEvent<CursorDetail>).detail ?? {};
		if (detail.hide) {
			hideCursor();
			return;
		}
		// A bad selector from the model is a normal occurrence, and
		// querySelectorAll throws on one.
		let point: { x: number; y: number } | null = null;
		try {
			point = resolvePoint(detail);
		} catch {
			return;
		}
		if (!point) return;
		// The smooth scroll above moves the target, so settle before placing.
		const settle = detail.mode === "jumpTo" ? 0 : 180;
		const resolved = point;
		window.setTimeout(() => {
			let again = resolved;
			try {
				again = resolvePoint({ ...detail, scrollIntoView: false }) ?? resolved;
			} catch {
				// Keep the position from before the scroll.
			}
			place(again.x, again.y, detail.message);
		}, settle);
	};

	const onStatus = (event: Event) => {
		const message = (event as CustomEvent<{ message?: string }>).detail
			?.message;
		if (!message) return;
		text.textContent = message;
		dock.classList.add("is-visible");
		if (statusTimer) clearTimeout(statusTimer);
		statusTimer = setTimeout(
			() => dock.classList.remove("is-visible"),
			STATUS_IDLE_MS,
		);
	};

	if (showCursor) window.addEventListener(AGENT_CURSOR_EVENT, onCursor);
	if (showStatus) window.addEventListener(CO_AGENT_STATUS_EVENT, onStatus);

	return () => {
		if (cursorTimer) clearTimeout(cursorTimer);
		if (statusTimer) clearTimeout(statusTimer);
		window.removeEventListener(AGENT_CURSOR_EVENT, onCursor);
		window.removeEventListener(CO_AGENT_STATUS_EVENT, onStatus);
		host.remove();
	};
};

export const destroyCoAgentOverlay = (): void => {
	document.getElementById(CO_AGENT_CONTAINER_ID)?.remove();
};
