/**
 * i18n Configuration
 * Initializes i18next with language detection and resources
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Import translation files
import enCommon from "./locales/en/common.json";
import enAgents from "./locales/en/agents.json";
import enChat from "./locales/en/chat.json";
import enDocuments from "./locales/en/files.json";
import enKnowledge from "./locales/en/knowledge.json";
import enLLM from "./locales/en/llm.json";
import enDatabase from "./locales/en/database.json";
import enEmbedding from "./locales/en/embedding.json";
import enLogs from "./locales/en/logs.json";
import enDebug from "./locales/en/debug.json";
import enTopics from "./locales/en/topics.json";
import enActivity from "./locales/en/activity.json";
import enAuth from "./locales/en/auth.json";
import enCopilot from "./locales/en/copilot.json";
import enConnections from "./locales/en/connections.json";
import enSkills from "./locales/en/skills.json";

import vnCommon from "./locales/vn/common.json";
import vnAgents from "./locales/vn/agents.json";
import vnChat from "./locales/vn/chat.json";
import vnDocuments from "./locales/vn/files.json";
import vnKnowledge from "./locales/vn/knowledge.json";
import vnLLM from "./locales/vn/llm.json";
import vnDatabase from "./locales/vn/database.json";
import vnEmbedding from "./locales/vn/embedding.json";
import vnLogs from "./locales/vn/logs.json";
import vnDebug from "./locales/vn/debug.json";
import vnTopics from "./locales/vn/topics.json";
import vnActivity from "./locales/vn/activity.json";
import vnAuth from "./locales/vn/auth.json";
import vnCopilot from "./locales/vn/copilot.json";
import vnConnections from "./locales/vn/connections.json";
import vnSkills from "./locales/vn/skills.json";

// Translation resources
const resources = {
	en: {
		common: enCommon,
		agents: enAgents,
		chat: enChat,
		documents: enDocuments,
		knowledge: enKnowledge,
		llm: enLLM,
		database: enDatabase,
		embedding: enEmbedding,
		logs: enLogs,
		debug: enDebug,
		topics: enTopics,
		activity: enActivity,
		auth: enAuth,
		copilot: enCopilot,
		connections: enConnections,
		skills: enSkills,
	},
	vn: {
		common: vnCommon,
		agents: vnAgents,
		chat: vnChat,
		documents: vnDocuments,
		knowledge: vnKnowledge,
		llm: vnLLM,
		database: vnDatabase,
		embedding: vnEmbedding,
		logs: vnLogs,
		debug: vnDebug,
		topics: vnTopics,
		activity: vnActivity,
		auth: vnAuth,
		copilot: vnCopilot,
		connections: vnConnections,
		skills: vnSkills,
	},
} as const;

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources,
		defaultNS: "common",
		fallbackLng: "en",
		supportedLngs: ["en", "vn"],
		interpolation: {
			escapeValue: false, // React already escapes
		},
		detection: {
			order: ["localStorage", "navigator"],
			caches: ["localStorage"],
			lookupLocalStorage: "i18nextLng",
		},
	});

export default i18n;
