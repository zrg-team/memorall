import React from "react";
import { useTranslation } from "react-i18next";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	skillFileSystemService,
	validateSkillName,
	type SkillImportCandidate,
} from "@/services/filesystem/skill-filesystem";

const SKILL_TEMPLATE = `# {{name}}

Describe what the agent should do, step by step.

## Steps

1.
2.
`;

interface LaneShellProps {
	title: string;
	subtitle: string;
	onBack: () => void;
	children: React.ReactNode;
}

const LaneShell: React.FC<LaneShellProps> = ({
	title,
	subtitle,
	onBack,
	children,
}) => {
	const { t } = useTranslation("common");
	return (
		<div className="min-h-0 flex-1 overflow-y-auto p-4">
			<div className="mx-auto max-w-xl">
				<div className="mb-4 flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={onBack}
						aria-label={t("buttons.back")}
					>
						<ArrowLeft size={14} />
					</Button>
					<div>
						<h2 className="text-sm font-semibold">{title}</h2>
						<p className="text-[11px] text-muted-foreground">{subtitle}</p>
					</div>
				</div>
				{children}
			</div>
		</div>
	);
};

// ---------------------------------------------------------------------------

interface CreateSkillFormProps {
	onBack: () => void;
	onCreated: (name: string) => Promise<void> | void;
}

/** The "Write" lane — name + description, then straight into the editor. */
export const CreateSkillForm: React.FC<CreateSkillFormProps> = ({
	onBack,
	onCreated,
}) => {
	const { t } = useTranslation(["skills", "common"]);
	const [name, setName] = React.useState("");
	const [description, setDescription] = React.useState("");
	const [error, setError] = React.useState<string | null>(null);
	const [saving, setSaving] = React.useState(false);

	const handleCreate = async () => {
		const trimmed = name.trim().toLowerCase();
		const validation = validateSkillName(trimmed);
		if (!validation.valid) {
			setError(validation.reason ?? t("lanes.manual.invalidName"));
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await skillFileSystemService.writeSkill(
				trimmed,
				description.trim(),
				SKILL_TEMPLATE.replace("{{name}}", trimmed),
			);
			await onCreated(trimmed);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("lanes.manual.failed"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<LaneShell
			title={t("lanes.manual.title")}
			subtitle={t("lanes.manual.subtitle")}
			onBack={onBack}
		>
			<div className="space-y-4">
				<div className="space-y-1.5">
					<Label className="text-xs">{t("lanes.manual.nameLabel")}</Label>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder={t("lanes.manual.namePlaceholder")}
						className="h-8 font-mono text-sm"
					/>
					<p className="text-[11px] text-muted-foreground">
						{t("lanes.manual.nameHint")}
					</p>
				</div>
				<div className="space-y-1.5">
					<Label className="text-xs">
						{t("lanes.manual.descriptionLabel")}
					</Label>
					<Input
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder={t("lanes.manual.descriptionPlaceholder")}
						className="h-8 text-sm"
					/>
					<p className="text-[11px] text-muted-foreground">
						{t("lanes.manual.descriptionHint")}
					</p>
				</div>
				{error ? <p className="text-xs text-destructive">{error}</p> : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="sm" onClick={onBack}>
						{t("buttons.cancel", { ns: "common" })}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={saving || !name.trim()}
						onClick={() => void handleCreate()}
					>
						{saving ? (
							<Loader2 size={12} className="mr-1.5 animate-spin" />
						) : null}
						{t("lanes.manual.action")}
					</Button>
				</div>
			</div>
		</LaneShell>
	);
};

// ---------------------------------------------------------------------------

interface GithubImportFormProps {
	onBack: () => void;
	onPlanned: (candidates: SkillImportCandidate[]) => void;
}

/** The "GitHub" lane — accepts a single file URL or a folder (tree) URL. */
export const GithubImportForm: React.FC<GithubImportFormProps> = ({
	onBack,
	onPlanned,
}) => {
	const { t } = useTranslation(["skills", "common"]);
	const [url, setUrl] = React.useState("");
	const [error, setError] = React.useState<string | null>(null);
	const [loading, setLoading] = React.useState(false);

	const handleImport = async () => {
		const trimmed = url.trim();
		if (!trimmed) return;
		setLoading(true);
		setError(null);
		try {
			onPlanned(await skillFileSystemService.planGithubImport(trimmed));
		} catch (err) {
			setError(err instanceof Error ? err.message : t("lanes.github.failed"));
		} finally {
			setLoading(false);
		}
	};

	return (
		<LaneShell
			title={t("lanes.github.title")}
			subtitle={t("lanes.github.subtitle")}
			onBack={onBack}
		>
			<div className="space-y-4">
				<div className="space-y-1.5">
					<Label className="flex items-center gap-1.5 text-xs">
						<Github size={12} />
						{t("lanes.github.urlLabel")}
					</Label>
					<Input
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder={t("lanes.github.urlPlaceholder")}
						className="h-8 font-mono text-sm"
					/>
					<p className="text-[11px] leading-relaxed text-muted-foreground">
						{t("lanes.github.urlHint")}
					</p>
				</div>
				{error ? <p className="text-xs text-destructive">{error}</p> : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" size="sm" onClick={onBack}>
						{t("buttons.cancel", { ns: "common" })}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={loading || !url.trim()}
						onClick={() => void handleImport()}
					>
						{loading ? (
							<Loader2 size={12} className="mr-1.5 animate-spin" />
						) : null}
						{t("buttons.import", { ns: "common" })}
					</Button>
				</div>
			</div>
		</LaneShell>
	);
};
