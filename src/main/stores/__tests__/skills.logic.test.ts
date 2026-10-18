import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Skill,
	SkillSummary,
} from "@/services/filesystem/skill-filesystem";
import type { SkillChange } from "@/services/skill-events";

const mocks = vi.hoisted(() => ({
	listSkills: vi.fn(),
	readSkill: vi.fn(),
	listSkillResources: vi.fn(async () => []),
	refreshFsCache: vi.fn(async (): Promise<void> => undefined),
	listener: undefined as
		| undefined
		| ((change: SkillChange, remote: boolean) => void),
}));
vi.mock("@/services/filesystem/skill-filesystem", () => ({
	skillFileSystemService: mocks,
}));
vi.mock("@/services/filesystem/fs", () => ({
	refreshFsCache: mocks.refreshFsCache,
}));
vi.mock("@/services/skill-events", () => ({
	subscribeSkillChanges: (listener: typeof mocks.listener) => {
		mocks.listener = listener;
		return () => undefined;
	},
}));

const skill = (name: string, body = "original"): Skill => ({
	name,
	description: name,
	body,
	path: `/${name}.md`,
});

describe("skills library synchronization", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("shows creations, updates an open skill and clears it after deletion", async () => {
		let library: SkillSummary[] = [skill("writer")];
		mocks.listSkills.mockImplementation(async () => library);
		mocks.readSkill.mockResolvedValue(skill("writer"));
		const { useSkillsStore } = await import("../skills");
		await useSkillsStore.getState().initialize();
		await useSkillsStore.getState().select({ name: "writer" });
		library = [skill("writer"), skill("new-skill")];
		mocks.listener!({ type: "library", name: "new-skill" }, false);
		await vi.waitFor(() =>
			expect(useSkillsStore.getState().skills).toHaveLength(2),
		);
		mocks.readSkill.mockResolvedValue(skill("writer", "edited elsewhere"));
		mocks.listener!({ type: "library", name: "writer" }, false);
		await vi.waitFor(() =>
			expect(useSkillsStore.getState().openSkill?.body).toBe(
				"edited elsewhere",
			),
		);
		library = [skill("new-skill")];
		mocks.listener!({ type: "library", name: "writer" }, false);
		await vi.waitFor(() =>
			expect(useSkillsStore.getState().selected).toBeNull(),
		);
		expect(useSkillsStore.getState().skills.map((item) => item.name)).toEqual([
			"new-skill",
		]);
		expect(mocks.refreshFsCache).not.toHaveBeenCalled();
	});

	it("remounts before reading another context's change and rejects stale reads", async () => {
		mocks.listSkills.mockResolvedValue([skill("writer")]);
		const { useSkillsStore } = await import("../skills");
		await useSkillsStore.getState().initialize();
		let finishRemount!: () => void;
		mocks.refreshFsCache.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishRemount = resolve;
				}),
		);
		mocks.listSkills.mockClear();
		mocks.listener!({ type: "library", name: "remote" }, true);
		expect(mocks.listSkills).not.toHaveBeenCalled();
		mocks.listSkills.mockResolvedValue([skill("remote")]);
		finishRemount();
		await vi.waitFor(() =>
			expect(useSkillsStore.getState().skills[0]?.name).toBe("remote"),
		);
		let finishOldRead!: (value: SkillSummary[]) => void;
		mocks.listSkills.mockImplementationOnce(
			() =>
				new Promise<SkillSummary[]>((resolve) => {
					finishOldRead = resolve;
				}),
		);
		const old = useSkillsStore.getState().refresh();
		mocks.listSkills.mockResolvedValue([skill("latest")]);
		await useSkillsStore.getState().refresh();
		finishOldRead([skill("outdated")]);
		await old;
		expect(useSkillsStore.getState().skills[0]?.name).toBe("latest");
	});
});
