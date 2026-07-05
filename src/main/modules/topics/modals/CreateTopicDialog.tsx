/**
 * CreateTopicDialog Modal
 * Quick dialog for creating a new topic using nice-modal
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { Loader2, Plus, Tags } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Textarea } from "@/main/components/ui/textarea";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { topicService } from "@/main/modules/topics/services/topic-service";
import type { Topic } from "@/services/database/types";
import {
	DEFAULT_GROW_TYPE,
	DEFAULT_RECALL_TYPE,
	GROW_TYPES,
	getValidRecallTypes,
	type GrowType,
	type RecallType,
} from "@/services/database/entities/topic-types";
import { logError, logInfo } from "@/utils/logger";

const GROW_LABELS: Record<GrowType, string> = {
	"knowledge-graph": "Semantic Graph",
	structmem: "StructMem",
};

const RECALL_LABELS: Record<RecallType, string> = {
	smart: "Smart",
	quick: "Quick",
	llm: "LLM",
	structmem: "StructMem",
};

export const CreateTopicDialog = NiceModal.create(() => {
	const modal = useModal();
	const { t } = useTranslation("topics");
	const [topicName, setTopicName] = useState("");
	const [topicDescription, setTopicDescription] = useState("");
	const [growType, setGrowType] = useState<GrowType>(DEFAULT_GROW_TYPE);
	const [recallType, setRecallType] = useState<RecallType>(DEFAULT_RECALL_TYPE);
	const [creating, setCreating] = useState(false);

	// Reset form when dialog opens
	useEffect(() => {
		if (modal.visible) {
			setTopicName("");
			setTopicDescription("");
			setGrowType(DEFAULT_GROW_TYPE);
			setRecallType(DEFAULT_RECALL_TYPE);
		}
	}, [modal.visible]);

	const validRecallTypes = getValidRecallTypes(growType);

	const handleGrowTypeChange = (value: GrowType) => {
		setGrowType(value);
		const nextRecallTypes = getValidRecallTypes(value);
		setRecallType((current) =>
			nextRecallTypes.includes(current) ? current : nextRecallTypes[0],
		);
	};

	const handleCreate = async () => {
		if (!topicName.trim() || !topicDescription.trim() || creating) return;

		try {
			setCreating(true);
			const newTopic = await topicService.createTopic({
				name: topicName.trim(),
				description: topicDescription.trim(),
				growType,
				recallType,
			});

			logInfo("[CREATE_TOPIC_DIALOG] Created new topic:", newTopic);

			// Reset form
			setTopicName("");
			setTopicDescription("");
			setGrowType(DEFAULT_GROW_TYPE);
			setRecallType(DEFAULT_RECALL_TYPE);

			// Resolve with the created topic
			modal.resolve(newTopic);
			modal.hide();
		} catch (error) {
			logError("[CREATE_TOPIC_DIALOG] Failed to create topic:", error);
		} finally {
			setCreating(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		// Submit on Ctrl+Enter or Cmd+Enter
		if (
			(e.ctrlKey || e.metaKey) &&
			e.key === "Enter" &&
			topicName.trim() &&
			topicDescription.trim() &&
			!creating
		) {
			e.preventDefault();
			e.stopPropagation();
			handleCreate();
		}
	};

	return (
		<Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
			<DialogContent className="sm:max-w-[480px] max-h-[85vh] flex flex-col gap-0 p-0">
				<DialogHeader className="px-6 pt-6">
					<DialogTitle className="flex items-center gap-2">
						<Tags className="h-5 w-5 text-primary" />
						{t("create.title")}
					</DialogTitle>
					<DialogDescription>{t("create.description")}</DialogDescription>
				</DialogHeader>

				<div
					className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0"
					onKeyDown={handleKeyDown}
				>
					<div className="space-y-2">
						<Label htmlFor="topic-name">{t("create.topicName")} *</Label>
						<Input
							id="topic-name"
							placeholder={t("create.namePlaceholder")}
							value={topicName}
							onChange={(e) => setTopicName(e.target.value)}
							autoFocus
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="topic-description">
							{t("create.goalPurpose")} *
						</Label>
						<Textarea
							id="topic-description"
							placeholder={t("create.descriptionPlaceholder")}
							value={topicDescription}
							onChange={(e) => setTopicDescription(e.target.value)}
							rows={3}
						/>
						<p className="text-xs text-muted-foreground">
							{t("create.example")}
						</p>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="topic-grow-type">{t("types.growType")}</Label>
							<Select
								value={growType}
								onValueChange={(value) =>
									handleGrowTypeChange(value as GrowType)
								}
							>
								<SelectTrigger id="topic-grow-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{GROW_TYPES.map((type) => (
										<SelectItem key={type} value={type}>
											{GROW_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="space-y-2">
							<Label htmlFor="topic-recall-type">{t("types.recallType")}</Label>
							<Select
								value={recallType}
								onValueChange={(value) => setRecallType(value as RecallType)}
							>
								<SelectTrigger id="topic-recall-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{validRecallTypes.map((type) => (
										<SelectItem key={type} value={type}>
											{RECALL_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<p className="text-xs text-muted-foreground">
						{t("create.tip")}{" "}
						<kbd className="px-1 py-0.5 bg-muted rounded text-xs">
							{t("create.ctrlEnter")}
						</kbd>{" "}
						{t("create.toCreateQuickly")}
					</p>
				</div>

				<DialogFooter className="px-6 pb-6">
					<Button
						type="button"
						variant="outline"
						onClick={() => modal.hide()}
						disabled={creating}
					>
						{t("create.cancel")}
					</Button>
					<Button
						type="button"
						onClick={handleCreate}
						disabled={!topicName.trim() || !topicDescription.trim() || creating}
					>
						{creating ? (
							<>
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
								{t("create.creating")}
							</>
						) : (
							<>
								<Plus className="h-4 w-4 mr-2" />
								{t("create.createTopic")}
							</>
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
});
