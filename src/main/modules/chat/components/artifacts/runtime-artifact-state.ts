import type { RuntimeArtifact } from "./artifact-protocol";

/** Names an artifact for RuntimePage to show, through router state. */
export interface RuntimeArtifactTarget {
	type: string;
	title?: string;
	identifier?: string;
}

export const runtimeArtifactState = (artifact: RuntimeArtifactTarget) => ({
	section: "artifacts" as const,
	artifact,
});

export const readRuntimeArtifactTarget = (
	state: unknown,
): RuntimeArtifactTarget | null => {
	if (typeof state !== "object" || state === null) return null;
	const artifact = (state as { artifact?: unknown }).artifact;
	if (typeof artifact !== "object" || artifact === null) return null;
	const { type, title, identifier } = artifact as Record<string, unknown>;
	if (typeof type !== "string") return null;
	return {
		type,
		title: typeof title === "string" ? title : undefined,
		identifier: typeof identifier === "string" ? identifier : undefined,
	};
};

/** The latest artifact that matches, by identifier when it has one. */
export const findRuntimeArtifact = (
	artifacts: RuntimeArtifact[],
	target: RuntimeArtifactTarget,
): RuntimeArtifact | undefined =>
	artifacts.findLast((artifact) =>
		target.identifier
			? artifact.identifier === target.identifier
			: artifact.type === target.type && artifact.title === target.title,
	);
