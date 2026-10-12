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
	llmHas: vi.fn(() => false),
	llmRemove: vi.fn(),
	llmClear: vi.fn(async () => undefined),
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
			clearCurrentModelsForProvider: mocks.llmClear,
			remove: mocks.llmRemove,
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

import { CustomProviderTab } from "../CustomProviderTab";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.databaseUse.mockResolvedValue([]);
	mocks.secureExists.mockResolvedValue(false);
	mocks.llmHas.mockReturnValue(false);
	mocks.hasMasterKey.mockResolvedValue(true);
	mocks.deleteMasterKeyIfUnused.mockResolvedValue(false);
	mocks.getEncryptedProviders.mockResolvedValue(["custom"]);
	mocks.isMasterKeyUnlocked.mockResolvedValue(true);
	mocks.getMasterStrongPassword.mockResolvedValue("strong-password");
	mocks.loadProviderConfig.mockResolvedValue({
		apiKey: "saved-key",
		baseUrl: "https://custom.test/v1",
		modelIds: ["saved-model"],
	});
});
afterEach(cleanup);

async function fillConfig() {
	await screen.findByText("openai.noConfigurationFound");
	fireEvent.change(screen.getByPlaceholderText("custom.baseUrlPlaceholder"), {
		target: { value: " https://custom.test/api/v1/// " },
	});
	fireEvent.change(screen.getByPlaceholderText("custom.modelIdsPlaceholder"), {
		target: { value: " vendor/model, vendor/model, other-model, " },
	});
}

describe("CustomProviderTab", () => {
	it("encrypts and activates an endpoint without a key or an OpenAI default model", async () => {
		const onConfigurationChange = vi.fn();
		const onModelLoaded = vi.fn();
		render(
			<CustomProviderTab
				onConfigurationChange={onConfigurationChange}
				onModelLoaded={onModelLoaded}
			/>,
		);
		await fillConfig();
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		await screen.findByText("custom.ready");
		expect(mocks.saveProviderConfig).toHaveBeenCalledWith("custom", {
			apiKey: "",
			baseUrl: "https://custom.test/api/v1",
			modelIds: ["vendor/model", "other-model"],
		});
		expect(mocks.llmCreate).toHaveBeenCalledWith("custom", {
			type: "custom",
			apiKey: "",
			baseURL: "https://custom.test/api/v1",
			modelIds: ["vendor/model", "other-model"],
		});
		expect(mocks.secureSet).toHaveBeenCalledWith("custom_ready", "true");
		expect(onConfigurationChange).toHaveBeenCalledWith(true);
		expect(onModelLoaded).not.toHaveBeenCalled();
	});

	it("rejects invalid URLs before saving secrets or creating a service", async () => {
		render(<CustomProviderTab />);
		await fillConfig();
		fireEvent.change(screen.getByPlaceholderText("custom.baseUrlPlaceholder"), {
			target: { value: "file:///private" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		await screen.findByText("custom.invalidBaseUrl");
		expect(mocks.saveProviderConfig).not.toHaveBeenCalled();
		expect(mocks.llmCreate).not.toHaveBeenCalled();
	});

	it("accepts provider keys that do not use OpenAI's sk- prefix", async () => {
		render(<CustomProviderTab />);
		await fillConfig();
		fireEvent.change(screen.getByPlaceholderText("custom.apiKeyPlaceholder"), {
			target: { value: "vendor-key" },
		});
		expect(screen.queryByText("openai.apiKeyWarning")).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		await waitFor(() =>
			expect(mocks.llmCreate).toHaveBeenCalledWith(
				"custom",
				expect.objectContaining({ apiKey: "vendor-key" }),
			),
		);
	});

	it("unlocks the master key and resumes saving", async () => {
		mocks.isMasterKeyUnlocked.mockResolvedValue(false);
		render(<CustomProviderTab />);
		await fillConfig();
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "unlock master key" }),
		);
		await screen.findByText("custom.ready");
		expect(mocks.unlockMasterKey).toHaveBeenCalledWith("master-passkey");
		expect(mocks.saveProviderConfig).toHaveBeenCalledWith(
			"custom",
			expect.objectContaining({ modelIds: ["vendor/model", "other-model"] }),
		);
	});

	it("loads saved custom model IDs after unlocking", async () => {
		mocks.databaseUse.mockResolvedValue([
			{ key: "custom_config", createdAt: new Date() },
		]);
		mocks.isMasterKeyUnlocked
			.mockResolvedValueOnce(false)
			.mockResolvedValue(true);
		render(<CustomProviderTab />);
		fireEvent.click(
			await screen.findByRole("button", { name: "openai.loadConfiguration" }),
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "unlock master key" }),
		);
		await screen.findByText("custom.ready");
		expect(mocks.llmCreate).toHaveBeenCalledWith("custom", {
			type: "custom",
			apiKey: "saved-key",
			baseURL: "https://custom.test/v1",
			modelIds: ["saved-model"],
		});
	});

	it("allows editing a loaded endpoint and clears its previous model selections", async () => {
		mocks.llmHas.mockReturnValue(true);
		mocks.secureExists.mockResolvedValue(true);
		render(<CustomProviderTab />);
		fireEvent.click(
			await screen.findByRole("button", { name: "custom.editConfiguration" }),
		);
		await screen.findByRole("heading", { name: "custom.editConfiguration" });
		expect(
			screen.getByPlaceholderText("custom.modelIdsPlaceholder"),
		).toHaveValue("saved-model");
		fireEvent.change(screen.getByPlaceholderText("custom.baseUrlPlaceholder"), {
			target: { value: "https://replacement.test/v1" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "openai.saveAndEncrypt" }),
		);
		await waitFor(() =>
			expect(mocks.llmCreate).toHaveBeenCalledWith(
				"custom",
				expect.objectContaining({ baseURL: "https://replacement.test/v1" }),
			),
		);
		expect(mocks.llmClear).toHaveBeenCalledWith("custom");
		expect(mocks.llmRemove).toHaveBeenCalledWith("custom");
	});

	it("deletes custom credentials and selections in both UI and background", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		mocks.llmHas.mockReturnValue(true);
		mocks.secureExists.mockResolvedValue(true);
		const onConfigurationChange = vi.fn();
		const { container } = render(
			<CustomProviderTab onConfigurationChange={onConfigurationChange} />,
		);
		await screen.findByText("custom.ready");
		fireEvent.click(container.querySelector("button.text-destructive")!);
		await waitFor(() =>
			expect(onConfigurationChange).toHaveBeenCalledWith(false),
		);
		expect(mocks.llmClear).toHaveBeenCalledWith("custom");
		expect(mocks.secureDelete).toHaveBeenCalledWith("custom_ready");
		expect(mocks.llmRemove).toHaveBeenCalledWith("custom");
		expect(mocks.backgroundExecute).toHaveBeenCalledWith(
			"remove-auth-provider",
			{ provider: "custom" },
			{ stream: false },
		);
		vi.restoreAllMocks();
	});
});
