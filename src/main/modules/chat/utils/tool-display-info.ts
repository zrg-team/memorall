/**
 * Static display info for tools in the Agent Settings UI.
 * Avoids instantiating tools (which require bound services) just for descriptions.
 */
export const TOOL_DISPLAY_INFO: Record<
	string,
	{ name?: string; description: string; descriptionKey?: string }
> = {
	current_time: {
		name: "Current Time",
		description: "Get the current date and time",
		descriptionKey: "agentSettings.toolDescriptions.current_time",
	},
	load_skill: {
		name: "Load Skill",
		description: "Load a skill by name for specialized instructions",
		descriptionKey: "agentSettings.toolDescriptions.load_skill",
	},
	js_execute: {
		name: "JavaScript Execute",
		description: "Execute JavaScript code in a sandboxed environment",
		descriptionKey: "agentSettings.toolDescriptions.js_execute",
	},
	calculator: {
		name: "Calculator",
		description: "Perform basic mathematical calculations",
		descriptionKey: "agentSettings.toolDescriptions.calculator",
	},
	knowledge_graph: {
		name: "Semantic Memory Search",
		description: "Query semantic memory for relationships and entities",
		descriptionKey: "agentSettings.toolDescriptions.knowledge_graph",
	},
	knowledge_graph_write: {
		name: "Semantic Memory Write",
		description: "Write nodes and facts to semantic memory",
		descriptionKey: "agentSettings.toolDescriptions.knowledge_graph_write",
	},
	structmem_knowledge_retrieval: {
		name: "StructMem Retrieval",
		description:
			"Retrieve StructMem event and synthesis memories for grounded context",
		descriptionKey:
			"agentSettings.toolDescriptions.structmem_knowledge_retrieval",
	},
	doc_read: {
		name: "Read Document",
		description: "Read document files from the file system",
		descriptionKey: "agentSettings.toolDescriptions.doc_read",
	},
	doc_write: {
		name: "Write Document",
		description: "Write content to document files",
		descriptionKey: "agentSettings.toolDescriptions.doc_write",
	},
	doc_edit: {
		name: "Edit Document",
		description: "Edit existing document files",
		descriptionKey: "agentSettings.toolDescriptions.doc_edit",
	},
	doc_search: {
		name: "Search Documents",
		description: "Search through documents for content",
		descriptionKey: "agentSettings.toolDescriptions.doc_search",
	},
	doc_move: {
		name: "Move Document",
		description: "Move or rename document files",
		descriptionKey: "agentSettings.toolDescriptions.doc_move",
	},
	doc_remove: {
		name: "Remove Document",
		description: "Remove document files from the file system",
		descriptionKey: "agentSettings.toolDescriptions.doc_remove",
	},
	send_message_to_agent: {
		name: "Message Child Agent",
		description: "Send a focused message to a selected child agent",
		descriptionKey: "agentSettings.toolDescriptions.send_message_to_agent",
	},
	memory_remember: {
		name: "Remember Memory",
		description: "Save a durable fact, preference, or project context item",
		descriptionKey: "agentSettings.toolDescriptions.memory_remember",
	},
	memory_retrieve: {
		name: "Retrieve Memory",
		description: "Search active memories in the selected topic graph",
		descriptionKey: "agentSettings.toolDescriptions.memory_retrieve",
	},
	memory_update: {
		name: "Update Memory",
		description: "Replace an existing memory while preserving history",
		descriptionKey: "agentSettings.toolDescriptions.memory_update",
	},
	memory_remove: {
		name: "Remove Memory",
		description: "Mark a memory inactive without deleting history",
		descriptionKey: "agentSettings.toolDescriptions.memory_remove",
	},
	memory_explain_source: {
		name: "Explain Memory Source",
		description: "Explain where a saved memory came from",
		descriptionKey: "agentSettings.toolDescriptions.memory_explain_source",
	},
};
