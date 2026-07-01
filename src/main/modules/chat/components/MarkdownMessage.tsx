import React, { Suspense, lazy } from "react";
import { MarkdownMessageBody } from "./message/MarkdownMessageBody";

interface MarkdownMessageProps {
	className?: string;
	isStreaming?: boolean;
	children?: string;
}

const MarkdownMathMessageBody = lazy(
	() => import("./message/MarkdownMathMessageBody"),
);

const MATH_PATTERN = /(^|[^\\])(?:\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\(|\\\[)/;

export const hasMath = (content: string | undefined): boolean =>
	typeof content === "string" && MATH_PATTERN.test(content);

const MarkdownMessageComponent: React.FC<MarkdownMessageProps> = ({
	className,
	children,
	isStreaming = false,
}) => {
	if (hasMath(children)) {
		const fallback = (
			<MarkdownMessageBody className={className} isStreaming={isStreaming}>
				{children}
			</MarkdownMessageBody>
		);

		return (
			<Suspense fallback={fallback}>
				<MarkdownMathMessageBody
					className={className}
					isStreaming={isStreaming}
				>
					{children}
				</MarkdownMathMessageBody>
			</Suspense>
		);
	}

	return (
		<MarkdownMessageBody className={className} isStreaming={isStreaming}>
			{children}
		</MarkdownMessageBody>
	);
};

export const MarkdownMessage = React.memo(
	MarkdownMessageComponent,
	(prevProps, nextProps) => {
		if (prevProps.isStreaming !== nextProps.isStreaming) {
			return false;
		}

		if (prevProps.isStreaming && prevProps.children === nextProps.children) {
			return true;
		}

		return (
			prevProps.children === nextProps.children &&
			prevProps.className === nextProps.className
		);
	},
);

MarkdownMessage.displayName = "MarkdownMessage";

export default MarkdownMessage;
