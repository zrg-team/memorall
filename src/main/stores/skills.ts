import { create } from "zustand";
import {
	skillFileSystemService,
	type Skill,
	type SkillImportCandidate,
	type SkillResource,
	type SkillSummary,
} from "@/services/filesystem/skill-filesystem";
import { logError } from "@/utils/logger";

/** Which lane of the "add skill" chooser is open, if any. */
export type SkillLane = "manual" | "github" | "upload" | "folder";

/**
 * What the detail pane is showing. `resourcePath` is set only when the user
 * drilled into a bundled file rather than the skill's own SKILL.md.
 */
export interface SkillSelection {
	name: string;
	resourcePath?: string;
}

interface SkillsState {
	skills: SkillSummary[];
	selected: SkillSelection | null;
	/** Full body of the selected skill, loaded lazily (standard phase 2). */
	openSkill: Skill | null;
	resources: SkillResource[];
	lane: SkillLane | null;
	pendingImport: SkillImportCandidate[] | null;
	isLoading: boolean;
	isOpening: boolean;
	/** Raw failure text for diagnostics. UI shows its own translated copy. */
	error: string | null;

	initialize: () => Promise<void>;
	refresh: () => Promise<void>;
	select: (selection: SkillSelection | null) => Promise<void>;
	openLane: (lane: SkillLane | null) => void;
	setPendingImport: (candidates: SkillImportCandidate[] | null) => void;
	commitImport: (candidates: SkillImportCandidate[]) => Promise<void>;
	save: (name: string, description: string, body: string) => Promise<void>;
	remove: (name: string) => Promise<void>;

	customCount: () => number;
	findSkill: (name: string) => SkillSummary | undefined;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
	skills: [],
	selected: null,
	openSkill: null,
	resources: [],
	lane: null,
	pendingImport: null,
	isLoading: false,
	isOpening: false,
	error: null,

	initialize: async () => {
		if (get().skills.length > 0) return;
		await get().refresh();
	},

	refresh: async () => {
		set({ isLoading: true });
		try {
			set({ skills: await skillFileSystemService.listSkills(), error: null });
		} catch (error) {
			logError("Failed to list skills:", error);
			set({ skills: [], error: String(error) });
		} finally {
			set({ isLoading: false });
		}
	},

	select: async (selection) => {
		set({ selected: selection, lane: null, pendingImport: null });
		if (!selection) {
			set({ openSkill: null, resources: [] });
			return;
		}

		set({ isOpening: true });
		try {
			const [skill, resources] = await Promise.all([
				skillFileSystemService.readSkill(selection.name),
				skillFileSystemService
					.listSkillResources(selection.name)
					.catch(() => [] as SkillResource[]),
			]);
			// A slower earlier request must not overwrite a newer selection.
			if (get().selected?.name !== selection.name) return;
			set({ openSkill: skill, resources, error: null });
		} catch (error) {
			logError(`Failed to open skill "${selection.name}":`, error);
			if (get().selected?.name !== selection.name) return;
			set({ openSkill: null, resources: [], error: String(error) });
		} finally {
			set({ isOpening: false });
		}
	},

	openLane: (lane) =>
		set({ lane, selected: null, openSkill: null, resources: [] }),

	setPendingImport: (candidates) => set({ pendingImport: candidates }),

	commitImport: async (candidates) => {
		for (const candidate of candidates) {
			try {
				await skillFileSystemService.commitImport(candidate);
			} catch (error) {
				logError(`Failed to import skill "${candidate.name}":`, error);
			}
		}
		set({ pendingImport: null, lane: null });
		await get().refresh();
		const first = candidates[0];
		if (first) await get().select({ name: first.name });
	},

	save: async (name, description, body) => {
		await skillFileSystemService.writeSkill(name, description, body);
		await get().refresh();
		await get().select({ name });
	},

	remove: async (name) => {
		await skillFileSystemService.deleteSkill(name);
		if (get().selected?.name === name) {
			set({ selected: null, openSkill: null, resources: [] });
		}
		await get().refresh();
	},

	customCount: () =>
		get().skills.filter((skill) => skill.origin !== "default").length,

	findSkill: (name) => get().skills.find((skill) => skill.name === name),
}));
