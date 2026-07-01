import { logInfo, logError } from "@/utils/logger";
import type { Language } from "@/constants/language";
import { MENU_IDS } from "./ids";

export { MENU_IDS };

// ── Translations ──────────────────────────────────────────────────────────────

type MenuTexts = {
	savePage: string;
	convertToKnowledge: string;
	recall: string;
	coAgent: string;
	smartSelector: string;
	openPlatform: string;
	openDocuments: string;
};

const TEXTS: Record<Language, MenuTexts> = {
	en: {
		savePage: "💾 Save page",
		convertToKnowledge: "✨ Convert to knowledge",
		recall: "💬 Ask about this page",
		coAgent: "🤖 Co-agent",
		smartSelector: "🎯 Smart Selector",
		openPlatform: "🚀 Open platform",
		openDocuments: "📄 Open documents",
	},
	vn: {
		savePage: "💾 Lưu trang",
		convertToKnowledge: "✨ Chuyển thành kiến thức",
		recall: "💬 Hỏi về trang này",
		coAgent: "🤖 Co-agent",
		smartSelector: "🎯 Chọn thông minh",
		openPlatform: "🚀 Mở nền tảng",
		openDocuments: "📄 Mở tài liệu",
	},
};

// ── Create / Update ───────────────────────────────────────────────────────────

function getMenuDefinitions(
	language: Language,
): chrome.contextMenus.CreateProperties[] {
	const t = TEXTS[language];

	return [
		{
			id: MENU_IDS.SAVE_PAGE,
			title: t.savePage,
			contexts: ["page", "selection"],
		},
		{
			id: MENU_IDS.CONVERT_TO_KNOWLEDGE,
			title: t.convertToKnowledge,
			contexts: ["selection"],
		},
		{ id: MENU_IDS.SAVE_DIVIDER, type: "separator" },
		{
			id: MENU_IDS.RECALL,
			title: t.recall,
			contexts: ["page", "selection"],
		},
		{
			id: MENU_IDS.CO_AGENT,
			title: t.coAgent,
			contexts: ["page", "selection"],
		},
		{
			id: MENU_IDS.SMART_SELECTOR,
			title: t.smartSelector,
			contexts: ["page", "selection"],
		},
		{
			id: MENU_IDS.RECALL_DIVIDER,
			type: "separator",
		},
		{
			id: MENU_IDS.ACTIVITY_DIVIDER,
			type: "separator",
		},
		{
			id: MENU_IDS.OPEN_PLATFORM,
			title: t.openPlatform,
			contexts: ["page", "link"],
		},
		{
			id: MENU_IDS.OPEN_DOCUMENTS,
			title: t.openDocuments,
			contexts: ["page"],
		},
	];
}

function getLastErrorMessage(): string | undefined {
	return chrome.runtime.lastError?.message;
}

function removeAllContextMenus(): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.contextMenus.removeAll(() => {
			const error = getLastErrorMessage();
			if (error) {
				reject(new Error(error));
				return;
			}

			resolve();
		});
	});
}

function createContextMenu(
	properties: chrome.contextMenus.CreateProperties,
): Promise<void> {
	return new Promise((resolve, reject) => {
		chrome.contextMenus.create(properties, () => {
			const error = getLastErrorMessage();
			if (error) {
				reject(new Error(error));
				return;
			}

			resolve();
		});
	});
}

export async function createContextMenus(language: Language): Promise<void> {
	await removeAllContextMenus();

	for (const definition of getMenuDefinitions(language)) {
		await createContextMenu(definition);
	}

	logInfo(`✅ Context menus registered for ${language}`);
}

export async function updateContextMenuText(language: Language): Promise<void> {
	try {
		const t = TEXTS[language];

		await chrome.contextMenus.update(MENU_IDS.SAVE_PAGE, { title: t.savePage });
		await chrome.contextMenus.update(MENU_IDS.CONVERT_TO_KNOWLEDGE, {
			title: t.convertToKnowledge,
		});
		await chrome.contextMenus.update(MENU_IDS.RECALL, { title: t.recall });
		await chrome.contextMenus.update(MENU_IDS.CO_AGENT, { title: t.coAgent });
		await chrome.contextMenus.update(MENU_IDS.SMART_SELECTOR, {
			title: t.smartSelector,
		});
		await chrome.contextMenus.update(MENU_IDS.OPEN_PLATFORM, {
			title: t.openPlatform,
		});
		await chrome.contextMenus.update(MENU_IDS.OPEN_DOCUMENTS, {
			title: t.openDocuments,
		});

		logInfo(`✅ Context menu text updated to ${language}`);
	} catch (error) {
		logError("❌ Failed to update context menu text:", error);
		try {
			await createContextMenus(language);
		} catch (rebuildError) {
			logError("❌ Failed to rebuild context menus:", rebuildError);
		}
	}
}
