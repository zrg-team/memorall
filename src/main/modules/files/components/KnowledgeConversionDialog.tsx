import React, { useEffect, useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { useTranslation } from "react-i18next";
import { Loader2, Tags } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Label } from "@/main/components/ui/label";
import { Badge } from "@/main/components/ui/badge";
import { cn } from "@/lib/utils";
import { topicService } from "@/main/modules/topics/services/topic-service";
import { serviceManager } from "@/services";
import type { Topic } from "@/services/database/types";
import type { KnowledgeGrowMode } from "@/main/modules/knowledge/services/knowledge-graph-service";
import type { GrowType } from "@/services/database/entities/topic-types";
import { logError } from "@/utils/logger";

interface KnowledgeConversionDialogProps {
	fileName: string;
}

export interface KnowledgeConversionSelection {
	topicId?: string;
	growMode: KnowledgeGrowMode;
}

const growTypeToMode = (growType: GrowType): KnowledgeGrowMode =>
	growType === "structmem" ? "structmem" : "knowledge";

export const KnowledgeConversionDialog =
	NiceModal.create<KnowledgeConversionDialogProps>(({ fileName }) => {
		const modal = useModal();
		const { t } = useTranslation("documents");
		const [loading, setLoading] = useState(false);
		const [topics, setTopics] = useState<Topic[]>([]);
		const [agentNamesById, setAgentNamesById] = useState<
			Record<string, string>
		>({});
		const [selectedTopicId, setSelectedTopicId] = useState<string | undefined>(
			undefined,
		);

		useEffect(() => {
			if (!modal.visible) return;
			const loadTopics = async () => {
				try {
					setLoading(true);
					const [allTopics, flows] = await Promise.all([
						topicService.getTopics(),
						serviceManager.flowBuilderService.listPredefinedFlows("foundation"),
					]);
					setTopics(Array.isArray(allTopics) ? allTopics : []);
					setAgentNamesById(
						Object.fromEntries(flows.map((flow) => [flow.id, flow.name])),
					);
				} catch (error) {
					logError("Failed to load topics:", error);
					setTopics([]);
					setAgentNamesById({});
				} finally {
					setLoading(false);
				}
			};
			void loadTopics();
		}, [modal.visible]);

		const handleSelect = () => {
			const selectedTopic = topics.find(
				(topic) => topic.id === selectedTopicId,
			);
			modal.resolve({
				topicId: selectedTopicId,
				growMode: selectedTopic
					? growTypeToMode(selectedTopic.growType)
					: "knowledge",
			} satisfies KnowledgeConversionSelection);
			modal.hide();
		};

		const handleCancel = () => {
			modal.resolve(null);
			modal.hide();
		};

		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => !open && handleCancel()}
			>
				<DialogContent className="sm:max-w-[440px] max-h-[88vh] flex flex-col gap-0 p-0">
					<DialogHeader className="px-6 pt-6">
						<DialogTitle className="flex items-center gap-2">
							<Tags className="h-5 w-5 text-primary" />
							{t("knowledgeConversionDialog.title")}
						</DialogTitle>
						<DialogDescription>
							{t("knowledgeConversionDialog.description", { fileName })}
						</DialogDescription>
					</DialogHeader>

					<div className="flex-1 overflow-y-auto px-6 py-4 min-h-0 space-y-4">
						<div className="space-y-2">
							<Label className="text-xs font-medium">
								{t("knowledgeConversionDialog.memoryLabel")}
							</Label>
							{loading ? (
								<div className="flex items-center justify-center rounded-md border py-8">
									<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
								</div>
							) : (
								<div className="border rounded-md max-h-[300px] overflow-y-auto">
									<div className="p-2 space-y-1">
										<button
											type="button"
											onClick={() => setSelectedTopicId(undefined)}
											className={cn(
												"w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
												"hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
												selectedTopicId === undefined && "bg-muted",
											)}
										>
											<div
												className={cn(
													"h-4 w-4 border rounded-full flex items-center justify-center flex-shrink-0",
													selectedTopicId === undefined
														? "bg-primary border-primary"
														: "border-input",
												)}
											>
												{selectedTopicId === undefined && (
													<div className="h-2 w-2 bg-primary-foreground rounded-full" />
												)}
											</div>
											<div>
												<div className="font-medium">
													{t("knowledgeConversionDialog.defaultOption")}
												</div>
												<div className="text-sm text-muted-foreground">
													{t("knowledgeConversionDialog.noMemoryAssociation")}
												</div>
												<Badge variant="outline" className="mt-2 text-[10px]">
													{t(
														"knowledgeConversionDialog.growTypes.knowledge-graph",
													)}
												</Badge>
											</div>
										</button>

										{topics.length === 0 ? (
											<div className="py-8 text-center text-sm text-muted-foreground">
												{t("knowledgeConversionDialog.noMemoriesAvailable")}
											</div>
										) : (
											topics.map((topic) => (
												<button
													key={topic.id}
													type="button"
													onClick={() => setSelectedTopicId(topic.id)}
													className={cn(
														"w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left",
														"hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
														selectedTopicId === topic.id && "bg-muted",
													)}
												>
													<div
														className={cn(
															"h-4 w-4 border rounded-full flex items-center justify-center flex-shrink-0",
															selectedTopicId === topic.id
																? "bg-primary border-primary"
																: "border-input",
														)}
													>
														{selectedTopicId === topic.id && (
															<div className="h-2 w-2 bg-primary-foreground rounded-full" />
														)}
													</div>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2">
															<div className="font-medium truncate">
																{topic.name}
															</div>
															<Badge
																variant="outline"
																className="shrink-0 text-[10px]"
															>
																{t(
																	`knowledgeConversionDialog.growTypes.${topic.growType}`,
																)}
															</Badge>
														</div>
														{topic.description && (
															<div className="text-sm text-muted-foreground line-clamp-1">
																{topic.description}
															</div>
														)}
														{topic.agentId && agentNamesById[topic.agentId] && (
															<div className="text-xs text-muted-foreground mt-1">
																{t("knowledgeConversionDialog.agent", {
																	name: agentNamesById[topic.agentId],
																})}
															</div>
														)}
													</div>
												</button>
											))
										)}
									</div>
								</div>
							)}
						</div>
					</div>

					<DialogFooter className="px-6 pb-6">
						<Button variant="outline" onClick={handleCancel}>
							{t("knowledgeConversionDialog.cancel")}
						</Button>
						<Button onClick={handleSelect}>
							{t("knowledgeConversionDialog.convert")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	});
