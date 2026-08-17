/**
 * Provider-level scoping for agents.
 *
 * An agent is granted *providers*, not credentials. A Composio account is one
 * credential holding many apps, and giving an agent "Composio" would hand it
 * Gmail, Calendar, GitHub and anything authorized later. So the unit an agent
 * selects is one row per app — `{ connectionId, appId }` — and a non-Composio
 * connection is simply the single provider it is.
 *
 * The selection shape on disk is unchanged (`AgentConnectionSelection`); this
 * module is the one place that knows how to flatten it into rows, toggle a row,
 * and label it, so the picker, the agent form and the wizard cannot drift.
 */

import type { AgentConnectionSelection, McpConnection } from "./types";

export interface ProviderOption {
	/** Stable identity for a row: `connectionId` or `connectionId::appId`. */
	key: string;
	connectionId: string;
	connectionName: string;
	connectionKind: McpConnection["kind"];
	/** Composio toolkit slug. Absent for a whole-connection provider. */
	appId?: string;
	/** What the user reads: "Gmail", or the server's name. */
	label: string;
	/** Brand mark for the row, when the provider is an app that has one. */
	logo?: string;
}

export const providerKey = (connectionId: string, appId?: string): string =>
	appId ? `${connectionId}::${appId}` : connectionId;

/**
 * Every provider the user could grant, flattened across connections.
 *
 * A Composio connection with no authorized apps contributes nothing — there is
 * genuinely nothing to grant until an app is connected.
 */
export const listProviderOptions = (
	connections: McpConnection[],
): ProviderOption[] =>
	connections.flatMap((connection): ProviderOption[] => {
		if (connection.kind === "composio") {
			return (connection.apps ?? [])
				.filter((app) => app.status !== "expired")
				.map((app) => ({
					key: providerKey(connection.id, app.id),
					connectionId: connection.id,
					connectionName: connection.name,
					connectionKind: connection.kind,
					appId: app.id,
					label: app.name || app.id,
					logo: app.logo,
				}));
		}
		return [
			{
				key: providerKey(connection.id),
				connectionId: connection.id,
				connectionName: connection.name,
				connectionKind: connection.kind,
				label: connection.name,
			},
		];
	});

export const isProviderSelected = (
	selections: AgentConnectionSelection[],
	option: ProviderOption,
): boolean => {
	const entry = selections.find(
		(candidate) => candidate.connectionId === option.connectionId,
	);
	if (!entry) return false;
	if (!option.appId) return true;
	// An entry with no appIds grants nothing for Composio — see resolve.ts.
	return Boolean(entry.appIds?.includes(option.appId));
};

/**
 * Turn one provider on or off.
 *
 * Removing the last app of a Composio connection drops the whole entry, so a
 * connection is never persisted in the "attached but grants nothing" state.
 */
export const toggleProvider = (
	selections: AgentConnectionSelection[],
	option: ProviderOption,
): AgentConnectionSelection[] => {
	const entry = selections.find(
		(candidate) => candidate.connectionId === option.connectionId,
	);

	if (!option.appId) {
		return entry
			? selections.filter(
					(candidate) => candidate.connectionId !== option.connectionId,
				)
			: [...selections, { connectionId: option.connectionId }];
	}

	const current = entry?.appIds ?? [];
	const nextApps = current.includes(option.appId)
		? current.filter((id) => id !== option.appId)
		: [...current, option.appId];

	if (nextApps.length === 0) {
		return selections.filter(
			(candidate) => candidate.connectionId !== option.connectionId,
		);
	}

	return entry
		? selections.map((candidate) =>
				candidate.connectionId === option.connectionId
					? { ...candidate, appIds: nextApps }
					: candidate,
			)
		: [...selections, { connectionId: option.connectionId, appIds: nextApps }];
};

/**
 * The providers a selection currently grants, in the order the user sees them.
 * Used for the agent form's chip row so it reads "GitHub", not "Composio".
 */
export const selectedProviders = (
	selections: AgentConnectionSelection[],
	connections: McpConnection[],
): ProviderOption[] =>
	listProviderOptions(connections).filter((option) =>
		isProviderSelected(selections, option),
	);

/**
 * Drop anything the registry no longer offers — an app the user disconnected,
 * or a deleted connection. Keeps a stale grant from outliving its provider.
 */
export const pruneSelections = (
	selections: AgentConnectionSelection[],
	connections: McpConnection[],
): AgentConnectionSelection[] => {
	const byId = new Map(connections.map((entry) => [entry.id, entry]));
	return selections
		.map((selection) => {
			const connection = byId.get(selection.connectionId);
			if (!connection) return null;
			if (connection.kind !== "composio") return selection;
			const available = new Set((connection.apps ?? []).map((app) => app.id));
			const appIds = (selection.appIds ?? []).filter((id) => available.has(id));
			return appIds.length > 0 ? { ...selection, appIds } : null;
		})
		.filter((entry): entry is AgentConnectionSelection => Boolean(entry));
};
