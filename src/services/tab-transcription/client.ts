import { platform } from "@/platform/current";
import {
	TAB_TRANSCRIPTION,
	type TabTranscriptionCommand,
	type TabTranscriptionResponse,
} from "./types";

export const supportsTabTranscription = () =>
	platform.environment === "extension";

export async function requestTabTranscription(
	command: TabTranscriptionCommand,
): Promise<TabTranscriptionResponse> {
	const result =
		await platform.browserCommands.request<TabTranscriptionResponse>({
			type: TAB_TRANSCRIPTION,
			...command,
		});
	if (!result?.success)
		throw new Error(
			result?.error || "Could not reach the transcription service.",
		);
	return result;
}
