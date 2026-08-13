// Main runner entry point - determines mode and loads appropriate runner
let mode = "wllama"; // 'wllama' | 'embedding' | 'webllm' | 'transformer'

// Parse URL parameters to determine mode
const params = new URLSearchParams(self.location ? self.location.search : "");
try {
	const m = params.get("mode");
	if (m === "embedding") mode = "embedding";
	if (m === "webllm") mode = "webllm";
	if (m === "transformer") mode = "transformer";
} catch {
	// Default to wllama
}

console.log(`Starting LLM Runner in ${mode} mode`);

// Load the appropriate runner based on mode
switch (mode) {
	case "embedding":
		import("./modes/embedding-runner.js");
		break;
	case "webllm":
		import("./modes/webllm-runner.js");
		break;
	case "transformer":
		import("./modes/transformer-runner.js");
		break;
	case "wllama":
	default:
		import("./modes/wllama-runner.js");
		break;
}
