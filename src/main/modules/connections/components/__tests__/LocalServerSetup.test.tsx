import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

// The document filesystem mounts IndexedDB on import, which jsdom has not got.
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFileAsBase64: vi.fn(async () => "") },
}));

// Reaching the connections registry pulls the tool catalogue, and with it
// pdfjs, which wants a canvas jsdom has not got.
vi.mock("pdfjs-dist", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({ promise: Promise.resolve(null) }),
	OPS: {
		paintImageXObject: 1,
		paintImageXObjectRepeat: 2,
		paintInlineImageXObject: 3,
		paintJpegXObject: 4,
	},
}));

const port = vi.hoisted(() => ({
	ensure: vi.fn(),
	listTools: vi.fn(),
	call: vi.fn(),
	stop: vi.fn(async () => null),
	status: vi.fn(async () => []),
	probe: vi.fn(async (commands: string[]) =>
		Object.fromEntries(commands.map((command) => [command, { found: true }])),
	),
	pickDirectory: vi.fn(async () => "/picked/repo"),
}));
const platformState = vi.hoisted(() => ({
	environment: "desktop",
	mcpStdio: port as unknown,
	externalLinks: { open: vi.fn(async () => undefined) },
	assets: { url: (path: string) => path },
	capabilities: {
		get: () => ({ available: true }),
		subscribe: () => () => undefined,
	},
	persistentStore: {
		get: async () => null,
		set: async () => undefined,
		remove: async () => undefined,
		subscribe: () => () => undefined,
	},
}));
vi.mock("@/platform/current", () => ({ platform: platformState }));

const services = vi.hoisted(() => ({
	discoverStdioConnection: vi.fn(),
	approveStdio: vi.fn(async () => undefined),
	revokeStdioApproval: vi.fn(async () => undefined),
	isStdioApproved: vi.fn(async () => false),
	loadStdioSecrets: vi.fn(async () => ({})),
	saveToolCacheEntry: vi.fn(async () => undefined),
}));
vi.mock("@/services/mcp-connections", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/mcp-connections")>()),
	...services,
}));

vi.mock("@/utils/master-key", () => ({
	hasMasterKey: vi.fn(async () => true),
	isMasterKeyUnlocked: vi.fn(async () => true),
	saveSecret: vi.fn(async () => undefined),
	setupMasterKey: vi.fn(),
	unlockMasterKey: vi.fn(),
}));

const save = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/main/stores/connections", () => ({
	useConnectionsStore: (selector: (state: { save: typeof save }) => unknown) =>
		selector({ save }),
}));

import { saveSecret } from "@/utils/master-key";
import { LocalServerSetup } from "../LocalServerSetup";

const tools = [
	{
		name: "git_status",
		exposedName: "git__git_status",
		description: "Show the working tree status",
		readOnly: true,
	},
];

const pickGit = async () => {
	fireEvent.click(screen.getByText("template.catalog.git.name"));
	await screen.findByText("template.fields.git.repository.label *");
};

beforeEach(() => {
	platformState.mcpStdio = port;
	for (const fn of Object.values(services)) fn.mockClear();
	for (const fn of Object.values(port)) fn.mockClear();
	save.mockClear();
	services.discoverStdioConnection.mockResolvedValue({
		ok: true,
		descriptors: tools,
		latencyMs: 12,
	});
});

describe("LocalServerSetup", () => {
	it("says local servers need the desktop app where processes cannot start", () => {
		platformState.mcpStdio = undefined;
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);

		expect(
			screen.getByText("lanes.template.notBuiltTitle"),
		).toBeInTheDocument();
		expect(
			screen.queryByText("template.catalog.git.name"),
		).not.toBeInTheDocument();
	});

	it("offers every template and a custom command", () => {
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);

		for (const id of ["filesystem", "git", "fetch", "memory", "playwright"]) {
			expect(
				screen.getByText(`template.catalog.${id}.name`),
			).toBeInTheDocument();
		}
		expect(screen.getByText("template.customCommand.name")).toBeInTheDocument();
	});

	it("shows the exact command only once the required fields are filled", async () => {
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
		await pickGit();

		expect(
			screen.queryByText("template.approveAction"),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByText("template.browse"));
		expect(
			await screen.findByText(
				"uvx mcp-server-git==2026.8.18 --repository /picked/repo",
			),
		).toBeInTheDocument();
		expect(screen.getByText("template.approveAction")).toBeInTheDocument();
	});

	it("approves, starts, lists tools and saves a local server", async () => {
		const onSaved = vi.fn();
		render(<LocalServerSetup onSaved={onSaved} onCancel={vi.fn()} />);
		await pickGit();
		fireEvent.click(screen.getByText("template.browse"));
		await screen.findByText("template.approveAction");

		expect(
			screen.getByRole("button", { name: "template.save" }),
		).toBeDisabled();
		fireEvent.click(screen.getByText("template.approveAction"));

		expect(await screen.findByText("git__git_status")).toBeInTheDocument();
		const [candidate] = services.discoverStdioConnection.mock.calls[0] ?? [];
		expect(services.approveStdio).toHaveBeenCalledWith(candidate);
		expect(candidate).toMatchObject({
			kind: "template",
			transport: "stdio",
			url: "",
			stdio: {
				command: "uvx",
				args: ["mcp-server-git==2026.8.18", "--repository", "/picked/repo"],
				templateId: "git",
			},
		});

		const saveButton = screen.getByRole("button", { name: "template.save" });
		await waitFor(() => expect(saveButton).toBeEnabled());
		fireEvent.click(saveButton);

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(services.saveToolCacheEntry).toHaveBeenCalledWith(
			candidate.id,
			expect.objectContaining({ descriptors: tools }),
		);
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ id: candidate.id, transport: "stdio" }),
		);
	});

	it("shows why a start failed and keeps save disabled", async () => {
		services.discoverStdioConnection.mockResolvedValue({
			ok: false,
			reason: "exited",
			error: "fatal: not a git repository",
		});
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
		await pickGit();
		fireEvent.click(screen.getByText("template.browse"));
		fireEvent.click(await screen.findByText("template.approveAction"));

		expect(await screen.findByText("template.startFailed")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "template.save" }),
		).toBeDisabled();
		expect(screen.getByText("template.runAgain")).toBeInTheDocument();
	});

	it("points at the installer when the launcher is missing", async () => {
		port.probe.mockResolvedValueOnce({ uvx: { found: false } });
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
		await pickGit();

		expect(
			await screen.findByText(
				"template.runtimeMissingPython",
				{},
				{ timeout: 3_000 },
			),
		).toBeInTheDocument();
		fireEvent.click(screen.getByText("template.installUv"));
		expect(platformState.externalLinks.open).toHaveBeenCalledWith(
			"https://docs.astral.sh/uv/getting-started/installation/",
		);
	});

	it("stops the process and drops the approval when left unsaved", async () => {
		const { unmount } = render(
			<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />,
		);
		await pickGit();
		fireEvent.click(screen.getByText("template.browse"));
		fireEvent.click(await screen.findByText("template.approveAction"));
		await screen.findByText("git__git_status");
		const [candidate] = services.discoverStdioConnection.mock.calls[0] ?? [];

		unmount();

		expect(port.stop).toHaveBeenCalledWith(candidate.id);
		expect(services.revokeStdioApproval).toHaveBeenCalledWith(candidate.id);
	});

	it("builds a custom command from one argument per line, without a shell", async () => {
		render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
		fireEvent.click(screen.getByText("template.customCommand.name"));

		fireEvent.change(
			screen.getByPlaceholderText("template.commandPlaceholder"),
			{
				target: { value: "docker" },
			},
		);
		fireEvent.change(screen.getByPlaceholderText(/-y/), {
			target: { value: "run\n-i\n--rm\nmcp/time; echo hi" },
		});
		fireEvent.click(await screen.findByText("template.approveAction"));

		await waitFor(() =>
			expect(services.discoverStdioConnection).toHaveBeenCalled(),
		);
		const [candidate] = services.discoverStdioConnection.mock.calls[0] ?? [];
		expect(candidate.stdio).toEqual({
			command: "docker",
			args: ["run", "-i", "--rm", "mcp/time; echo hi"],
		});
	});

	describe("servers that need a key", () => {
		const pickBrave = async (): Promise<HTMLInputElement> => {
			fireEvent.click(screen.getByText("template.catalog.brave-search.name"));
			return waitFor(() => {
				const input = document.querySelector<HTMLInputElement>(
					"input[type=password]",
				);
				if (!input) throw new Error("key input not rendered yet");
				return input;
			});
		};

		it("groups servers by use and marks which need a key", () => {
			render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);

			expect(screen.getByText("template.categories.web")).toBeInTheDocument();
			expect(screen.getByText("template.categories.work")).toBeInTheDocument();
			expect(
				screen.getAllByText("template.keyRequired").length,
			).toBeGreaterThan(5);
			expect(screen.getAllByText("template.keyOptional")).toHaveLength(2);
		});

		it("asks for the key before it will run, and keeps it off the command line", async () => {
			const onSaved = vi.fn();
			render(<LocalServerSetup onSaved={onSaved} onCancel={vi.fn()} />);
			const keyInput = await pickBrave();

			expect(
				screen.queryByText("template.approveAction"),
			).not.toBeInTheDocument();
			fireEvent.change(keyInput, { target: { value: "BSA-secret-123" } });

			expect(
				await screen.findByText(
					/^npx -y @brave\/brave-search-mcp-server@2\.1\.3/,
				),
			).toBeInTheDocument();
			expect(screen.getByText(/env: BRAVE_API_KEY/)).toBeInTheDocument();
			expect(document.body.textContent).not.toContain("BSA-secret-123");

			fireEvent.click(screen.getByText("template.approveAction"));
			await screen.findByText("git__git_status");
			const [candidate, secrets] =
				services.discoverStdioConnection.mock.calls[0] ?? [];
			expect(candidate.stdio.secretEnvKeys).toEqual(["BRAVE_API_KEY"]);
			expect(JSON.stringify(candidate)).not.toContain("BSA-secret-123");
			expect(secrets).toEqual({ BRAVE_API_KEY: "BSA-secret-123" });

			fireEvent.click(screen.getByRole("button", { name: "template.save" }));
			await waitFor(() => expect(onSaved).toHaveBeenCalled());
			expect(saveSecret).toHaveBeenCalledWith(
				`mcp_secret_${candidate.id}`,
				JSON.stringify({ BRAVE_API_KEY: "BSA-secret-123" }),
			);
		});

		it("can reveal a pasted key to check it", async () => {
			render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
			const keyInput = await pickBrave();

			fireEvent.click(screen.getByRole("button", { name: "template.showKey" }));
			expect(keyInput).toHaveAttribute("type", "text");
			fireEvent.click(screen.getByRole("button", { name: "template.hideKey" }));
			expect(keyInput).toHaveAttribute("type", "password");
		});

		it("explains where to get the key, step by step, with a link", async () => {
			render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
			await pickBrave();

			fireEvent.click(screen.getByText("template.guide.trigger"));

			expect(
				await screen.findByText("template.guides.brave-search.apiKey.title"),
			).toBeInTheDocument();
			for (const step of [1, 2, 3]) {
				expect(
					screen.getByText(`template.guides.brave-search.apiKey.step${step}`),
				).toBeInTheDocument();
			}
			expect(
				screen.queryByText("template.guides.brave-search.apiKey.step4"),
			).not.toBeInTheDocument();
			fireEvent.click(screen.getByText("template.guide.open"));
			expect(platformState.externalLinks.open).toHaveBeenCalledWith(
				"https://api-dashboard.search.brave.com/app/keys",
			);
		});

		it("keeps a stored key when editing without retyping it", async () => {
			services.loadStdioSecrets.mockResolvedValueOnce({
				BRAVE_API_KEY: "stored-key",
			});
			render(
				<LocalServerSetup
					connection={{
						id: "brave-1",
						kind: "template",
						name: "Brave",
						transport: "stdio",
						url: "",
						authMode: "none",
						secretRef: "mcp_secret_brave-1",
						stdio: {
							command: "npx",
							args: ["-y", "@brave/brave-search-mcp-server@2.1.3"],
							secretEnvKeys: ["BRAVE_API_KEY"],
							templateId: "brave-search",
							templateValues: {},
						},
						enabledByDefault: true,
						createdAt: "2026-08-17T00:00:00.000Z",
						updatedAt: "2026-08-17T00:00:00.000Z",
					}}
					onSaved={vi.fn()}
					onCancel={vi.fn()}
				/>,
			);

			expect(
				await screen.findByPlaceholderText("template.secretStored"),
			).toBeInTheDocument();
			fireEvent.click(await screen.findByText("template.approveAction"));

			await waitFor(() =>
				expect(services.discoverStdioConnection).toHaveBeenCalled(),
			);
			const [, secrets] = services.discoverStdioConnection.mock.calls[0] ?? [];
			expect(secrets).toEqual({ BRAVE_API_KEY: "stored-key" });
		});

		it("starts toggles at their safe default", async () => {
			render(<LocalServerSetup onSaved={vi.fn()} onCancel={vi.fn()} />);
			fireEvent.click(screen.getByText("template.catalog.postgres.name"));

			const readOnly = await screen.findByRole("switch", {
				name: "template.fields.postgres.readOnly.label",
			});
			expect(readOnly).toHaveAttribute("aria-checked", "true");
		});
	});
});
