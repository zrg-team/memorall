import React, { useRef, useEffect } from "react";
import { Code2, Eye } from "lucide-react";
import mermaid from "mermaid";
import { Button } from "@/main/components/ui/button";
import { DeferredMount } from "@/main/modules/chat/components/message/DeferredMount";

// Initialize mermaid with browser extension compatible settings
mermaid.initialize({
	startOnLoad: false,
	theme: "default",
	securityLevel: "loose",
	flowchart: {
		useMaxWidth: true,
		htmlLabels: true,
	},
	suppressErrorRendering: false,
	logLevel: "debug",
});

// Global counter for unique mermaid IDs
let mermaidCounter = 0;
const mermaidRenderCache = new Map<string, Promise<string>>();

interface MermaidRendererProps {
	chart: string;
	className?: string;
}

type RenderState = "idle" | "loading" | "success" | "error";

const renderMermaid = (id: string, chart: string): Promise<string> => {
	const cached = mermaidRenderCache.get(chart);
	if (cached) return cached;

	const next = mermaid.render(id, chart).then(({ svg }) => svg);
	mermaidRenderCache.set(chart, next);
	return next;
};

class MermaidErrorBoundary extends React.Component<
	{ children: React.ReactNode; fallback: React.ReactNode },
	{ hasError: boolean }
> {
	constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {}

	render() {
		if (this.state.hasError) {
			return this.props.fallback;
		}

		return this.props.children;
	}
}

const MermaidRendererInner: React.FC<MermaidRendererProps> = ({
	chart,
	className = "",
}) => {
	const [renderState, setRenderState] = React.useState<RenderState>("idle");
	const [uniqueId] = React.useState(
		() => `mermaid-${++mermaidCounter}-${Date.now()}`,
	);
	const [svgContent, setSvgContent] = React.useState<string>("");
	const [errorMessage, setErrorMessage] = React.useState<string>("");
	const [showCode, setShowCode] = React.useState(false);
	const renderedChartRef = useRef<string | null>(null);

	useEffect(() => {
		if (renderedChartRef.current === chart) {
			return;
		}

		let isMounted = true;
		let timeoutId: NodeJS.Timeout;

		const renderChart = async () => {
			const trimmedChart = chart.trim();
			if (!trimmedChart) {
				setRenderState("error");
				setErrorMessage("Empty chart content");
				return;
			}

			if (!isMounted) {
				return;
			}

			setRenderState("loading");
			setSvgContent("");
			setErrorMessage("");

			try {
				// Add timeout to prevent infinite loading
				timeoutId = setTimeout(() => {
					if (isMounted) {
						setRenderState("error");
						setErrorMessage("Rendering timeout");
					}
				}, 5000);

				const svg = await renderMermaid(uniqueId, trimmedChart);

				if (!isMounted) return;

				clearTimeout(timeoutId);

				if (svg && svg.includes("<svg") && !svg.includes("Syntax error")) {
					setSvgContent(svg);
					setRenderState("success");
					renderedChartRef.current = chart;
				} else {
					setRenderState("error");
					setErrorMessage("Invalid SVG output");
				}
			} catch (error) {
				if (!isMounted) return;
				clearTimeout(timeoutId);
				setRenderState("error");
				setErrorMessage(
					error instanceof Error ? error.message : "Unknown error",
				);
			}
		};

		renderChart();

		return () => {
			isMounted = false;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [chart, uniqueId]);

	const CodeBlockFallback = () => (
		<div className="relative">
			<div className="absolute top-2 right-2 text-xs text-red-500 bg-red-50 dark:bg-red-950 px-2 py-1 rounded">
				Render failed: {errorMessage}
			</div>
			<pre className="bg-muted p-4 rounded-lg overflow-x-auto">
				<code className="text-sm">{chart}</code>
			</pre>
		</div>
	);

	const CodeView = () => (
		<pre className="bg-muted p-4 rounded-lg overflow-x-auto">
			<code className="text-sm">{chart}</code>
		</pre>
	);

	if (renderState === "idle" || renderState === "loading") {
		return (
			<div className={`text-sm text-muted-foreground p-4 ${className}`}>
				Loading diagram...
			</div>
		);
	}

	if (renderState === "error") {
		return <CodeBlockFallback />;
	}

	return (
		<div className={`relative ${className}`}>
			<Button
				variant="ghost"
				size="icon"
				className="absolute top-2 right-2 z-10 h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
				onClick={() => setShowCode(!showCode)}
				title={showCode ? "Show diagram" : "Show code"}
			>
				{showCode ? <Eye className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
			</Button>

			{showCode ? (
				<CodeView />
			) : (
				<MermaidErrorBoundary fallback={<CodeBlockFallback />}>
					<div
						className="my-2"
						dangerouslySetInnerHTML={{ __html: svgContent }}
					/>
				</MermaidErrorBoundary>
			)}
		</div>
	);
};

export const MermaidRenderer: React.FC<MermaidRendererProps> = (props) => (
	<DeferredMount minHeight={120}>
		<MermaidRendererInner {...props} />
	</DeferredMount>
);
