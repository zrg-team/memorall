import {
	englishKitText,
	type MemonKitApp,
	type MemonViewNode,
} from "../app-kit/types";

const EDITING = "skills:editing";
const FILTER = "skills:filter";
const field = (name: string) => `skills:${name}`;
/** Library entries shown at once, besides the agent's own skills. */
const SHOWN = 25;

/**
 * Skills: the skill library and the skills this agent uses, the same ones
 * the agent settings page shows. A switch saves the agent straight away.
 */
export const skillsApp: MemonKitApp = {
	refPrefix: "k",

	view(snapshot, t = englishKitText) {
		const { skills, drafts } = snapshot;
		const editing = drafts[EDITING] as string | undefined;
		const noAgent = skills.agentId
			? undefined
			: t("kit.noAgent", "the computer has no agent");
		const nodes: MemonViewNode[] = [];
		if (skills.error)
			nodes.push({ type: "text", text: skills.error, tone: "error" });

		if (editing) {
			const isNew = editing === "new";
			nodes.push(
				{
					type: "heading",
					text: isNew
						? t("skills.newTitle", "New skill")
						: t("skills.editTitle", "Edit {{name}}", { name: editing }),
				},
				...(isNew
					? [
							{
								type: "input" as const,
								id: "name",
								label: t("skills.name", "Name (lowercase, hyphens)"),
								value: String(drafts[field("name")] ?? ""),
								placeholder: "research-writer",
								mono: true,
							},
						]
					: []),
				{
					type: "input",
					id: "description",
					label: t("skills.description", "When to use it"),
					value: String(drafts[field("description")] ?? ""),
					lines: 2,
				},
				{
					type: "input",
					id: "body",
					label: t("skills.body", "Instructions (Markdown)"),
					value: String(drafts[field("body")] ?? ""),
					lines: 10,
					mono: true,
				},
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "button",
							id: "save",
							label: t("kit.save", "Save"),
							variant: "primary",
							icon: "save",
							disabled:
								!String(drafts[field("body")] ?? "").trim() ||
								(isNew && !String(drafts[field("name")] ?? "").trim())
									? t("skills.needFields", "fill in the name and instructions")
									: undefined,
						},
						{
							type: "button",
							id: "cancel",
							label: t("kit.cancel", "Cancel"),
							variant: "ghost",
						},
					],
				},
			);
			return nodes;
		}

		if (skills.open) {
			const open = skills.open;
			const inUse = skills.items.find(
				(item) => item.name === open.name,
			)?.enabled;
			nodes.push(
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "button",
							id: "back",
							label: t("skills.back", "All skills"),
							icon: "back",
						},
						{ type: "heading", text: open.name },
					],
				},
				{
					type: "text",
					text: t("skills.about", "{{kind}} · when to use: {{description}}", {
						kind: open.readOnly
							? t("skills.builtIn", "built in")
							: t("skills.custom", "custom"),
						description: open.description,
					}),
					tone: "muted",
				},
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "toggle",
							id: `use:${open.name}`,
							label: t("skills.useInAgent", "Use in this agent"),
							checked: Boolean(inUse),
							disabled: noAgent,
						},
						...(open.readOnly
							? []
							: [
									{
										type: "button" as const,
										id: `edit:${open.name}`,
										label: t("kit.edit", "Edit"),
										icon: "edit",
									},
									{
										type: "button" as const,
										id: `delete:${open.name}`,
										label: t("kit.delete", "Delete"),
										variant: "danger" as const,
										icon: "delete",
									},
								]),
					],
				},
				{ type: "markdown", text: open.body },
			);
			return nodes;
		}

		const filter = String(drafts[FILTER] ?? "")
			.trim()
			.toLowerCase();
		const inUse = skills.items.filter((item) => item.enabled);
		const matching = skills.items.filter(
			(item) =>
				!item.enabled &&
				(!filter ||
					item.name.includes(filter) ||
					item.description.toLowerCase().includes(filter)),
		);
		nodes.push(
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "heading",
						text: t(
							"skills.summary",
							"{{agent}} · {{inUse}} of {{total}} in use",
							{
								agent: skills.agentName ?? t("kit.thisAgent", "This agent"),
								inUse: inUse.length,
								total: skills.items.length,
							},
						),
					},
					{
						type: "button",
						id: "new",
						label: t("kit.new", "New"),
						icon: "add",
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
						label: t("skills.page", "Skills page"),
						icon: "open",
						userOnly: true,
					},
				],
			},
			{
				type: "input",
				id: "filter",
				label: t("skills.find", "Find"),
				value: String(drafts[FILTER] ?? ""),
				placeholder: t("skills.findPlaceholder", "Search skills"),
			},
		);
		if (skills.loading) {
			nodes.push({
				type: "text",
				text: t("kit.loading", "(loading…)"),
				tone: "muted",
			});
		}
		const row = (item: (typeof skills.items)[number]): MemonViewNode => ({
			type: "item",
			id: `skill:${item.name}`,
			title: item.name,
			detail: item.description.replace(/\s+/g, " ").slice(0, 140),
			badges: item.readOnly ? [t("skills.builtIn", "built in")] : undefined,
			children: [
				{
					type: "group",
					layout: "row",
					children: [
						{
							type: "toggle",
							id: `use:${item.name}`,
							label: t("skills.use", "Use"),
							checked: item.enabled,
							disabled: noAgent,
						},
						{
							type: "button",
							id: `open:${item.name}`,
							label: t("kit.open", "Open"),
							icon: "open",
						},
					],
				},
			],
		});
		if (inUse.length) {
			nodes.push(
				{ type: "heading", text: t("skills.inUse", "In use") },
				...inUse.map(row),
			);
		}
		nodes.push(
			{
				type: "heading",
				text: filter
					? t("skills.matching", 'Matching "{{filter}}"', { filter })
					: t("skills.library", "Library"),
			},
			...matching.slice(0, SHOWN).map(row),
		);
		if (matching.length > SHOWN) {
			nodes.push({
				type: "text",
				text: t(
					"skills.more",
					"… {{count}} more; type in Find to narrow them down.",
					{ count: matching.length - SHOWN },
				),
				tone: "muted",
			});
		}
		if (!skills.items.length && !skills.loading) {
			nodes.push({
				type: "text",
				text: t(
					"skills.empty",
					"No skills yet. Create one here or import them on the Skills page.",
				),
				tone: "muted",
			});
		}
		return nodes;
	},

	async act(machine, id, value) {
		const [action, target = ""] = id.split(":");
		switch (action) {
			case "refresh":
				await machine.refreshSkills();
				return "refreshed Skills";
			case "filter":
				machine.setDraft(FILTER, String(value ?? ""));
				return "";
			case "open":
				await machine.openSkill(target);
				return `opened the skill "${target}"`;
			case "back":
				machine.closeSkill();
				return "went back to all skills";
			case "use": {
				const enabled = Boolean(value);
				await machine.setSkillEnabled(target, enabled);
				return `${enabled ? "enabled" : "disabled"} the skill "${target}"; it applies from the next message`;
			}
			case "new":
				machine.clearDrafts("skills:editing");
				machine.clearDrafts("skills:name");
				machine.clearDrafts("skills:description");
				machine.clearDrafts("skills:body");
				machine.setDraft(EDITING, "new");
				return "started a new skill";
			case "edit": {
				const skill = await machine.openSkill(target);
				machine.setDraft(EDITING, skill.name);
				machine.setDraft(field("description"), skill.description);
				machine.setDraft(field("body"), skill.body);
				return `started editing the skill "${skill.name}"`;
			}
			case "name":
			case "description":
			case "body":
				machine.setDraft(field(action), String(value ?? ""));
				return "";
			case "cancel":
				for (const name of ["editing", "name", "description", "body"]) {
					machine.setDraft(field(name), undefined);
				}
				return "closed the skill form";
			case "save": {
				const editing = machine.draft<string>(EDITING, "");
				const name =
					editing === "new"
						? String(machine.draft(field("name"), "")).trim()
						: editing;
				await machine.saveSkill({
					name,
					description: String(machine.draft(field("description"), "")),
					body: String(machine.draft(field("body"), "")),
				});
				for (const draft of ["editing", "name", "description", "body"]) {
					machine.setDraft(field(draft), undefined);
				}
				return `saved the skill "${name}"`;
			}
			case "delete":
				await machine.deleteSkill(target);
				return `deleted the skill "${target}"`;
			default:
				throw new Error(`Skills has no control ${id}.`);
		}
	},
};
