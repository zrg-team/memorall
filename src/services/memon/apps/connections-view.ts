import {
	englishKitText,
	type MemonKitApp,
	type MemonViewNode,
} from "../app-kit/types";

/** Tools listed for an expanded connection. */
const TOOLS_SHOWN = 40;

/**
 * Connections: the user's connected apps and which ones this agent may use.
 * Adding, signing in or unlocking happens on the Connections page.
 */
export const connectionsApp: MemonKitApp = {
	refPrefix: "c",

	view(snapshot, t = englishKitText) {
		const { connections } = snapshot;
		const granted = connections.items.filter((item) => item.granted).length;
		const nodes: MemonViewNode[] = [
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "heading",
						text: t(
							"connections.summary",
							"{{agent}} · {{granted}} of {{total}} granted",
							{
								agent:
									connections.agentName ?? t("kit.thisAgent", "This agent"),
								granted,
								total: connections.items.length,
							},
						),
					},
					{
						type: "button",
						id: "refresh",
						label: t("kit.refresh", "Refresh"),
						icon: "refresh",
					},
					{
						type: "button",
						id: "page",
						label: t("connections.page", "Manage"),
						icon: "open",
						userOnly: true,
					},
				],
			},
		];
		if (!connections.unlocked) {
			nodes.push({
				type: "text",
				text: t(
					"connections.locked",
					"The passkey is locked, so saved credentials cannot be used until the user unlocks them.",
				),
				tone: "warning",
			});
		}
		if (connections.error) {
			nodes.push({ type: "text", text: connections.error, tone: "error" });
		}
		if (connections.loading) {
			nodes.push({
				type: "text",
				text: t("kit.loading", "(loading…)"),
				tone: "muted",
			});
		}
		if (!connections.items.length && !connections.loading) {
			nodes.push({
				type: "text",
				text: t(
					"connections.empty",
					"No connections yet; the user adds them on the Connections page.",
				),
				tone: "muted",
			});
		}
		connections.items.forEach((item, index) => {
			const open = connections.selected === item.key;
			const children: MemonViewNode[] = [
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "toggle",
							id: `grant:${item.key}`,
							label: t("connections.use", "Use in this agent"),
							checked: item.granted,
							disabled: connections.agentId
								? undefined
								: t("kit.noAgent", "the computer has no agent"),
						},
						{
							type: "button",
							id: `tools:${item.key}`,
							label: open
								? t("connections.hideTools", "Hide tools")
								: t("connections.showTools", "Show tools"),
						},
					],
				},
			];
			if (open) {
				children.push({
					type: "button",
					id: `rediscover:${item.connectionId}`,
					label: t("connections.rediscover", "Ask it for its tools again"),
					icon: "refresh",
				});
				if (item.error) {
					children.push({ type: "text", text: item.error, tone: "error" });
				}
				if (!item.tools.length) {
					children.push({
						type: "text",
						text: t("connections.noTools", "No tools known yet."),
						tone: "muted",
					});
				}
				for (const tool of item.tools.slice(0, TOOLS_SHOWN)) {
					const flags = [
						tool.readOnly ? t("connections.readOnly", "read-only") : null,
						tool.destructive
							? t("connections.destructive", "destructive")
							: null,
					].filter((flag): flag is string => Boolean(flag));
					children.push({
						type: "item",
						id: `tool:${item.key}:${tool.name}`,
						title: tool.name,
						detail: tool.description.replace(/\s+/g, " ").slice(0, 160),
						badges: flags.length ? flags : undefined,
					});
				}
				if (item.tools.length > TOOLS_SHOWN) {
					children.push({
						type: "text",
						text: t("connections.moreTools", "… {{count}} more tools", {
							count: item.tools.length - TOOLS_SHOWN,
						}),
						tone: "muted",
					});
				}
			}
			nodes.push({
				type: "item",
				id: `connection:${item.key}`,
				title: `${index + 1}. ${item.label}`,
				detail: [
					item.kind === "composio"
						? t("connections.via", "via {{name}}", {
								name: item.connectionName,
							})
						: null,
					t(`connections.status.${item.status}`, item.status),
					item.tools.length
						? t("connections.tools", "{{count}} tools", {
								count: item.tools.length,
							})
						: null,
				]
					.filter(Boolean)
					.join(" · "),
				badges: item.granted
					? [t("connections.granted", "granted")]
					: undefined,
				tone: item.status === "connected" ? undefined : "muted",
				children,
			});
		});
		return nodes;
	},

	async act(machine, id, value) {
		const separator = id.indexOf(":");
		const action = separator < 0 ? id : id.slice(0, separator);
		const target = separator < 0 ? "" : id.slice(separator + 1);
		const label = () =>
			machine.snapshot().connections.items.find((item) => item.key === target)
				?.label ?? "the connection";
		switch (action) {
			case "refresh":
				await machine.refreshConnections();
				return "refreshed Connections";
			case "grant": {
				const granted = Boolean(value);
				const name = label();
				await machine.setConnectionGranted(target, granted);
				return `${granted ? "granted" : "revoked"} ${name}; it applies from the next message`;
			}
			case "tools": {
				const open = machine.snapshot().connections.selected === target;
				machine.selectConnection(open ? null : target);
				return `${open ? "hid" : "showed"} the tools of ${label()}`;
			}
			case "rediscover":
				await machine.rediscoverConnection(target);
				return "asked the connection for its tools again";
			default:
				throw new Error(`Connections has no control ${id}.`);
		}
	},
};
