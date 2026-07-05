/**
 * Activity Timeline Page
 * Displays captured user activities in a timeline view
 */

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Activity as ActivityIcon } from "lucide-react";
import { PageHeader } from "@/main/components/ui/page-header";

import { logError } from "@/utils/logger";
import { activityTrackingService } from "@/main/modules/activity-tracking/activity-tracking-service";
import {
	ActivitySessionList,
	ActivitySessionStats,
	ActivityTimeline,
	ActivityDetailModal,
	ActivityChatPanel,
} from "@/main/modules/activity-tracking/components";
import type {
	ActivitySession,
	Activity,
	ActivityType,
	ActivityStats,
} from "@/types/activity-tracking";
import { Button } from "@/main/components/ui/button";

export const ActivityTimelinePage: React.FC = () => {
	const { t } = useTranslation("activity");
	const [sessions, setSessions] = useState<ActivitySession[]>([]);
	const [selectedSession, setSelectedSession] = useState<string | null>(null);
	const [activities, setActivities] = useState<Activity[]>([]);
	const [sessionStats, setSessionStats] = useState<ActivityStats | null>(null);
	const [filterType, setFilterType] = useState<ActivityType | "all">("all");
	const [loading, setLoading] = useState(true);
	const [detailActivity, setDetailActivity] = useState<Activity | null>(null);
	const [isChatOpen, setIsChatOpen] = useState(false);
	const [chatInitialMessage, setChatInitialMessage] = useState<string>("");

	// Load sessions on mount
	useEffect(() => {
		loadSessions();
	}, []);

	// Load activities when session is selected
	useEffect(() => {
		if (selectedSession) {
			loadActivities(selectedSession);
			loadSessionStats(selectedSession);
		}
	}, [selectedSession, filterType]);

	const loadSessions = async () => {
		try {
			setLoading(true);
			const loadedSessions = await activityTrackingService.getSessions();
			setSessions(loadedSessions);

			// Auto-select the most recent session
			if (loadedSessions.length > 0 && !selectedSession) {
				setSelectedSession(loadedSessions[0].id);
			}
		} catch (error) {
			logError("Failed to load sessions:", error);
		} finally {
			setLoading(false);
		}
	};

	const loadActivities = async (sessionId: string) => {
		try {
			const filter: { sessionId: string; types?: ActivityType[] } = {
				sessionId,
			};
			if (filterType !== "all") {
				filter.types = [filterType];
			}

			const loadedActivities =
				await activityTrackingService.getActivities(filter);
			setActivities(loadedActivities);
		} catch (error) {
			logError("Failed to load activities:", error);
		}
	};

	const loadSessionStats = async (sessionId: string) => {
		try {
			const stats = await activityTrackingService.getSessionStats(sessionId);
			setSessionStats(stats);
		} catch (error) {
			logError("Failed to load session stats:", error);
		}
	};

	const handleDeleteSession = async (sessionId: string) => {
		if (!confirm(t("sessions.deleteConfirm"))) {
			return;
		}

		try {
			await activityTrackingService.deleteSession(sessionId);
			await loadSessions();

			if (selectedSession === sessionId) {
				setSelectedSession(null);
				setActivities([]);
				setSessionStats(null);
			}
		} catch (error) {
			logError("Failed to delete session:", error);
		}
	};

	const handleActivityClick = (activity: Activity) => {
		setDetailActivity(activity);
	};

	const handleCloseDetail = () => {
		setDetailActivity(null);
	};

	// Format activity data for AI analysis
	const formatActivityForAI = (activity: Activity): string => {
		const timestamp = new Date(activity.timestamp).toLocaleString();
		const dataStr = JSON.stringify(activity.data, null, 2);

		return `## Activity: ${activity.type}
**Timestamp:** ${timestamp}
\`\`\`json
${dataStr}
\`\`\`
`;
	};

	// Format multiple activities for AI analysis
	const formatActivitiesForAI = (
		activities: Activity[],
		session: ActivitySession,
	): string => {
		const startTime = new Date(session.startTime).toLocaleString();
		const endTime = session.endTime
			? new Date(session.endTime).toLocaleString()
			: "Ongoing";
		const duration = session.endTime
			? `${Math.round((session.endTime - session.startTime) / 1000 / 60)} minutes`
			: "Ongoing";

		let summary = `# Activity Session Analysis

**Start Time:** ${startTime}
**End Time:** ${endTime}
**Duration:** ${duration}
**Total Activities:** ${session.totalActivities}

## Activities (${activities.length} shown):

`;

		activities.forEach((activity, index) => {
			summary += `\n---\n\n${index + 1}. ${formatActivityForAI(activity)}\n`;
		});

		return summary;
	};

	// Open chat panel with activity context
	const handleAnalyzeActivity = (activity: Activity) => {
		const activityContext = formatActivityForAI(activity);
		const message = `Here is my activity in web browser:\n\n${activityContext}\n\n Please help me `;

		setChatInitialMessage(message);
		setIsChatOpen(true);
	};

	// Open chat panel with all activities in session
	const handleAnalyzeSession = async () => {
		if (!selectedSession || !currentSession) return;

		try {
			// Load all activities (not just filtered ones)
			const allActivities = await activityTrackingService.getActivities({
				sessionId: selectedSession,
			});

			// Format session context
			const sessionContext = formatActivitiesForAI(
				allActivities,
				currentSession,
			);
			const message = `Here is my activity in web browser:\n\n${sessionContext}\n\n Please help me `;

			setChatInitialMessage(message);
			setIsChatOpen(true);
		} catch (error) {
			logError("Failed to analyze session with AI:", error);
		}
	};

	const handleCloseChatPanel = () => {
		setIsChatOpen(false);
		setChatInitialMessage("");
	};

	const generateAiExplanation = async (activity: Activity): Promise<string> => {
		// Create a detailed context for the AI
		const activityContext = JSON.stringify(activity.data, null, 2);
		const prompt = `Analyze this user activity and provide a clear, concise explanation in 2-3 sentences about what the user was doing and why this activity was captured:

Activity Type: ${activity.type}
Timestamp: ${new Date(activity.timestamp).toLocaleString()}
Details:
${activityContext}

Provide a natural language explanation that a non-technical user would understand.`;

		let explanation = "";

		// Stream the explanation
		await new Promise<void>((resolve, reject) => {
			// Note: This is a placeholder - the actual implementation should use chatService
			// For now, return a simple message
			explanation =
				"AI explanation generation requires chat service integration.";
			resolve();
		});

		return explanation;
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-muted-foreground">{t("status.loading")}</div>
			</div>
		);
	}

	if (sessions.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-full space-y-4">
				<div className="text-4xl">📊</div>
				<div className="text-xl font-semibold">{t("sessions.noSessions")}</div>
				<div className="text-muted-foreground text-center max-w-md">
					{t("sessions.noSessionsDescription")}
				</div>
			</div>
		);
	}

	const currentSession = sessions.find((s) => s.id === selectedSession);

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<PageHeader
				icon={<ActivityIcon size={18} />}
				title={t("title")}
				description={t("description")}
				actionsPlacement="title"
				actions={
					currentSession && activities.length > 0 ? (
						<Button
							onClick={handleAnalyzeSession}
							variant="default"
							size="sm"
							className="gap-2"
						>
							<Sparkles size={16} />
							{t("analyzeSession")}
						</Button>
					) : undefined
				}
			/>

			<div className="min-h-0 flex-1 overflow-auto p-6">
				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{/* Sessions List */}
					<ActivitySessionList
						sessions={sessions}
						selectedSession={selectedSession}
						onSelectSession={setSelectedSession}
						onDeleteSession={handleDeleteSession}
					/>

					{/* Session Details & Activities */}
					<div className="md:col-span-2 space-y-6">
						{currentSession && sessionStats && (
							<ActivitySessionStats stats={sessionStats} />
						)}

						<ActivityTimeline
							activities={activities}
							filterType={filterType}
							onFilterChange={setFilterType}
							onActivityClick={handleActivityClick}
						/>
					</div>
				</div>
			</div>

			{/* Activity Detail Modal */}
			<ActivityDetailModal
				activity={detailActivity}
				onClose={handleCloseDetail}
				onAnalyzeWithAI={handleAnalyzeActivity}
			/>

			{/* Activity Chat Panel */}
			<ActivityChatPanel
				isOpen={isChatOpen}
				onClose={handleCloseChatPanel}
				initialMessage={chatInitialMessage}
			/>
		</div>
	);
};
