import { MessageCircle, Send, Sparkles, X } from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import React from "react";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import {
	type CoAgentContextAnchor,
	describeContextAnchor,
} from "@/embedded/utils/co-agent/context-anchor";
import { CO_AGENT_CONTEXT_SHORTCUT_LABEL } from "./useCoAgentContextAnchor";

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

interface AnchorPoint {
	left: number;
	top: number;
}

const getAnchorPoint = (
	anchor: CoAgentContextAnchor,
	variant: "trigger" | "prompt",
): AnchorPoint => {
	const width = variant === "prompt" ? 340 : 188;
	const height = variant === "prompt" ? 58 : 34;
	const gap = 10;
	const maxLeft = Math.max(12, window.innerWidth - width - 12);
	const maxTop = Math.max(12, window.innerHeight - height - 12);
	if (variant === "trigger" && anchor.uiPoint) {
		return {
			left: clamp(anchor.uiPoint.x + 12, 12, maxLeft),
			top: clamp(anchor.uiPoint.y + 10, 12, maxTop),
		};
	}
	let left = anchor.rect.x + anchor.rect.width + gap;
	if (left + width > window.innerWidth - 12) {
		left = anchor.rect.x - width - gap;
	}
	let top = anchor.rect.y + Math.min(anchor.rect.height, 42);
	if (top + height > window.innerHeight - 12) {
		top = anchor.rect.y - height - gap;
	}
	return {
		left: clamp(left, 12, maxLeft),
		top: clamp(top, 12, maxTop),
	};
};

const getAnchorPosition = (
	anchor: CoAgentContextAnchor,
	variant: "trigger" | "prompt",
): React.CSSProperties => {
	const point = getAnchorPoint(anchor, variant);
	return {
		left: `${point.left}px`,
		top: `${point.top}px`,
	};
};

/**
 * The dock owns the bottom-right corner. A trigger placed under it is either
 * hidden behind the dock or fighting it for the same click, so hovering an
 * element there should not raise one at all.
 */
const DOCK_RESERVED_WIDTH = 250;
const DOCK_RESERVED_HEIGHT = 190;

export const overlapsCoAgentDock = (anchor: CoAgentContextAnchor): boolean => {
	const { left, top } = getAnchorPoint(anchor, "trigger");
	const triggerRight = left + 188;
	const triggerBottom = top + 34;
	return (
		triggerRight > window.innerWidth - DOCK_RESERVED_WIDTH &&
		triggerBottom > window.innerHeight - DOCK_RESERVED_HEIGHT
	);
};

interface AnchorTriggerProps {
	anchor: CoAgentContextAnchor;
	/** Attach the hovered element, then open the prompt. */
	onAskAboutThis: () => void;
	/** Open the prompt with nothing attached. */
	onAsk: () => void;
}

export const CoAgentAnchorTrigger: React.FC<AnchorTriggerProps> = ({
	anchor,
	onAskAboutThis,
	onAsk,
}) => {
	const t = useEmbeddedTranslation("coAgent");
	const askAboutThisLabel = t("askAboutThisShortcut", {
		shortcut: CO_AGENT_CONTEXT_SHORTCUT_LABEL,
	});
	const point = getAnchorPoint(anchor, "trigger");
	const left = useMotionValue(point.left);
	const top = useMotionValue(point.top);
	const springLeft = useSpring(left, {
		stiffness: 500,
		damping: 50,
		bounce: 0,
	});
	const springTop = useSpring(top, {
		stiffness: 500,
		damping: 50,
		bounce: 0,
	});

	React.useEffect(() => {
		left.set(point.left);
		top.set(point.top);
	}, [left, point.left, point.top, top]);

	return (
		<motion.div
			className="memorall-co-agent-anchor-trigger-group"
			style={{ left: springLeft, top: springTop }}
		>
			<button
				type="button"
				className="memorall-co-agent-anchor-trigger"
				aria-label={askAboutThisLabel}
				title={askAboutThisLabel}
				onClick={onAskAboutThis}
			>
				<Sparkles size={13} strokeWidth={2.4} />
				<span>{t("anchorAskAboutThis")}</span>
			</button>
			<button
				type="button"
				className="memorall-co-agent-anchor-trigger memorall-co-agent-anchor-trigger--plain"
				aria-label={t("anchorAskTitle")}
				title={t("anchorAskTitle")}
				onClick={onAsk}
			>
				<MessageCircle size={13} strokeWidth={2.35} />
				<span>{t("anchorAsk")}</span>
			</button>
		</motion.div>
	);
};

interface AttachmentChipProps {
	label: string;
	onRemove: () => void;
}

/** Tells the user what is riding along with the prompt. */
export const CoAgentAttachmentChip: React.FC<AttachmentChipProps> = ({
	label,
	onRemove,
}) => {
	const t = useEmbeddedTranslation("coAgent");
	return (
		<div className="memorall-co-agent-attachment" title={label}>
			<Sparkles size={11} strokeWidth={2.4} />
			<span className="memorall-co-agent-attachment-text">{label}</span>
			<button
				type="button"
				className="memorall-co-agent-attachment-remove"
				aria-label={t("removeAttachedElement")}
				title={t("removeAttachedElement")}
				onClick={onRemove}
			>
				<X size={11} strokeWidth={2.6} />
			</button>
		</div>
	);
};

interface AnchorAttachmentProps {
	anchor: CoAgentContextAnchor;
	onRemove: () => void;
}

export const CoAgentAnchorAttachment: React.FC<AnchorAttachmentProps> = ({
	anchor,
	onRemove,
}) => (
	<CoAgentAttachmentChip
		label={describeContextAnchor(anchor)}
		onRemove={onRemove}
	/>
);

interface AnchorPromptProps {
	anchor: CoAgentContextAnchor;
	value: string;
	inputRef: React.RefObject<HTMLTextAreaElement | null>;
	modelAvailable: boolean;
	isSubmitting: boolean;
	onChange: (value: string) => void;
	onClose: () => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export const CoAgentAnchorPrompt: React.FC<AnchorPromptProps> = ({
	anchor,
	value,
	inputRef,
	modelAvailable,
	isSubmitting,
	onChange,
	onClose,
	onSubmit,
}) => {
	const t = useEmbeddedTranslation("coAgent");
	return (
		<form
			className="memorall-co-agent-anchor-prompt"
			style={getAnchorPosition(anchor, "prompt")}
			onSubmit={onSubmit}
		>
			<textarea
				ref={inputRef}
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onClose();
						return;
					}
					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						event.currentTarget.form?.requestSubmit();
					}
				}}
				placeholder={
					modelAvailable ? t("askAboutThisPlaceholder") : t("noModelAvailable")
				}
				disabled={!modelAvailable || isSubmitting}
				rows={1}
			/>
			<button
				type="submit"
				aria-label={t("send")}
				disabled={!value.trim() || !modelAvailable || isSubmitting}
			>
				<Send size={15} strokeWidth={2.2} />
			</button>
		</form>
	);
};
