/**
 * EditTopicDialog Modal
 * Dialog for editing an existing topic using nice-modal
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { Edit2, Loader2 } from "lucide-react";
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

interface EditTopicDialogProps {
	topic: Topic;
}

export const EditTopicDialog = NiceModal.create<EditTopicDialogProps>(
	({ topic }) => {
		const modal = useModal();
		const { t } = useTranslation("topics");
		const [topicName, setTopicName] = useState("");
		const [topicDescription, setTopicDescription] = useState("");
		const [recallType, setRecallType] = useState<RecallType>(topic.recallType);
		const [updating, setUpdating] = useState(false);

		// Load topic data when dialog opens or topic changes
		useEffect(() => {
			if (modal.visible && topic) {
				setTopicName(topic.name);
				setTopicDescription(topic.description || "");
				setRecallType(topic.recallType);
			}
		}, [modal.visible, topic]);

		const validRecallTypes = getValidRecallTypes(topic.growType);

		const handleUpdate = async () => {
			if (!topic || !topicName.trim() || !topicDescription.trim()) return;

			try {
				setUpdating(true);
				const updatedTopic = await topicService.updateTopic(topic.id, {
					name: topicName.trim(),
					description: topicDescription.trim(),
					recallType,
				});

				logInfo("[EDIT_TOPIC_DIALOG] Updated topic:", updatedTopic);

				// Resolve with the updated topic
				modal.resolve(updatedTopic);
				modal.hide();
			} catch (error) {
				logError("[EDIT_TOPIC_DIALOG] Failed to update topic:", error);
			} finally {
				setUpdating(false);
			}
		};

		const handleKeyDown = (e: React.KeyboardEvent) => {
			// Submit on Ctrl+Enter or Cmd+Enter
			if (
				(e.ctrlKey || e.metaKey) &&
				e.key === "Enter" &&
				topicName.trim() &&
				topicDescription.trim()
			) {
				handleUpdate();
			}
		};

		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => !open && modal.hide()}
			>
				<DialogContent className="sm:max-w-[480px] max-h-[85vh] flex flex-col gap-0 p-0">
					<DialogHeader className="px-6 pt-6">
						<DialogTitle className="flex items-center gap-2">
							<Edit2 className="h-5 w-5 text-primary" />
							{t("edit.title")}
						</DialogTitle>
						<DialogDescription>{t("edit.description")}</DialogDescription>
					</DialogHeader>

					<div
						className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0"
						onKeyDown={handleKeyDown}
					>
						<div className="space-y-2">
							<Label htmlFor="edit-topic-name">{t("edit.topicName")} *</Label>
							<Input
								id="edit-topic-name"
								placeholder={t("edit.namePlaceholder")}
								value={topicName}
								onChange={(e) => setTopicName(e.target.value)}
								autoFocus
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="edit-topic-description">
								{t("edit.goalPurpose")} *
							</Label>
							<Textarea
								id="edit-topic-description"
								placeholder={t("edit.descriptionPlaceholder")}
								value={topicDescription}
								onChange={(e) => setTopicDescription(e.target.value)}
								rows={3}
							/>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="edit-topic-grow-type">
									{t("types.growType")}
								</Label>
								<Input
									id="edit-topic-grow-type"
									value={GROW_LABELS[topic.growType]}
									readOnly
									className="bg-muted text-muted-foreground"
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="edit-topic-recall-type">
									{t("types.recallType")}
								</Label>
								<Select
									value={recallType}
									onValueChange={(value) => setRecallType(value as RecallType)}
								>
									<SelectTrigger id="edit-topic-recall-type">
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
							{t("edit.tip")}{" "}
							<kbd className="px-1 py-0.5 bg-muted rounded text-xs">
								{t("edit.ctrlEnter")}
							</kbd>{" "}
							{t("edit.toSaveQuickly")}
						</p>
					</div>

					<DialogFooter className="px-6 pb-6">
						<Button
							variant="outline"
							onClick={() => modal.hide()}
							disabled={updating}
						>
							{t("edit.cancel")}
						</Button>
						<Button
							onClick={handleUpdate}
							disabled={
								!topicName.trim() || !topicDescription.trim() || updating
							}
						>
							{updating ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									{t("edit.saving")}
								</>
							) : (
								<>
									<Edit2 className="h-4 w-4 mr-2" />
									{t("edit.saveChanges")}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	},
);
