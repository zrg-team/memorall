import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import { compositionFile } from "./util";

const TOOL_NAME = "hyperframes_init" as const;

// Minimal 2-scene starter that passes the linter with zero errors.
// The agent fills in content, palette, and animations from this base.
const STARTER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <!-- FILL: Google Fonts -->
    <style>
      :root {
        --bg: #0a0a0d;  --ink: #f5f5f7;  --accent: #7c6cff;
        --muted: #5a6270;
        --font-display: "Inter", sans-serif;
      }
      *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); color: var(--ink); }
      .scene { position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; overflow: hidden; }
      .scene-content {
        width: 100%; height: 100%; padding: 100px 160px;
        display: flex; flex-direction: column; justify-content: center; gap: 24px;
        box-sizing: border-box; position: relative; z-index: 1;
      }
      .display { font-family: var(--font-display); font-weight: 700; font-size: 96px; line-height: 1.1; }
      .body-text { font-family: var(--font-display); font-weight: 300; font-size: 40px; line-height: 1.4; color: var(--muted); }
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="6">

      <div class="scene clip" id="s1" data-start="0" data-duration="3" data-track-index="0">
        <div class="scene-content">
          <h1 class="display" id="s1-title">Scene One</h1>
          <p class="body-text" id="s1-sub">Your headline here</p>
        </div>
      </div>

      <div class="scene clip" id="s2" data-start="3" data-duration="3" data-track-index="0" style="visibility:hidden;">
        <div class="scene-content">
          <h1 class="display" id="s2-title">Scene Two</h1>
          <p class="body-text" id="s2-sub">Your next point here</p>
        </div>
      </div>

    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      tl.from("#s1-title", { y: 40, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 0.2);
      tl.from("#s1-sub",   { y: 20, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0.5);

      tl.set("#s1", { autoAlpha: 0 }, 3.0);
      tl.set("#s2", { autoAlpha: 1 }, 3.0);

      tl.from("#s2-title", { y: 40, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 3.2);
      tl.from("#s2-sub",   { y: 20, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 3.5);

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path for the new project, e.g. /workspaces/product-launch"),
	force: z
		.boolean()
		.optional()
		.describe("Overwrite if the project already exists (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

export const createHyperframesInitTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Initialise a new HyperFrames project directory with a starter composition. Creates index.html at project_path. Use force: true to overwrite an existing project.",
	schema,
	execute: async (input) => {
		const dfs = services.documentFileSystem;
		if (!dfs) return "Error: documentFileSystem service not available.";

		const file = compositionFile(input.project_path);

		// Check if the project already exists
		if (!input.force) {
			try {
				await dfs.getWorkspaceFileContent(file);
				return `Error: ${file} already exists. Use force: true to overwrite.`;
			} catch {
				// Does not exist — proceed
			}
		}

		await dfs.writeWorkspaceFile(file, STARTER_HTML);
		return `Initialised: ${file} — edit with hyperframes_write, then validate and show.`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesInitTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
