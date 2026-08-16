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
			has: vi.fn(() => false),
			getCurrentModel: vi.fn(async () => null),
			clearCurrentModel: vi.fn(),
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
	loadProviderConfig: vi.fn(),
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

import { OpenRouterTab } from "../OpenRouterTab";

beforeEach(() => {
	mocks.databaseUse.mockResolvedValue([]);
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
		expect(onModelLoaded).toHaveBeenCalledWith("openai/gpt-4o", "openrouter");
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
