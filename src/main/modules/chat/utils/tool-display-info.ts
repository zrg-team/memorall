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
	memon_screen: {
		name: "Read Screen",
		description: "Read the MemonOS Bot computer screen",
		descriptionKey: "agentSettings.toolDescriptions.memon_screen",
	},
	memon_open: {
		name: "Open on Computer",
		description: "Open an app, page or file on the MemonOS Bot computer",
		descriptionKey: "agentSettings.toolDescriptions.memon_open",
	},
	memon_act: {
		name: "Use Computer",
		description: "Click, type, scroll or save on the MemonOS Bot computer",
		descriptionKey: "agentSettings.toolDescriptions.memon_act",
	},
	memon_run: {
		name: "Run Command",
		description: "Run a shell command in the MemonOS Bot terminal",
		descriptionKey: "agentSettings.toolDescriptions.memon_run",
	},
	memon_window: {
		name: "Arrange Windows",
		description: "Focus, minimize, maximize or close a MemonOS Bot window",
		descriptionKey: "agentSettings.toolDescriptions.memon_window",
	},
	memon_visualize: {
		name: "Visualize",
		description:
			"Show a visual written in OpenUI in the MemonOS Bot Visualize app and save it",
		descriptionKey: "agentSettings.toolDescriptions.memon_visualize",
	},
	memon_tasks: {
		name: "Update Tasks",
		description:
			"Plan and track tasks in the MemonOS Bot Tasks app, kept across chats",
		descriptionKey: "agentSettings.toolDescriptions.memon_tasks",
	},
	memon_schedule: {
		name: "Manage Schedules",
		description:
			"View and manage the agent's scheduled prompts in the MemonOS Bot Scheduler",
		descriptionKey: "agentSettings.toolDescriptions.memon_schedule",
	},
	memon_memory: {
		name: "Update Memory",
		description: "Remember things between chats in Memory.md and keep Bot.md",
		descriptionKey: "agentSettings.toolDescriptions.memon_memory",
	},
	memon_studio: {
		name: "Use Studio",
		description:
			"Run the user's studios on the computer: decisions, speech, transcripts, images, image and text tools, audio",
		descriptionKey: "agentSettings.toolDescriptions.memon_studio",
	},
	memon_skills: {
		name: "Manage Skills",
		description: "View and manage the skills this agent uses",
		descriptionKey: "agentSettings.toolDescriptions.memon_skills",
	},
	memon_connections: {
		name: "Manage Connections",
		description:
			"View the user's connected apps and which ones this agent uses",
		descriptionKey: "agentSettings.toolDescriptions.memon_connections",
	},
	memon_code: {
		name: "Use pi code",
		description:
			"Hand coding work to pi code, the coding agent on the computer, after the user confirms",
		descriptionKey: "agentSettings.toolDescriptions.memon_code",
	},
};
