import { afterEach, describe, expect, it, vi } from "vitest";
import { listDefaultSkills, readDefaultSkill } from "../default-skills";

describe("default skills", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("has one skill per name, the first collection's", () => {
		const names = listDefaultSkills().map((skill) => skill.name);
		expect(new Set(names).size).toBe(names.length);
		// nexu's dashboard is bundled whole; nothing later replaces it.
		const dashboard = listDefaultSkills().find(
			(skill) => skill.name === "dashboard",
		);
		expect(dashboard?.collection).not.toBe("design-skills");
	});

	it("loads a skill from the files its repo still has", async () => {
		const fetch = vi.fn(async (url: string) =>
			url.endsWith("/DESIGN.md")
				? new Response("", { status: 404 })
				: new Response("---\nname: clean\n---\nUse whitespace.", {
						status: 200,
					}),
		);
		vi.stubGlobal("fetch", fetch);

		const skill = await readDefaultSkill("clean");
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(skill?.body).toBe("Use whitespace.");
	});

	it("says why when none of a skill's files load", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 404 })),
		);
		await expect(readDefaultSkill("bento")).rejects.toThrow(
			'Failed to load default skill "bento" from bergside/awesome-design-skills: HTTP 404',
		);
	});
});
