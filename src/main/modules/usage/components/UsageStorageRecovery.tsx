import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	clearDamagedUsageFields,
	inspectUsageStorage,
	rebuildUsageStorageIndex,
	type DamagedUsageField,
	type RecoveryQuery,
} from "@/services/database/usage-storage-recovery";
import { rootErrorMessage } from "@/utils/error-message";

const query: RecoveryQuery = async (statement, params) => {
	const { serviceManager } = await import("@/services");
	return serviceManager.databaseService.use(
		async ({ raw }) =>
			(await raw(statement, params)) as Awaited<ReturnType<RecoveryQuery>>,
	);
};

export const UsageStorageRecovery: React.FC<{
	error: string;
	onRecovered: () => void;
}> = ({ error, onRecovered }) => {
	const { t } = useTranslation("usage");
	const [fields, setFields] = React.useState<DamagedUsageField[] | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [failure, setFailure] = React.useState<string | null>(null);
	const [message, setMessage] = React.useState<string | null>(null);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setFailure(null);
		setMessage(null);
		try {
			await action();
		} catch (error) {
			setFailure(rootErrorMessage(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="mx-4 mt-3 space-y-3 rounded-xl border p-3 text-xs"
			aria-busy={busy}
		>
			<p>{t("recovery.description")}</p>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						void run(async () => {
							await rebuildUsageStorageIndex(query, error);
							setFields(null);
							setMessage(t("recovery.indexRebuilt"));
							onRecovered();
						})
					}
				>
					{t("recovery.rebuildIndex")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const damaged = await inspectUsageStorage(query, error);
							setFields(damaged);
							if (!damaged.length) setMessage(t("recovery.noneFound"));
						})
					}
				>
					{busy ? t("recovery.working") : t("recovery.inspect")}
				</Button>
			</div>
			{fields?.length ? (
				<>
					<p>{t("recovery.lossWarning", { count: fields.length })}</p>
					<ul className="max-h-48 overflow-y-auto font-mono">
						{fields.map((field) => (
							<li key={`${field.table}:${field.id}:${field.column}`}>
								{field.table}.{field.column} · {field.id}
								<details>
									<summary>{t("recovery.storageError")}</summary>
									{field.error}
								</details>
							</li>
						))}
					</ul>
					<Button
						size="sm"
						variant="destructive"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								const count = await clearDamagedUsageFields(query, fields);
								setFields(null);
								setMessage(t("recovery.cleared", { count }));
								onRecovered();
							})
						}
					>
						{t("recovery.clear", { count: fields.length })}
					</Button>
				</>
			) : null}
			{failure ? (
				<p role="alert" className="text-destructive">
					{failure}
				</p>
			) : null}
			{message ? <p role="status">{message}</p> : null}
		</div>
	);
};
