import React from "react";
import { useTranslation } from "react-i18next";
import { logWarn } from "@/utils/logger";

const PartError: React.FC<{ name: string; message: string }> = ({
	name,
	message,
}) => {
	const { t } = useTranslation("chat");
	return (
		<div
			className="rounded-md border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground"
			title={message}
			data-openui-part-error={name}
		>
			{t("openui.partFailed", {
				name,
				defaultValue: "{{name}} could not be shown.",
			})}
		</div>
	);
};

/** One component that fails to draw shows a note; the rest still draws. */
class PartBoundary extends React.Component<
	{ name: string; children: React.ReactNode },
	{ error: Error | null }
> {
	state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: unknown) {
		return {
			error: error instanceof Error ? error : new Error(String(error)),
		};
	}

	componentDidCatch(error: unknown) {
		logWarn(`[OpenUI] ${this.props.name} could not render:`, error);
	}

	render() {
		return this.state.error ? (
			<PartError name={this.props.name} message={this.state.error.message} />
		) : (
			this.props.children
		);
	}
}

/**
 * The component, drawn inside its own error boundary: a visual with one
 * broken part (a table given a title where its columns go) keeps the others.
 */
export const withPartBoundary = <
	T extends { name: string; component: React.FC<never> },
>(
	definition: T,
): T => {
	const Component = definition.component as React.FC<Record<string, unknown>>;
	const Bounded: React.FC<Record<string, unknown>> = (props) => (
		<PartBoundary name={definition.name}>
			<Component {...props} />
		</PartBoundary>
	);
	Bounded.displayName = `${definition.name}Part`;
	return { ...definition, component: Bounded as T["component"] };
};
