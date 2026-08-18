import { useEffect } from "react";
import {
	useGetFieldValue,
	useIsStreaming,
	useSetFieldValue,
} from "@openuidev/react-lang";
import { OPENUI_FORM_FIELD_METADATA_KEY } from "@/main/modules/openui/actions";

/**
 * Field metadata registration, shared by every theme.
 *
 * A submission carries values keyed by field name; the labels the reader saw live
 * here so an action can render "Language: python" rather than "lang: python".
 * The logic was identical in all three themes — only `fieldId` genuinely differs
 * between them, because the DOM ids are theme-scoped — so it lives in one place
 * now and CodeEditorBlock, which is shared, can register itself the same way.
 */

type FieldMetadata = { label: string; options?: Record<string, string> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const sameOptions = (
	left: Record<string, string> | undefined,
	right: Record<string, string> | undefined,
) => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

export const useRegisterFieldMetadata = ({
	formName,
	name,
	label,
	options,
}: {
	formName: string | undefined;
	name: string;
	label: string;
	options?: Record<string, string>;
}) => {
	const isStreaming = useIsStreaming();
	const getFieldValue = useGetFieldValue();
	const setFieldValue = useSetFieldValue();
	const metadataValue = getFieldValue(formName, OPENUI_FORM_FIELD_METADATA_KEY);

	useEffect(() => {
		if (isStreaming) return;
		// A component that is not acting as a field has nothing to register, and
		// writing an empty key would put a phantom entry in the submission.
		if (!name) return;
		const current = isRecord(metadataValue)
			? (metadataValue as Record<string, FieldMetadata>)
			: {};
		const nextFieldMetadata: FieldMetadata = options
			? { label, options }
			: { label };
		const currentFieldMetadata = current[name];
		if (
			currentFieldMetadata?.label === nextFieldMetadata.label &&
			sameOptions(currentFieldMetadata.options, nextFieldMetadata.options)
		) {
			return;
		}

		setFieldValue(
			formName,
			"MemorallFormMetadata",
			OPENUI_FORM_FIELD_METADATA_KEY,
			{ ...current, [name]: nextFieldMetadata },
			false,
		);
	}, [
		formName,
		isStreaming,
		label,
		metadataValue,
		name,
		options,
		setFieldValue,
	]);
};
