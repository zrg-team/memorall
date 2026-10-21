import { Loader2 } from "lucide-react";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { transcriptLanguage } from "@/services/tab-transcription/languages";
import type { TranscriptParagraph } from "@/services/tab-transcription/paragraphs";

export function ParagraphTranslation({
	paragraph,
	language,
}: {
	paragraph: TranscriptParagraph;
	language: string;
}) {
	const t = useEmbeddedTranslation("transcription");
	const parts = paragraph.parts.map(({ chunk }) => ({
		chunk,
		translation: chunk.translations?.[language],
	}));
	const visible = parts.filter((part) => part.translation?.text);
	const waiting = parts.some(
		(part) =>
			part.chunk.text &&
			part.chunk.status === "done" &&
			(!part.translation || part.translation.status === "pending"),
	);
	const failed = parts.some((part) => part.translation?.status === "failed");
	const separator = language.startsWith("zh") || language === "ja" ? "" : " ";
	return (
		<div
			className="mt-translation"
			lang={language}
			dir="auto"
			aria-label={t("translatedContent", {
				language: transcriptLanguage(language)?.name || language,
			})}
		>
			{visible.length ? (
				<p className="mt-text">
					{visible.map(({ chunk, translation }, index) => (
						<span key={chunk.id}>
							{index ? separator : ""}
							<span
								className={
									translation?.status === "pending" ? "mt-partial" : undefined
								}
							>
								{translation?.text}
								{translation?.status === "pending" ? (
									<span className="mt-caret" aria-hidden="true" />
								) : null}
							</span>
						</span>
					))}
				</p>
			) : null}
			{waiting &&
			!visible.some((part) => part.translation?.status === "pending") ? (
				<span className="mt-pending">
					<Loader2 className="animate-spin" size={12} />
					{t("translating")}
				</span>
			) : failed ? (
				<span className="mt-pending">{t("translationUnavailable")}</span>
			) : null}
		</div>
	);
}
