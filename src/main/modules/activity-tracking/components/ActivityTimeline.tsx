/**
 * Activity Timeline Component
 * Vertical timeline showing activities with start/end markers
 */

import React from "react";
import { useTranslation } from "react-i18next";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { PlayCircle, CheckCircle } from "lucide-react";
import type { Activity, ActivityType } from "@/types/activity-tracking";
import { ActivityCard } from "./ActivityCard";
import { formatTimestamp } from "../utils";
import { contentVisibilityAuto } from "@/main/components/atoms/content-visibility";

interface ActivityTimelineProps {
	activities: Activity[];
	filterType: ActivityType | "all";
	onFilterChange: (type: ActivityType | "all") => void;
	onActivityClick: (activity: Activity) => void;
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
	activities,
	filterType,
	onFilterChange,
	onActivityClick,
}) => {
	const { t } = useTranslation("activity");

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{t("timeline.title")}</CardTitle>
					<Select
						value={filterType}
						onValueChange={(value) =>
							onFilterChange(value as ActivityType | "all")
						}
					>
						<SelectTrigger className="w-[180px]">
							<SelectValue placeholder={t("timeline.filterByType")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">{t("timeline.allActivities")}</SelectItem>
							<SelectItem value="page_visit">
								{t("activityTypesPlural.page_visit")}
							</SelectItem>
							<SelectItem value="text_reading">
								{t("activityTypesPlural.text_reading")}
							</SelectItem>
							<SelectItem value="click">
								{t("activityTypesPlural.click")}
							</SelectItem>
							<SelectItem value="user_input">
								{t("activityTypesPlural.user_input")}
							</SelectItem>
							<SelectItem value="scroll">
								{t("activityTypesPlural.scroll")}
							</SelectItem>
							<SelectItem value="navigation">
								{t("activityTypesPlural.navigation")}
							</SelectItem>
							<SelectItem value="form_submit">
								{t("activityTypesPlural.form_submit")}
							</SelectItem>
							<SelectItem value="network_request">
								{t("activityTypesPlural.network_request")}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</CardHeader>
			<CardContent className="p-6">
				<div className="h-[600px] overflow-y-auto">
					<div className="relative pb-12">
						{activities.length > 0 && (
							<>
								{/* Start marker - simple */}
								<div className="relative pl-10 mb-12">
									<div className="absolute left-0 w-[34px] h-[34px] rounded-full flex items-center justify-center z-10 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg border-2 border-background">
										<PlayCircle size={16} strokeWidth={2.5} />
									</div>
									<div className="flex items-center gap-2 h-[34px]">
										<span className="text-sm font-semibold text-primary">
											{t("timeline.start")}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatTimestamp(
												activities[activities.length - 1]?.timestamp,
											)}
										</span>
									</div>
								</div>

								{/* Timeline line - starts from start icon center, ends at end icon center */}
								<div
									className="absolute left-[17px] w-0.5 bg-gradient-to-b from-primary via-border to-green-500"
									style={{
										top: "17px",
										bottom: "calc(48px + 17px)",
									}}
								/>
							</>
						)}

						{/* Timeline items */}
						<div className="space-y-5">
							{activities.map((activity) => (
								<div key={activity.id} style={contentVisibilityAuto(88)}>
									<ActivityCard activity={activity} onClick={onActivityClick} />
								</div>
							))}

							{activities.length === 0 && (
								<div className="text-center text-muted-foreground py-12">
									<div className="text-4xl mb-2">🔍</div>
									<div className="text-lg font-medium">
										{t("timeline.noActivities")}
									</div>
									<div className="text-sm">
										{t("timeline.noActivitiesDescription")}
									</div>
								</div>
							)}
						</div>

						{activities.length > 0 && (
							<>
								{/* End marker - simple */}
								<div className="relative pl-10 mt-12">
									<div className="absolute left-0 w-[34px] h-[34px] rounded-full flex items-center justify-center z-10 bg-gradient-to-br from-green-600 to-green-500 text-white shadow-lg border-2 border-background">
										<CheckCircle size={16} strokeWidth={2.5} />
									</div>
									<div className="flex items-center gap-2 h-[34px]">
										<span className="text-sm font-semibold text-green-700 dark:text-green-400">
											{t("timeline.end")}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatTimestamp(activities[0]?.timestamp)}
										</span>
									</div>
								</div>
							</>
						)}
					</div>
				</div>
			</CardContent>
		</Card>
	);
};
