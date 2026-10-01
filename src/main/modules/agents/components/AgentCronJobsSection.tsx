import React from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { Switch } from "@/main/components/ui/switch";
import { Textarea } from "@/main/components/ui/textarea";
import { Badge } from "@/main/components/ui/badge";
import {
	buildDailyCronExpression,
	buildWeeklyCronExpression,
	getNextCronRunAt,
	validateCronExpression,
} from "@/services/cron-jobs";
import type { CronJobStatus } from "@/services/database/types";
import type { AgentCronJobDraft } from "../hooks/use-agent-cron-jobs";
import { cn } from "@/lib/utils";

type ScheduleMode = "daily" | "weekly" | "raw";

interface AgentCronJobsSectionProps {
	agentStatus: "active" | "draft";
	drafts: AgentCronJobDraft[];
	isLoading: boolean;
	isSaving: boolean;
	error: string | null;
	onAdd: (status: CronJobStatus) => void;
	onUpdate: (id: string, updates: Partial<AgentCronJobDraft>) => void;
	onRemove: (id: string) => void;
}

const DAYS = [
	{ value: "1", label: "Monday" },
	{ value: "2", label: "Tuesday" },
	{ value: "3", label: "Wednesday" },
	{ value: "4", label: "Thursday" },
	{ value: "5", label: "Friday" },
	{ value: "6", label: "Saturday" },
	{ value: "0", label: "Sunday" },
];

const getMode = (draft: AgentCronJobDraft): ScheduleMode =>
	draft.metadata?.scheduleMode === "weekly" ||
	draft.metadata?.scheduleMode === "raw"
		? draft.metadata.scheduleMode
		: "daily";

const getTime = (draft: AgentCronJobDraft): string =>
	typeof draft.metadata?.time === "string" ? draft.metadata.time : "09:00";

const getDayOfWeek = (draft: AgentCronJobDraft): number =>
	typeof draft.metadata?.dayOfWeek === "number" ? draft.metadata.dayOfWeek : 1;

const getValidationText = (draft: AgentCronJobDraft): string => {
	const validation = validateCronExpression(draft.scheduleExpression);
	if (!validation.valid) return validation.error ?? "Invalid cron expression";
	if (!draft.prompt.trim()) return "Prompt is required";
	try {
		return `Next: ${getNextCronRunAt(draft.scheduleExpression).toLocaleString()}`;
	} catch (error) {
		return error instanceof Error ? error.message : "Invalid schedule";
	}
};

const getNextRunLabel = (draft: AgentCronJobDraft): string => {
	const validation = validateCronExpression(draft.scheduleExpression);
	if (!validation.valid || !draft.prompt.trim()) return "Needs setup";
	try {
		return getNextCronRunAt(draft.scheduleExpression).toLocaleDateString();
	} catch {
		return "Needs setup";
	}
};

/** One schedule's form; also used by the MemonOS Scheduler window. */
export const ScheduleEditor: React.FC<{
	agentStatus: "active" | "draft";
	draft: AgentCronJobDraft;
	onUpdate: (updates: Partial<AgentCronJobDraft>) => void;
	onRemove: () => void;
}> = ({ agentStatus, draft, onUpdate, onRemove }) => {
	const mode = getMode(draft);
	const validation = validateCronExpression(draft.scheduleExpression);
	const isRunnable = agentStatus === "active" && draft.status === "active";

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<Input
					value={draft.name}
					onChange={(event) => onUpdate({ name: event.target.value })}
					className="h-9 text-sm"
					placeholder="Schedule name"
				/>
				<div className="flex shrink-0 items-center gap-2">
					<Switch
						checked={draft.status === "active"}
						onCheckedChange={(checked) =>
							onUpdate({ status: checked ? "active" : "paused" })
						}
						disabled={agentStatus === "draft"}
					/>
					<Badge
						variant={isRunnable ? "default" : "outline"}
						className="w-16 justify-center text-[10px]"
					>
						{agentStatus === "draft" ? "draft" : draft.status}
					</Badge>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-destructive"
						onClick={onRemove}
					>
						<Trash2 size={13} />
					</Button>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
					Prompt
				</Label>
				<Textarea
					value={draft.prompt}
					onChange={(event) => onUpdate({ prompt: event.target.value })}
					rows={4}
					placeholder="Prompt to send to this agent"
					className="text-xs"
				/>
			</div>

			<div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
				<Select
					value={mode}
					onValueChange={(value) => {
						const nextMode = value as ScheduleMode;
						const time = getTime(draft);
						const dayOfWeek = getDayOfWeek(draft);
						const scheduleExpression =
							nextMode === "weekly"
								? buildWeeklyCronExpression(time, dayOfWeek)
								: nextMode === "daily"
									? buildDailyCronExpression(time)
									: draft.scheduleExpression;
						onUpdate({
							scheduleExpression,
							metadata: { scheduleMode: nextMode },
						});
					}}
				>
					<SelectTrigger className="h-9 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="daily">Daily</SelectItem>
						<SelectItem value="weekly">Weekly</SelectItem>
						<SelectItem value="raw">Cron</SelectItem>
					</SelectContent>
				</Select>

				{mode === "raw" ? (
					<Input
						value={draft.scheduleExpression}
						onChange={(event) =>
							onUpdate({ scheduleExpression: event.target.value })
						}
						className="h-9 font-mono text-xs sm:col-span-2"
						placeholder="0 9 * * *"
					/>
				) : (
					<>
						<Input
							type="time"
							value={getTime(draft)}
							onChange={(event) => {
								const time = event.target.value;
								const dayOfWeek = getDayOfWeek(draft);
								onUpdate({
									scheduleExpression:
										mode === "weekly"
											? buildWeeklyCronExpression(time, dayOfWeek)
											: buildDailyCronExpression(time),
									metadata: { time },
								});
							}}
							className="h-9 text-xs"
						/>
						{mode === "weekly" ? (
							<Select
								value={String(getDayOfWeek(draft))}
								onValueChange={(value) => {
									const dayOfWeek = Number(value);
									onUpdate({
										scheduleExpression: buildWeeklyCronExpression(
											getTime(draft),
											dayOfWeek,
										),
										metadata: { dayOfWeek },
									});
								}}
							>
								<SelectTrigger className="h-9 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DAYS.map((day) => (
										<SelectItem key={day.value} value={day.value}>
											{day.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Input
								value={draft.scheduleExpression}
								readOnly
								className="h-9 font-mono text-xs text-muted-foreground"
							/>
						)}
					</>
				)}
			</div>

			<div
				className={cn(
					"text-[11px]",
					validation.valid && draft.prompt.trim()
						? "text-muted-foreground"
						: "text-destructive",
				)}
			>
				{getValidationText(draft)}
			</div>
		</div>
	);
};

export const AgentCronJobsSection: React.FC<AgentCronJobsSectionProps> = ({
	agentStatus,
	drafts,
	isLoading,
	isSaving,
	error,
	onAdd,
	onUpdate,
	onRemove,
}) => {
	const [manageOpen, setManageOpen] = React.useState(false);
	const [selectedId, setSelectedId] = React.useState<string | null>(null);
	const addStatus: CronJobStatus =
		agentStatus === "active" ? "active" : "draft";
	const selectedDraft =
		drafts.find((draft) => draft.id === selectedId) ?? drafts[0] ?? null;

	React.useEffect(() => {
		if (selectedId && !drafts.some((draft) => draft.id === selectedId)) {
			setSelectedId(drafts[0]?.id ?? null);
		}
	}, [drafts, selectedId]);

	const openManage = (id?: string) => {
		if (id) setSelectedId(id);
		setManageOpen(true);
	};

	const handleAdd = () => {
		onAdd(addStatus);
		setManageOpen(true);
	};

	return (
		<>
			<div className="flex min-h-[32px] items-center gap-3">
				<span className="w-20 shrink-0 text-sm text-muted-foreground">
					Schedules
				</span>
				<div className="flex flex-wrap items-center gap-1.5">
					{isLoading ? (
						<span className="text-[11px] text-muted-foreground/50">...</span>
					) : drafts.length === 0 ? (
						<span className="text-[11px] text-muted-foreground">
							No scheduled prompts
						</span>
					) : (
						<>
							{drafts.slice(0, 4).map((draft) => (
								<button
									key={draft.id}
									type="button"
									onClick={() => openManage(draft.id)}
									className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
								>
									<CalendarClock size={10} className="text-muted-foreground" />
									<span className="max-w-[10rem] truncate">{draft.name}</span>
									<span className="text-[10px] text-muted-foreground">
										{getNextRunLabel(draft)}
									</span>
								</button>
							))}
							{drafts.length > 4 ? (
								<span className="rounded-lg border border-dashed border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
									+{drafts.length - 4}
								</span>
							) : null}
						</>
					)}
					<button
						type="button"
						onClick={() => openManage()}
						disabled={isLoading || isSaving}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
					>
						<CalendarClock size={12} />
						Manage
					</button>
				</div>
			</div>

			<Dialog open={manageOpen} onOpenChange={setManageOpen}>
				<DialogContent className="flex max-h-[min(88dvh,820px)] w-[calc(100vw-1rem)] max-w-[820px] flex-col gap-0 overflow-hidden p-0 sm:w-[min(94vw,820px)]">
					<DialogHeader className="border-b px-5 pb-4 pt-5">
						<DialogTitle>Schedules</DialogTitle>
					</DialogHeader>

					<div className="grid min-h-0 flex-1 gap-0 overflow-hidden sm:grid-cols-[240px_1fr]">
						<div className="border-b p-4 sm:border-b-0 sm:border-r">
							<div className="mb-3 flex items-center justify-between gap-2">
								<Badge variant="secondary" className="text-[10px]">
									{drafts.length} total
								</Badge>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="h-7 px-2 text-[11px]"
									onClick={handleAdd}
									disabled={isLoading || isSaving}
								>
									<Plus size={11} className="mr-1" />
									Add
								</Button>
							</div>

							{error ? (
								<div className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
									{error}
								</div>
							) : null}

							{drafts.length === 0 ? (
								<div className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
									No scheduled prompts.
								</div>
							) : (
								<div className="space-y-1.5">
									{drafts.map((draft) => (
										<button
											key={draft.id}
											type="button"
											onClick={() => setSelectedId(draft.id)}
											className={cn(
												"w-full rounded-lg px-3 py-2 text-left transition-colors",
												selectedDraft?.id === draft.id
													? "bg-muted text-foreground"
													: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
											)}
										>
											<span className="block truncate text-xs font-medium">
												{draft.name}
											</span>
											<span className="block truncate font-mono text-[10px]">
												{draft.scheduleExpression}
											</span>
										</button>
									))}
								</div>
							)}
						</div>

						<div className="min-h-0 overflow-y-auto p-5">
							{selectedDraft ? (
								<ScheduleEditor
									agentStatus={agentStatus}
									draft={selectedDraft}
									onUpdate={(updates) => onUpdate(selectedDraft.id, updates)}
									onRemove={() => onRemove(selectedDraft.id)}
								/>
							) : (
								<div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
									Select or add a schedule.
								</div>
							)}
						</div>
					</div>

					<DialogFooter className="border-t px-5 py-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => setManageOpen(false)}
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
};
