import { Trash2 } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import type { StudioItem } from "@/types/studio";
import { AudioClipPlayer } from "../shared/AudioClipPlayer";
import { StudioAction, StudioTurn } from "../shared/StudioThread";

interface SpeechTurnCardProps {
	item: StudioItem;
	onDelete: (item: StudioItem) => void;
}

const inputAudioOf = (item: StudioItem) => {
	for (const part of item.parts) {
		if (part.type === "input_audio") return part.input_audio;
	}
	return null;
};

const outputAudioOf = (item: StudioItem) => {
	for (const part of item.parts) {
		if (part.type === "output_audio") return part.output_audio;
	}
	return null;
};

const replyTextOf = (item: StudioItem) => {
	for (const part of item.parts) {
		if (part.type === "text" && part.role === "transcript") return part.text;
	}
	return "";
};

/** One spoken exchange: what you said, then what the model said back. */
export const SpeechTurnCard: React.FC<SpeechTurnCardProps> = ({
	item,
	onDelete,
}) => {
	const { t } = useTranslation("studio");
	const input = inputAudioOf(item);
	const output = outputAudioOf(item);
	const text = replyTextOf(item);

	return (
		<StudioTurn
			item={item}
			data-speech-turn={item.id}
			runningLabel={t("speechToSpeech.responding", {
				defaultValue: "Answering…",
			})}
			request={
				input ? (
					<AudioClipPlayer
						path={input.path}
						mimeType={input.mimeType}
						durationMs={input.durationMs}
						downloadName="you"
						compact
					/>
				) : null
			}
			actions={
				<StudioAction
					icon={<Trash2 size={14} />}
					label={t("speechToSpeech.delete", { defaultValue: "Delete" })}
					destructive
					onClick={() => onDelete(item)}
				/>
			}
		>
			{text ? (
				<p className="whitespace-pre-wrap break-words" data-speech-turn-text>
					{text}
				</p>
			) : null}
			{output ? (
				<AudioClipPlayer
					path={output.path}
					mimeType={output.mimeType}
					durationMs={output.durationMs}
					downloadName="reply"
				/>
			) : null}
		</StudioTurn>
	);
};
