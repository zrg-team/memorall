import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { TopicSelectorProps } from "../types";
import { getTopicsForSelector, sendContentWithTopic } from "../messaging";
import { customStyles } from "./styles/customStyles";

interface Topic {
	id: string;
	name: string;
	description?: string;
}

// Simple icon components to match ShadcnEmbeddedChat style
const BookOpenIcon: React.FC<{ className?: string }> = ({ className }) => (
	<svg
		className={className || "w-4 h-4"}
		fill="currentColor"
		viewBox="0 0 20 20"
	>
		<path
			fillRule="evenodd"
			d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm5.707 7.707a1 1 0 001.414-1.414L8.414 9.5l1.707-1.793a1 1 0 00-1.414-1.414L7 8.086 5.293 6.293a1 1 0 00-1.414 1.414L5.586 9.5 3.879 11.207a1 1 0 001.414 1.414L7 10.914l1.707 1.793z"
			clipRule="evenodd"
		/>
	</svg>
);

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

const CloseIcon: React.FC<{
	className?: string;
	style?: React.CSSProperties;
}> = ({ className, style }) => (
	<svg
		className={className || "w-4 h-4"}
		fill="currentColor"
		viewBox="0 0 20 20"
		style={style}
	>
		<path
			fillRule="evenodd"
			d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
			clipRule="evenodd"
		/>
	</svg>
);

const Loader: React.FC<{ size?: number; className?: string }> = ({
	size = 16,
	className,
}) => (
	<svg
		className={className || ""}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
	>
		<circle
			className="opacity-25"
			cx="12"
			cy="12"
			r="10"
			stroke="currentColor"
			strokeWidth="4"
		></circle>
		<path
			className="opacity-75"
			fill="currentColor"
			d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
		></path>
	</svg>
);

// Button component to match ShadcnEmbeddedChat style
const Button: React.FC<{
	variant?: "ghost";
	size?: "sm";
	onClick?: () => void;
	className?: string;
	children: React.ReactNode;
}> = ({ variant, size, onClick, className, children }) => (
	<button
		onClick={onClick}
		className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${
			variant === "ghost"
				? "hover:bg-accent hover:text-accent-foreground"
				: "bg-primary text-primary-foreground hover:bg-primary/90"
		} ${size === "sm" ? "h-8 px-3" : "h-10 px-4 py-2"} ${className || ""}`}
	>
		{children}
	</button>
);

const TopicSelector: React.FC<TopicSelectorProps> = ({
	context,
	pageUrl,
	pageTitle,
	onClose,
}) => {
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
			console.error("Failed to load topics:", error);
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
			console.error("Failed to save content with topic:", error);
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
						<h3 className="font-semibold text-sm">Saved to Topic</h3>
						<p className="text-xs text-muted-foreground mt-1">
							Content saved to "{selectedTopic.name}"
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
					Loading...
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
						Choose a topic...
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
export function createEmbeddedTopicSelector(
	props: TopicSelectorProps,
): () => void {
	// Create container element
	const container = document.createElement("div");
	container.id = "memorall-embedded-topic-selector";

	// Create Shadow DOM for complete CSS isolation
	const shadowRoot = container.attachShadow({ mode: "closed" });

	// Create the actual content container inside shadow DOM
	const shadowContainer = document.createElement("div");
	shadowContainer.className = "memorall-topic-selector-container";

	// Inject Tailwind CSS only within the Shadow DOM
	const tailwindStyle = document.createElement("link");
	tailwindStyle.rel = "stylesheet";
	tailwindStyle.href = chrome.runtime.getURL("action/default_popup.css");

	// Add CSS custom properties for proper theming within Shadow DOM
	const customPropsStyle = document.createElement("style");
	customPropsStyle.textContent = customStyles;

	// Add styles to shadow DOM in correct order
	shadowRoot.appendChild(customPropsStyle);
	shadowRoot.appendChild(tailwindStyle);
	shadowRoot.appendChild(shadowContainer);

	// Create root and render inside shadow DOM
	const root = createRoot(shadowContainer);

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

	root.render(<TopicSelector {...selectorProps} />);

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
