import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { providers?: string }) =>
			values?.providers ? `${key}: ${values.providers}` : key,
	}),
}));

import { PasskeyPromptDialog } from "../PasskeyPromptDialog";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PasskeyPromptDialog", () => {
	it("requires a destructive confirmation before resetting encrypted data", async () => {
		const onForgotPasskey = vi.fn(async () => undefined);

		render(
			<PasskeyPromptDialog
				open
				providers={["openai", "openrouter"]}
				onPasskeySubmit={vi.fn()}
				onCancel={vi.fn()}
				onForgotPasskey={onForgotPasskey}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "passkeyDialog.forgotPasskey" }),
		);

		expect(screen.getByText("passkeyDialog.resetWarning")).toBeInTheDocument();
		expect(
			screen.getByText("passkeyDialog.resetProviders: OpenAI, OpenRouter"),
		).toBeInTheDocument();
		expect(onForgotPasskey).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole("button", { name: "passkeyDialog.resetConfirm" }),
		);

		await waitFor(() => expect(onForgotPasskey).toHaveBeenCalledTimes(1));
	});
});
