import React from "react";

interface LogsSectionProps {
	logs: string[];
}

export const LogsSection: React.FC<LogsSectionProps> = ({ logs }) => {
	return (
		<div className="mt-4">
			<div className="text-xs font-medium mb-1">Logs</div>
			<pre className="text-xs p-2 bg-muted rounded max-h-48 overflow-auto">
				{logs.join("\n")}
			</pre>
		</div>
	);
};
