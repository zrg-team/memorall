import { describe, expect, it } from "vitest";
import type { BoundStep, StepFactory } from "flow-core/interfaces/engine/step";
import {
	StepRegistryManager,
	type StepSpec,
} from "flow-core/registries/step-registry";

type VersionedStepSpec = StepSpec & {
	input: string;
	output: string;
	services: undefined;
	config: undefined;
};

const createStep = (label: string): BoundStep<string, string> => ({
	name: "versioned-step",
	execute: async (input) => ({ output: `${label}:${input}` }),
	toNode: () => async () => ({}),
});

const createFactory =
	(label: string): StepFactory<string, string, undefined, undefined> =>
	() =>
		createStep(label);

describe("StepRegistryManager versioned registration", () => {
	it("keeps the highest semver registration for duplicate step ids", async () => {
		const registry = new StepRegistryManager();

		registry.register("versioned-step", createFactory("old"), {
			version: "1.0.0",
			description: "core implementation",
		});
		registry.register("versioned-step", createFactory("latest"), {
			version: "2.0.0",
			description: "integration implementation",
		});
		registry.register("versioned-step", createFactory("stale"), {
			version: "1.5.0",
			description: "stale implementation",
		});

		expect(registry.get("versioned-step")?.config).toMatchObject({
			version: "2.0.0",
			description: "integration implementation",
		});
		await expect(
			registry.getStepByName<string, string>("versioned-step").execute("input"),
		).resolves.toEqual({ output: "latest:input" });
	});

	it("can retrieve a specific registered version while defaulting to latest", async () => {
		const registry = new StepRegistryManager();

		registry.register("versioned-step", createFactory("one"), {
			version: "1.0.0",
			description: "version one",
		});
		registry.register("versioned-step", createFactory("two"), {
			version: "2.0.0",
			description: "version two",
		});

		expect(registry.get("versioned-step")?.config?.version).toBe("2.0.0");
		expect(
			registry.getVersion("versioned-step", "1.0.0")?.config,
		).toMatchObject({
			version: "1.0.0",
			description: "version one",
		});
		expect(
			registry
				.getVersions("versioned-step")
				.map((entry) => entry.config?.version),
		).toEqual(["2.0.0", "1.0.0"]);
		await expect(
			registry
				.getStepByNameVersion<string, string>("versioned-step", "1.0.0")
				.execute("input"),
		).resolves.toEqual({ output: "one:input" });
		await expect(
			registry.getStepByName<string, string>("versioned-step").execute("input"),
		).resolves.toEqual({ output: "two:input" });
	});

	it("preserves registered versions when forking", () => {
		const registry = new StepRegistryManager();

		registry.register("versioned-step", createFactory("one"), {
			version: "1.0.0",
			description: "version one",
		});
		registry.register("versioned-step", createFactory("two"), {
			version: "2.0.0",
			description: "version two",
		});

		const fork = registry.fork();

		expect(fork.get("versioned-step")?.config?.version).toBe("2.0.0");
		expect(fork.getVersion("versioned-step", "1.0.0")?.config).toMatchObject({
			version: "1.0.0",
			description: "version one",
		});
	});

	it("allows same-version registrations to update the current entry", () => {
		const registry = new StepRegistryManager();

		registry.register("same-version-step", createFactory("first"), {
			version: "1.0.0",
			description: "first",
		});
		registry.register("same-version-step", createFactory("second"), {
			version: "1.0.0",
			description: "second",
		});

		expect(registry.get("same-version-step")?.config).toMatchObject({
			version: "1.0.0",
			description: "second",
		});
	});

	it("treats semver prereleases as lower than their release version", () => {
		const registry = new StepRegistryManager();

		registry.register("prerelease-step", createFactory("release"), {
			version: "2.0.0",
			description: "release",
		});
		registry.register("prerelease-step", createFactory("beta"), {
			version: "2.0.0-beta.1",
			description: "beta",
		});

		expect(registry.get("prerelease-step")?.config).toMatchObject({
			version: "2.0.0",
			description: "release",
		});
	});
});

declare global {
	interface StepTypeRegistry {
		"versioned-step": VersionedStepSpec;
		"same-version-step": VersionedStepSpec;
		"prerelease-step": VersionedStepSpec;
	}
}
