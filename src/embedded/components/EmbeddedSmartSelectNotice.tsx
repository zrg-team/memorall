import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";

interface EmbeddedSmartSelectNoticeProps {
	onCancel: () => void;
	/** Which picker is running; defaults to smart select. */
	title?: string;
	instruction?: string;
}

export const EmbeddedSmartSelectNotice = ({
	onCancel,
	title,
	instruction,
}: EmbeddedSmartSelectNoticeProps) => {
	const t = useEmbeddedTranslation("contextSection");
	return (
		<div className="memorall-smart-select-notice">
			<div className="memorall-smart-select-notice-card">
				<div className="memorall-smart-select-notice-title">
					{title ?? t("smartSelect")}
				</div>
				<p className="memorall-smart-select-notice-text">
					{instruction ?? t("smartSelectInstruction")}
				</p>
				<button
					type="button"
					className="memorall-smart-select-cancel-button"
					onClick={onCancel}
				>
					{t("smartSelectCancel")}
				</button>
			</div>
		</div>
	);
};
