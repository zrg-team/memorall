const STORAGE_KEY = "memorall:web-browser-tab-groups:v1";

let groupIds: Record<string, number> | null = null;
let queue: Promise<void> = Promise.resolve();

/** Group only tabs opened by the agent, without changing the selected tab. */
export const groupAgentTab = (tab: {
	id?: number;
	windowId?: number;
}): Promise<void> => {
	const { id: tabId, windowId } = tab;
	if (
		typeof tabId !== "number" ||
		typeof windowId !== "number" ||
		!chrome.tabs.group ||
		!chrome.tabGroups?.get ||
		!chrome.tabGroups?.update
	) {
		return Promise.resolve();
	}

	// Parallel opens must join the same group, including after a worker restart.
	queue = queue
		.then(async () => {
			const storage = chrome.storage?.session;
			if (!groupIds) {
				const stored = (await storage?.get(STORAGE_KEY))?.[STORAGE_KEY];
				groupIds = {};
				if (stored && typeof stored === "object") {
					for (const [key, value] of Object.entries(stored)) {
						if (typeof value === "number") groupIds[key] = value;
					}
				}
			}
			const rememberedId = groupIds[String(windowId)];
			const group =
				typeof rememberedId === "number"
					? await chrome.tabGroups.get(rememberedId).catch(() => null)
					: null;
			if (group?.windowId === windowId) {
				await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
				return;
			}

			const groupId = await chrome.tabs.group({
				tabIds: tabId,
				createProperties: { windowId },
			});
			await chrome.tabGroups.update(groupId, {
				title: "Memorall",
				color: "blue",
			});
			groupIds[String(windowId)] = groupId;
			await storage?.set({ [STORAGE_KEY]: groupIds });
		})
		.catch(() => {
			// Grouping is cosmetic; a browser without support can still use the page.
		});
	return queue;
};
