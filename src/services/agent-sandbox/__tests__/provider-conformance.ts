import { expect } from "vitest";
import type { SandboxProvider } from "@/services/flows-core/interfaces/services/agent-sandbox";

export const expectSandboxProviderConformance = async (
	provider: SandboxProvider,
): Promise<void> => {
	const context = {
		operationId: "provider-conformance",
		sessionKey: "conformance-session",
	};
	const session = await provider.createSession(
		{ sessionKey: "conformance-session" },
		context,
	);

	expect(session.descriptor.providerId).toBe(provider.id);
	expect(session.descriptor.sessionId).toEqual(expect.any(String));
	expect(session.descriptor.providerSessionId).toEqual(expect.any(String));
	expect(session.capabilities.limits.maxOutputChars).toBeGreaterThan(0);
	await expect(session.workspace.bind(undefined, context)).resolves.toEqual({
		changedPaths: [],
		conflicts: [],
	});
	await expect(
		session.runtime.run({ operation: "code", code: "1 + 1" }, context),
	).resolves.toMatchObject({ kind: "code" });
	await expect(
		session.runtime.run({ operation: "command", command: "echo ok" }, context),
	).resolves.toMatchObject({ kind: "command", processId: expect.any(String) });
	await expect(
		session.processes.manage({ operation: "list" }, context),
	).resolves.toHaveProperty("processes");
	await expect(
		session.inspect({ operation: "status" }, context),
	).resolves.toBeDefined();
	await expect(session.close(context)).resolves.toBeUndefined();
};
