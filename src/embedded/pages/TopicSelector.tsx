import type React from "react";
import { useEffect, useState } from "react";
import { EmbeddedRoot } from "@/embedded/components/EmbeddedRoot";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import {
	getTopicsForSelector,
	sendContentWithTopic,
} from "@/embedded/messaging";
import { customStyles } from "@/embedded/styles/customStyles";
import type { TopicSelectorProps } from "@/embedded/types";

import { createShadowPage } from "@/embedded/utils/create-shadow-page";
import { logWarn } from "@/utils/logger";

interface Topic {
	id: string;
	name: string;
	description?: string;
}

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
	<svg
		className={className || "w-4 h-4"}
		fill="currentColor"
		viewBox="0 0 20 20"
	>
		<path
			fillRule="evenodd"
			d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
			clipRule="evenodd"
		/>
	</svg>
);

const TopicSelector: React.FC<TopicSelectorProps> = ({
	context,
	pageUrl,
	pageTitle,
	onClose,
}) => {
	const t = useEmbeddedTranslation("topicSelector");
	const [topics, setTopics] = useState<Topic[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		loadTopics();
	}, []);

	const loadTopics = async () => {
		try {
			setLoading(true);
			const loadedTopics = await getTopicsForSelector();
			setTopics(loadedTopics);
		} catch (error) {
			logWarn("Failed to load topics:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleTopicSelect = async (topic: Topic) => {
		if (saving) return;

		setSelectedTopic(topic);
		setSaving(true);

		try {
			await sendContentWithTopic(context, pageUrl, pageTitle, topic.id);

			// Show success message briefly
			setTimeout(() => {
				onClose();
			}, 1500);
		} catch (error) {
			logWarn("Failed to save content with topic:", error);
			setSaving(false);
			// Reset selection on error
			setSelectedTopic(null);
		}
	};

	// Center the modal properly with compact sizing
	const getPositionStyle = () => {
		return {
			position: "fixed" as const,
			left: "50%",
			top: "50%",
			transform: "translate(-50%, -50%)",
			width: "280px",
			maxHeight: "320px",
			maxWidth: "90vw",
		};
	};

	if (saving && selectedTopic) {
		return (
			<div
				className="fixed inset-0 z-[999999] bg-black/70 animate-in fade-in duration-200"
				onClick={(e) => {
					if (e.target === e.currentTarget) {
						onClose();
					}
				}}
			>
				<div
					style={getPositionStyle()}
					className="bg-background border border-border rounded-lg shadow-2xl p-6 flex flex-col items-center gap-3 animate-in zoom-in-95 duration-200"
				>
					<div className="text-green-600">
						<CheckIcon className="w-8 h-8" />
					</div>
					<div className="text-center">
						<h3 className="font-semibold text-sm">{t("savedToTopic")}</h3>
						<p className="text-xs text-muted-foreground mt-1">
							{t("contentSaved")} "{selectedTopic.name}"
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			style={{
				position: "fixed",
				top: "0",
				left: "0",
				right: "0",
				bottom: "0",
				backgroundColor: "rgba(0, 0, 0, 0.5)",
				zIndex: "999999",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
			onClick={onClose}
		>
			{loading ? (
				<div
					style={{
						color: "white",
						fontSize: "16px",
						backgroundColor: "rgba(0, 0, 0, 0.8)",
						padding: "10px 20px",
						borderRadius: "6px",
					}}
				>
					{t("loading")}
				</div>
			) : (
				<select
					style={{
						padding: "12px 16px",
						fontSize: "16px",
						border: "2px solid #007bff",
						borderRadius: "8px",
						backgroundColor: "white",
						color: "#333",
						minWidth: "200px",
						boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
						outline: "none",
						cursor: "pointer",
					}}
					onChange={(e) => {
						const topic = topics.find((t) => t.id === e.target.value);
						if (topic) {
							handleTopicSelect(topic);
						}
					}}
					onClick={(e) => e.stopPropagation()}
					defaultValue=""
				>
					<option value="" disabled style={{ color: "#999" }}>
						{t("chooseATopic")}
					</option>
					{topics.map((topic) => (
						<option key={topic.id} value={topic.id} style={{ color: "#333" }}>
							{topic.name}
						</option>
					))}
				</select>
			)}
		</div>
	);
};

// Function to create and mount the topic selector with Shadow DOM isolation
export async function createEmbeddedTopicSelector(
	props: TopicSelectorProps,
): Promise<() => void> {
	const { root, container, shadowContainer } = createShadowPage({
		customStyles,
	});

	const cleanupModal = () => {
		root.unmount();
		container.remove();
	};

	const selectorProps = {
		...props,
		onClose: () => {
			props.onClose();
			cleanupModal();
		},
	};

	root.render(
		<EmbeddedRoot themeTarget={shadowContainer}>
			<TopicSelector {...selectorProps} />
		</EmbeddedRoot>,
	);

	// Append to body
	document.body.appendChild(container);

	// Auto-remove after 30 seconds if no selection
	const autoRemoveTimer = setTimeout(() => {
		cleanupModal();
	}, 30000);

	// Return cleanup function
	return () => {
		clearTimeout(autoRemoveTimer);
		cleanupModal();
	};
}

export default TopicSelector;
