import {
	AudioLines,
	ImageIcon,
	type LucideIcon,
	MessageSquare,
	Mic,
	Music,
	TextSearch,
	Wand2,
} from "lucide-react";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";

export interface StudioModeDescriptor {
	mode: WorkspaceMode;
	icon: LucideIcon;
	/** English fallbacks; `studio:modes.<mode>.*` wins when translated. */
	label: string;
	shortLabel: string;
	description: string;
}

/** Display order of the workspace switcher. */
export const STUDIO_MODE_DESCRIPTORS: readonly StudioModeDescriptor[] = [
	{
		mode: "chat",
		icon: MessageSquare,
		label: "Chat",
		shortLabel: "Chat",
		description: "Talk to an agent or a chat model.",
	},
	{
		mode: "text-to-speech",
		icon: AudioLines,
		label: "Speech",
		shortLabel: "Speak",
		description: "Turn text into natural speech.",
	},
	{
		mode: "speech-to-text",
		icon: Mic,
		label: "Transcribe",
		shortLabel: "Transcribe",
		description: "Record or upload audio and get text back.",
	},
	{
		mode: "image-generation",
		icon: ImageIcon,
		label: "Image",
		shortLabel: "Image",
		description: "Create images from a description.",
	},
	{
		mode: "image-tools",
		icon: Wand2,
		label: "Image tools",
		shortLabel: "Tools",
		description:
			"Remove backgrounds, estimate depth, detect objects, read text.",
	},
	{
		mode: "text-tools",
		icon: TextSearch,
		label: "Text tools",
		shortLabel: "Text",
		description:
			"Classify text, sort it into your own labels and rank documents by relevance.",
	},
	{
		mode: "text-to-audio",
		icon: Music,
		label: "Audio",
		shortLabel: "Audio",
		description: "Generate audio clips, such as music or sound, from a prompt.",
	},
];

export const studioModeDescriptor = (
	mode: WorkspaceMode,
): StudioModeDescriptor =>
	STUDIO_MODE_DESCRIPTORS.find((entry) => entry.mode === mode) ??
	STUDIO_MODE_DESCRIPTORS[0]!;
