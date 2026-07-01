export type KeyedAssistantPart<T> = {
	part: T;
	index: number;
	key: string;
};

export function assignAssistantPartKeys<
	T extends { type: string; id?: string },
>(parts: readonly T[]): KeyedAssistantPart<T>[] {
	let textPartCount = 0;

	return parts.map((part, index) => {
		if (part.type === "text") {
			const key = `text-${textPartCount}`;
			textPartCount += 1;
			return { part, index, key };
		}

		if (part.type === "execution") {
			return { part, index, key: `workflow-${part.id ?? index}` };
		}

		return {
			part,
			index,
			key: `${part.type}-${part.id ?? index}-${index}`,
		};
	});
}

export type KeyedContentSegment<T> = {
	segment: T;
	index: number;
	key: string;
};

export function assignContentSegmentKeys<T extends { kind: string }>(
	segments: readonly T[],
): KeyedContentSegment<T>[] {
	let openuiCount = 0;
	let textCount = 0;

	return segments.map((segment, index) => {
		if (segment.kind === "openui") {
			const key = `openui-${openuiCount}`;
			openuiCount += 1;
			return { segment, index, key };
		}

		if (segment.kind === "text") {
			const key = `segment-${textCount}`;
			textCount += 1;
			return { segment, index, key };
		}

		return { segment, index, key: `${segment.kind}-${index}` };
	});
}
