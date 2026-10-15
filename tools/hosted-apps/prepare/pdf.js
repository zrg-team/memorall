/**
 * PDF has no AI of its own. Memorall's assistant works on the open file with
 * the app's commands, in a panel beside the app; this puts its button in the
 * app's rail of panels, where the user looks for one, and keeps the button
 * showing whether the panel is open.
 */
import { createElement, Sparkles } from "lucide";
import { iconButton } from "../lib/ui.js";
import { notifyHost, onHostEvent } from "./puter-host.js";

export async function prepare(init) {
	if (!init) return;
	const button = iconButton(
		"AI assistant",
		createElement(Sparkles, {
			width: 18,
			height: 18,
			"stroke-width": 1.7,
			"aria-hidden": "true",
			focusable: "false",
		}),
		() => notifyHost("assistant"),
		{ "aria-pressed": "false", "data-memorall-assistant": "" },
	);
	onHostEvent("assistant", (open) => button.setAttribute("aria-pressed", String(!!open)));
	// The rail is drawn by the app after this runs: its panel tabs first, the
	// panel toggle last; the assistant goes between them.
	const place = () => {
		const rail = document.querySelector(".right-rail");
		if (!rail) return false;
		if (!button.isConnected) rail.insertBefore(button, rail.lastElementChild);
		return true;
	};
	if (place()) return;
	const watch = new MutationObserver(() => {
		if (place()) watch.disconnect();
	});
	watch.observe(document.documentElement, { childList: true, subtree: true });
}
