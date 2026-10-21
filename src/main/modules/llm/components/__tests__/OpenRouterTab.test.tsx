import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	backgroundExecute: vi.fn(),
	databaseUse: vi.fn(),
	deleteMasterKeyIfUnused: vi.fn(),
	getEncryptedProviders: vi.fn(),
	getMasterStrongPassword: vi.fn(),
	hasMasterKey: vi.fn(),
	isMasterKeyUnlocked: vi.fn(),
	llmCreate: vi.fn(),
	llmHas: vi.fn(),
	loadProviderConfig: vi.fn(),
	saveProviderConfig: vi.fn(),
	resetMasterKeyAndEncryptedConfigs: vi.fn(),
	secureDelete: vi.fn(),
	secureExists: vi.fn(),
	secureSet: vi.fn(),
	unlockMasterKey: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: { use: mocks.databaseUse },
		llmService: {
			create: mocks.llmCreate,
			has: mocks.llmHas,
			getCurrentModel: vi.fn(async () => null),
			clearCurrentModel: vi.fn(),
			clearCurrentModelsForProvider: vi.fn(async () => undefined),
			remove: vi.fn(),
		},
	},
}));

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: { execute: mocks.backgroundExecute },
}));

vi.mock("@/utils/secure-session", () => ({
	default: {
		exists: mocks.secureExists,
		set: mocks.secureSet,
		delete: mocks.secureDelete,
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
}));

vi.mock("@/utils/master-key", () => ({
	deleteMasterKeyIfUnused: mocks.deleteMasterKeyIfUnused,
	getEncryptedProviders: mocks.getEncryptedProviders,
	getMasterStrongPassword: mocks.getMasterStrongPassword,
	hasMasterKey: mocks.hasMasterKey,
	isMasterKeyUnlocked: mocks.isMasterKeyUnlocked,
	loadProviderConfig: mocks.loadProviderConfig,
	resetMasterKeyAndEncryptedConfigs: mocks.resetMasterKeyAndEncryptedConfigs,
	saveProviderConfig: mocks.saveProviderConfig,
	setupMasterKey: vi.fn(),
	unlockMasterKey: mocks.unlockMasterKey,
}));

vi.mock("@/main/components/molecules/MasterKeySetupDialog", () => ({
	MasterKeySetupDialog: ({ open }: { open: boolean }) =>
		open ? <div>create new master passkey</div> : null,
}));

vi.mock("@/main/components/molecules/PasskeyPromptDialog", () => ({
	PasskeyPromptDialog: ({
		open,
		onForgotPasskey,
		onPasskeySubmit,
	}: {
		open: boolean;
		onForgotPasskey?: () => Promise<void>;
		onPasskeySubmit: (passkey: string) => Promise<void>;
	}) =>
		open ? (
			<>
				<button type="button" onClick={() => onPasskeySubmit("master-passkey")}>
					unlock master key
				</button>
				<button type="button" onClick={() => onForgotPasskey?.()}>
					forgot master passkey
				</button>
			</>
		) : null,
}));

import { DEFAULT_OPENROUTER_MODEL } from "@/constants/openai";
import { OpenRouterTab } from "../OpenRouterTab";

beforeEach(() => {
	mocks.databaseUse.mockResolvedValue([]);
	mocks.llmHas.mockReturnValue(false);
	mocks.secureExists.mockResolvedValue(false);
	mocks.hasMasterKey.mockResolvedValue(true);
	mocks.deleteMasterKeyIfUnused.mockResolvedValue(false);
	mocks.getEncryptedProviders.mockResolvedValue(["openrouter"]);
	mocks.resetMasterKeyAndEncryptedConfigs.mockResolvedValue(["openai"]);
	mocks.isMasterKeyUnlocked.mockResolvedValue(false);
	mocks.unlockMasterKey.mockResolvedValue("strong-password");
	mocks.getMasterStrongPassword.mockResolvedValue("strong-password");
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OpenRouterTab", () => {
	it("uses a simple API-key form in guided setup while keeping encryption and the default URL", async () => {
		mocks.isMasterKeyUnlocked.mockResolvedValue(true);
		const loaded = vi.fn();
		const busy = vi.fn();
		render(
			<OpenRouterTab simplified onModelLoaded={loaded} onBusyChanged={busy} />,
		);
		fireEvent.change(await screen.findByLabelText(/openrouter.apiKey/), {
			target: { value: "sk-or-guided" },
		});
		expect(
			screen.queryByText("openai.noConfigurationFound"),
		).not.toBeInTheDocument();
		expect(screen.queryByText("openai.secureStorage")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("openai.baseUrl")).not.toBeInTheDocument();
		fireEvent.click(screen.getByText("openrouterGuide.connectAction"));
		await waitFor(() =>
			expect(loaded).toHaveBeenCalledWith("openrouter/free", "openrouter"),
		);
		expect(mocks.saveProviderConfig).toHaveBeenCalledWith("openrouter", {
			apiKey: "sk-or-guided",
			baseUrl: "https://openrouter.ai/api/v1",
		});
		expect(busy).toHaveBeenCalledWith(true);
		await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
	});

	it("reports an already connected provider without choosing a model", async () => {
		mocks.llmHas.mockReturnValue(true);
		mocks.secureExists.mockResolvedValue(true);
		const connected = vi.fn();
		const loaded = vi.fn();
		render(
			<OpenRouterTab onConnectionChanged={connected} onModelLoaded={loaded} />,
		);
		await screen.findByText("openai.openrouterReady");
		await waitFor(() => expect(connected).toHaveBeenLastCalledWith(true));
		expect(loaded).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText("openai.unloadConfiguration"));
		await waitFor(() => expect(connected).toHaveBeenLastCalledWith(false));
	});

	it("unlocks and loads a saved provider configuration", async () => {
		mocks.databaseUse.mockResolvedValue([{ createdAt: new Date() }]);
		mocks.isMasterKeyUnlocked
			.mockResolvedValueOnce(false)
			.mockResolvedValue(true);
		mocks.loadProviderConfig.mockResolvedValue({
			apiKey: "sk-or-saved",
			baseUrl: "https://openrouter.ai/api/v1",
		});
		const connected = vi.fn();
		render(<OpenRouterTab onConnectionChanged={connected} />);
		fireEvent.click(await screen.findByText("openai.loadConfiguration"));
		fireEvent.click(
			await screen.findByRole("button", { name: "unlock master key" }),
		);
		await screen.findByText("openai.openrouterReady");
		expect(mocks.llmCreate).toHaveBeenCalledWith("openrouter", {
			type: "openrouter",
			apiKey: "sk-or-saved",
			baseURL: "https://openrouter.ai/api/v1",
		});
		await waitFor(() => expect(connected).toHaveBeenLastCalledWith(true));
	});

	it("unlocks the existing master key and resumes saving a replacement API key", async () => {
		const onModelLoaded = vi.fn();
		render(<OpenRouterTab onModelLoaded={onModelLoaded} />);

		await screen.findByText("openai.noConfigurationFound");
		fireEvent.change(
			screen.getByPlaceholderText("openrouter.apiKeyPlaceholder"),
			{ target: { value: "sk-or-replacement" } },
		);
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);

		const unlockButton = await screen.findByRole("button", {
			name: "unlock master key",
		});
		expect(mocks.saveProviderConfig).not.toHaveBeenCalled();

		fireEvent.click(unlockButton);

		await waitFor(() => {
			expect(mocks.unlockMasterKey).toHaveBeenCalledWith("master-passkey");
			expect(mocks.saveProviderConfig).toHaveBeenCalledWith("openrouter", {
				apiKey: "sk-or-replacement",
				baseUrl: "https://openrouter.ai/api/v1",
			});
		});

		expect(mocks.llmCreate).toHaveBeenCalledWith("openrouter", {
			type: "openrouter",
			apiKey: "sk-or-replacement",
			baseURL: "https://openrouter.ai/api/v1",
		});
		expect(onModelLoaded).toHaveBeenCalledWith(
			DEFAULT_OPENROUTER_MODEL,
			"openrouter",
		);
		expect(
			await screen.findByText("openai.openrouterReady"),
		).toBeInTheDocument();
	});

	it("removes a stale unused master key and asks for a new passkey", async () => {
		mocks.deleteMasterKeyIfUnused.mockResolvedValue(true);
		render(<OpenRouterTab />);

		await screen.findByText("openai.noConfigurationFound");
		fireEvent.change(
			screen.getByPlaceholderText("openrouter.apiKeyPlaceholder"),
			{ target: { value: "sk-or-replacement" } },
		);
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);

		expect(
			await screen.findByText("create new master passkey"),
		).toBeInTheDocument();
		expect(mocks.unlockMasterKey).not.toHaveBeenCalled();
	});

	it("resets remaining encrypted data before asking for a new passkey", async () => {
		render(<OpenRouterTab />);

		await screen.findByText("openai.noConfigurationFound");
		fireEvent.change(
			screen.getByPlaceholderText("openrouter.apiKeyPlaceholder"),
			{ target: { value: "sk-or-replacement" } },
		);
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "forgot master passkey" }),
		);

		await waitFor(() => {
			expect(mocks.resetMasterKeyAndEncryptedConfigs).toHaveBeenCalledTimes(1);
			expect(screen.getByText("create new master passkey")).toBeInTheDocument();
		});
		expect(mocks.backgroundExecute).toHaveBeenCalledWith(
			"remove-auth-provider",
			{ provider: "openai" },
			{ stream: false },
		);
	});
});
