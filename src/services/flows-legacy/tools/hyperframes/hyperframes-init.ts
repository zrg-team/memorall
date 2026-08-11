import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import { compositionFile } from "@/services/flows-legacy/tools/hyperframes/util";
import {
	readFileBytes,
	writeFileBytes,
} from "@/services/flows-legacy/tools/fs/util";
import type { HyperframesToolConfig } from "@/services/flows-legacy/tools/hyperframes/config";

const TOOL_NAME = "hyperframes_init" as const;

// ── Templates ────────────────────────────────────────────────────────────────

interface TailwindTemplateOptions {
	width: number;
	height: number;
	duration: number;
	durations: [number, number, number, number, number];
	bg: string;
	ink: string;
	accent: string;
	accent2: string;
	muted: string;
	fontDisplay: string;
	fontData: string;
	eyebrow: string;
	title: string;
	subtitle: string;
	problem: string;
	solution: string;
	statLabel: string;
	statValue: number;
	statSuffix: string;
	statCaption: string;
	cta: string;
	formatStat?: "integer" | "percent" | "decimal";
	includeGrid?: boolean;
	includeVignette?: boolean;
}

const sumBefore = (values: number[], index: number): number =>
	values.slice(0, index).reduce((sum, value) => sum + value, 0);

const makeTailwindTemplate = (options: TailwindTemplateOptions): string => {
	const [d1, d2, d3, d4, d5] = options.durations;
	const s1 = 0;
	const s2 = sumBefore(options.durations, 1);
	const s3 = sumBefore(options.durations, 2);
	const s4 = sumBefore(options.durations, 3);
	const s5 = sumBefore(options.durations, 4);
	const transition1 = s4 - 0.25;
	const transition2 = s5 - 0.25;
	const sceneClass = `scene clip absolute left-0 top-0 h-[${options.height}px] w-[${options.width}px] overflow-hidden`;
	const contentClass =
		options.width > options.height
			? "scene-content relative z-[1] flex h-full w-full flex-col justify-center gap-[32px] px-[160px] py-[100px]"
			: "scene-content relative z-[1] flex h-full w-full flex-col justify-center gap-[28px] px-[80px] py-[140px]";
	const displaySize =
		options.width > options.height ? "text-[112px]" : "text-[132px]";
	const supportSize =
		options.width > options.height ? "text-[40px]" : "text-[52px]";
	const titleText = options.title.replace(/\n/g, "<br/>");
	const problemText = options.problem.replace(/\n/g, "<br/>");
	const solutionText = options.solution.replace(/\n/g, "<br/>");
	const gridDecor = options.includeGrid
		? '<div class="grid-bg absolute inset-0 z-[0]"></div>'
		: "";
	const vignetteDecor = options.includeVignette
		? '<div class="vignette absolute inset-0 z-[49] pointer-events-none"></div>'
		: "";

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${options.width}, height=${options.height}" />
  <style>
    :root{--bg:${options.bg};--ink:${options.ink};--accent:${options.accent};--accent2:${options.accent2};--muted:${options.muted};--font-display:${options.fontDisplay};--font-data:${options.fontData}}
    *,*::before,*::after{box-sizing:border-box}
    html,body{width:${options.width}px;height:${options.height}px;margin:0;overflow:hidden;background:var(--bg);color:var(--ink)}
    .grain{position:absolute;inset:0;pointer-events:none;z-index:50;opacity:.15;background-image:radial-gradient(rgba(255,255,255,.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,.18) 1px,transparent 1.2px);background-size:3px 3px,5px 5px;background-position:0 0,1px 2px;mix-blend-mode:overlay}
    .glow{position:absolute;border-radius:9999px;filter:blur(140px);pointer-events:none;z-index:0}
    .grid-bg{background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:60px 60px}
    .vignette{background:radial-gradient(ellipse at center,transparent 42%,rgba(0,0,0,.58) 100%)}
  </style>
</head>
<body>
  <div id="main" data-composition-id="main" data-width="${options.width}" data-height="${options.height}" data-start="0" data-duration="${options.duration}" class="relative h-[${options.height}px] w-[${options.width}px] overflow-hidden bg-hf-bg text-hf-ink">
    <div id="s1" class="${sceneClass}" data-start="${s1}" data-duration="${d1}" data-track-index="0">
      ${gridDecor}<div class="grain"></div>
      <div class="glow h-[620px] w-[620px] bg-hf-accent opacity-[0.12] -right-[120px] -top-[180px]"></div>
      <div class="${contentClass}">
        <p id="s1-label" class="font-hf-data text-[18px] uppercase tracking-[5px] text-hf-accent">${options.eyebrow}</p>
        <h1 id="s1-title" class="font-hf-display ${displaySize} font-black leading-[1.02] text-hf-ink">${titleText}</h1>
        <p id="s1-sub" class="max-w-[940px] font-hf-display ${supportSize} font-light leading-[1.32] text-hf-muted">${options.subtitle}</p>
      </div>
    </div>
    <div id="s2" class="${sceneClass}" data-start="${s2}" data-duration="${d2}" data-track-index="0" style="visibility:hidden;">
      ${gridDecor}<div class="grain"></div>
      <div class="${contentClass}">
        <p id="s2-label" class="font-hf-data text-[18px] uppercase tracking-[5px] text-hf-accent">THE FRICTION</p>
        <h2 id="s2-title" class="font-hf-display text-[88px] font-black leading-[1.05] text-hf-ink">${problemText}</h2>
        <p id="s2-sub" class="max-w-[820px] font-hf-display text-[36px] font-light leading-[1.38] text-hf-muted">Name the customer pain clearly, then make the next scene feel inevitable.</p>
      </div>
    </div>
    <div id="s3" class="${sceneClass}" data-start="${s3}" data-duration="${d3}" data-track-index="0" style="opacity:0;">
      ${vignetteDecor}<div class="grain"></div>
      <div class="glow h-[520px] w-[900px] bg-hf-accent-2 opacity-[0.14] bottom-[-120px] left-[260px]"></div>
      <div class="${contentClass}">
        <p id="s3-label" class="font-hf-data text-[18px] uppercase tracking-[5px] text-hf-accent">THE SOLUTION</p>
        <h2 id="s3-title" class="font-hf-display text-[92px] font-black leading-[1.04] text-hf-ink">${solutionText}</h2>
        <p id="s3-sub" class="max-w-[900px] font-hf-display text-[36px] font-light leading-[1.38] text-hf-muted">Replace this line with the product promise or launch message.</p>
      </div>
    </div>
    <div id="s4" class="${sceneClass}" data-start="${s4}" data-duration="${d4}" data-track-index="0" style="opacity:0;">
      ${gridDecor}<div class="grain"></div>
      <div class="${contentClass} flex-row items-center gap-[120px]">
        <div class="min-w-[520px]">
          <p id="s4-label" class="font-hf-data text-[18px] uppercase tracking-[5px] text-hf-accent">${options.statLabel}</p>
          <div id="s4-stat" class="font-hf-display text-[160px] font-black leading-none text-hf-accent-2">0${options.statSuffix}</div>
          <p class="font-hf-display text-[32px] font-light text-hf-muted">${options.statCaption}</p>
        </div>
        <p id="s4-copy" class="max-w-[760px] font-hf-display text-[42px] font-light leading-[1.28] text-hf-ink">A proof point, customer quote, or metric makes the story credible.</p>
      </div>
    </div>
    <div id="s5" class="${sceneClass}" data-start="${s5}" data-duration="${d5}" data-track-index="0" style="opacity:0;">
      ${vignetteDecor}<div class="grain"></div>
      <div class="glow h-[560px] w-[1180px] bg-hf-accent opacity-[0.1] bottom-[-220px] left-1/2 -translate-x-1/2"></div>
      <div class="${contentClass} items-center text-center">
        <p id="s5-label" class="font-hf-data text-[18px] uppercase tracking-[5px] text-hf-accent">GET STARTED</p>
        <h2 id="s5-cta" class="font-hf-display text-[104px] font-black leading-[1.03] text-hf-ink">${options.cta}</h2>
        <p id="s5-sub" class="font-hf-display text-[34px] font-light text-hf-muted">Free to try. Replace with your best next action.</p>
      </div>
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    if (window.lucide) window.lucide.createIcons();
    var tl = gsap.timeline({ paused: true });
    tl.from("#s1-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, 0.1);
    tl.from("#s1-title", { y:50, autoAlpha:0, duration:0.7, ease:"power4.out" }, 0.3);
    tl.from("#s1-sub", { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, 0.7);
    tl.to("#s1-title", { y:-6, duration:1.5, ease:"sine.inOut", yoyo:true, repeat:1 }, 1.0);
    tl.set("#s1", { autoAlpha:0 }, ${s2});
    tl.set("#s2", { autoAlpha:1 }, ${s2});
    tl.from("#s2-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, ${s2 + 0.2});
    tl.from("#s2-title", { y:60, autoAlpha:0, duration:0.7, ease:"power4.out" }, ${s2 + 0.4});
    tl.from("#s2-sub", { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, ${s2 + 0.8});
    tl.set("#s2", { autoAlpha:0 }, ${s3});
    tl.set("#s3", { opacity:1 }, ${s3});
    tl.from("#s3-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, ${s3 + 0.2});
    tl.from("#s3-title", { y:60, autoAlpha:0, duration:0.7, ease:"power4.out" }, ${s3 + 0.4});
    tl.from("#s3-sub", { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, ${s3 + 0.8});
    tl.set("#s4", { opacity:1 }, ${s4});
    tl.from("#s4-label", { x:-30, autoAlpha:0, duration:0.4, ease:"power2.out" }, ${s4 + 0.2});
    var c={v:0};
    tl.to(c, { v:${options.statValue}, duration:2.0, ease:"power2.out", onUpdate:function(){
      var value = ${options.formatStat === "decimal" ? "c.v.toFixed(1)" : "Math.round(c.v).toLocaleString()"};
      document.getElementById("s4-stat").textContent = value + "${options.statSuffix}";
    }}, ${s4 + 0.5});
    tl.from("#s4-copy", { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, ${s4 + 0.8});
    tl.set("#s5", { opacity:1 }, ${s5});
    tl.from("#s5-label", { y:20, autoAlpha:0, duration:0.4, ease:"power2.out" }, ${s5 + 0.2});
    tl.from("#s5-cta", { y:50, autoAlpha:0, duration:0.7, ease:"power4.out" }, ${s5 + 0.4});
    tl.from("#s5-sub", { y:30, autoAlpha:0, duration:0.5, ease:"power2.out" }, ${s5 + 0.8});
    window.HyperShader.init({
      bgColor:"${options.bg}", scenes:["s3","s4","s5"], timeline:tl,
      transitions:[{time:${transition1},shader:"cinematic-zoom",duration:0.5},{time:${transition2},shader:"light-leak",duration:0.5}],
    });
    window.__timelines["main"] = tl;
  </script>
</body>
</html>`;
};

const TPL_NEON_LAUNCH = makeTailwindTemplate({
	width: 1920,
	height: 1080,
	duration: 18,
	durations: [3.5, 3.5, 3.5, 4, 3.5],
	bg: "#08080f",
	ink: "#f0eeff",
	accent: "#c840f0",
	accent2: "#7c6cff",
	muted: "#8a86a4",
	fontDisplay: '"Space Grotesk",sans-serif',
	fontData: '"JetBrains Mono",monospace',
	eyebrow: "INTRODUCING",
	title: "Your Product\nName Here",
	subtitle: "The tagline that changes everything.",
	problem: "What frustrates\nyour customers",
	solution: "Your product\nfixes it",
	statLabel: "TRACTION",
	statValue: 12000,
	statSuffix: "",
	statCaption: "users in 30 days",
	cta: "yourproduct.com",
	includeVignette: true,
});

const TPL_SOCIAL_REEL = makeTailwindTemplate({
	width: 1080,
	height: 1920,
	duration: 15,
	durations: [3, 2.5, 3, 3, 3.5],
	bg: "#0d0d0d",
	ink: "#ffffff",
	accent: "#ff3c3c",
	accent2: "#ffffff",
	muted: "#8d8d8d",
	fontDisplay: '"Barlow Condensed",sans-serif',
	fontData: '"JetBrains Mono",monospace',
	eyebrow: "STOP SCROLLING",
	title: "This changes\nhow you work",
	subtitle: "A fast vertical draft for social launch posts.",
	problem: "Slow.\nPainful.\nBroken.",
	solution: "The new way\nstarts here",
	statLabel: "RESULTS",
	statValue: 87,
	statSuffix: "%",
	statCaption: "faster than the old workflow",
	cta: "LINK IN BIO",
});

const TPL_CLEAN_MINIMAL = makeTailwindTemplate({
	width: 1920,
	height: 1080,
	duration: 15,
	durations: [3.5, 3, 3, 3, 2.5],
	bg: "#f7f5f0",
	ink: "#1a1814",
	accent: "#d97b2a",
	accent2: "#1a1814",
	muted: "#8a8278",
	fontDisplay: '"DM Serif Display",serif',
	fontData: '"Space Grotesk",sans-serif',
	eyebrow: "EDITORIAL STORY",
	title: "Beautiful products\ndeserve a story",
	subtitle: "A restrained template for premium announcements.",
	problem: "Too much noise\nnot enough clarity",
	solution: "A cleaner way\nto explain value",
	statLabel: "THE RESULT",
	statValue: 40,
	statSuffix: "",
	statCaption: "hours saved per week",
	cta: "Start for free today.",
});

const TPL_TECH_DATA = makeTailwindTemplate({
	width: 1920,
	height: 1080,
	duration: 20,
	durations: [4, 4, 4, 4, 4],
	bg: "#040d0f",
	ink: "#e8f8f5",
	accent: "#00e5c0",
	accent2: "#0066ff",
	muted: "#5b807b",
	fontDisplay: '"Space Grotesk",sans-serif',
	fontData: '"JetBrains Mono",monospace',
	eyebrow: "// PRODUCT.LAUNCH",
	title: "Built for teams\nwho ship fast",
	subtitle: "A metrics-forward launch draft with technical energy.",
	problem: "Latency hides\ninside every workflow",
	solution: "Ship decisions\nat product speed",
	statLabel: "PERFORMANCE",
	statValue: 12,
	statSuffix: "ms",
	statCaption: "average response time",
	cta: "yourproduct.com",
	includeGrid: true,
});

const TPL_WARM_CINEMA = makeTailwindTemplate({
	width: 1920,
	height: 1080,
	duration: 18,
	durations: [4, 3.5, 3.5, 3.5, 3.5],
	bg: "#100c07",
	ink: "#f5ead6",
	accent: "#c9892a",
	accent2: "#e8b86d",
	muted: "#9a8460",
	fontDisplay: '"Cormorant",serif',
	fontData: '"Space Grotesk",sans-serif',
	eyebrow: "EST. 2024",
	title: "Every great product\nbegins with a story",
	subtitle: "A warm cinematic structure for founder-led launches.",
	problem: "What if it was\njust easier?",
	solution: "Introducing\nProduct Name",
	statLabel: "IN NUMBERS",
	statValue: 4.9,
	statSuffix: "/5",
	statCaption: "average customer rating",
	cta: "Begin your story.",
	formatStat: "decimal",
	includeVignette: true,
});

// ── Scaffold templates ────────────────────────────────────────────────────────

interface ScaffoldOptions {
	width: number;
	height: number;
	durations: number[];
	fills: string[];
	shaderGroups: Array<{ indices: [number, number]; shader: string }>;
}

const makeScaffoldHTML = ({
	width,
	height,
	durations,
	fills,
	shaderGroups,
}: ScaffoldOptions): string => {
	let t = 0;
	const starts = durations.map((d) => {
		const s = t;
		t += d;
		return s;
	});
	const total = t;

	const firstAnchors = new Set(shaderGroups.map((g) => g.indices[0]));
	const secondAnchors = new Set(shaderGroups.map((g) => g.indices[1]));
	const pad = height > width ? "120px 80px" : "80px 160px";

	const scenesHtml = durations
		.map((d, i) => {
			const id = `s${i + 1}`;
			const style =
				i === 0
					? ""
					: firstAnchors.has(i) || secondAnchors.has(i)
						? ` style="opacity:0;"`
						: ` style="visibility:hidden;"`;
			return `      <div class="scene clip" id="${id}" data-start="${starts[i]}" data-duration="${d}" data-track-index="0"${style}>\n        <div class="grain"></div><div class="scene-content"><!-- FILL: ${fills[i] ?? `scene ${i + 1}`} --></div>\n      </div>`;
		})
		.join("\n");

	const js: string[] = [
		"      window.__timelines = window.__timelines || {};",
		"      if (window.lucide) window.lucide.createIcons();",
		"      var tl = gsap.timeline({ paused: true });",
		`      tl.set("#s1", { autoAlpha:0 }, ${starts[1]});`,
	];

	for (let i = 1; i < durations.length; i++) {
		const id = `#s${i + 1}`;
		const isLast = i === durations.length - 1;
		if (firstAnchors.has(i)) {
			js.push(
				`      tl.set("${id}", { opacity:1 }, ${starts[i]}); // first anchor`,
			);
		} else if (!secondAnchors.has(i)) {
			if (isLast) {
				js.push(`      tl.set("${id}", { autoAlpha:1 }, ${starts[i]});`);
			} else {
				js.push(
					`      tl.set("${id}", { autoAlpha:1 }, ${starts[i]}); tl.set("${id}", { autoAlpha:0 }, ${starts[i] + durations[i]});`,
				);
			}
		}
		// second anchors: HyperShader handles visibility — no explicit toggle needed
	}

	js.push("      // === FILL: scene animations ===");

	for (const g of shaderGroups) {
		const [a, b] = g.indices;
		const transTime = +(starts[b] - 0.25).toFixed(2);
		js.push(
			`      window.HyperShader.init({ bgColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0d", scenes: ["s${a + 1}", "s${b + 1}"], timeline: tl, transitions: [{ time: ${transTime}, shader: "${g.shader}", duration: 0.5 }] });`,
		);
	}

	js.push('      window.__timelines["main"] = tl;');

	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <style>
      :root { --bg:#0a0a0d; --ink:#f5f5f7; --accent:#7c6cff; --muted:#5a6270; --accent-dim:#3d3680; --font-display:"Space Grotesk",sans-serif; --font-data:"JetBrains Mono",monospace; }
      *,*::before,*::after { margin:0; padding:0; box-sizing:border-box }
      html,body { width:${width}px; height:${height}px; overflow:hidden; background:var(--bg); color:var(--ink) }
      .scene { position:absolute; top:0; left:0; width:${width}px; height:${height}px; overflow:hidden }
      .scene-content { width:100%; height:100%; padding:${pad}; display:flex; flex-direction:column; justify-content:center; gap:24px; box-sizing:border-box; position:relative; z-index:1 }
      .grain { position:absolute; inset:0; pointer-events:none; z-index:50; opacity:0.18; background-image:radial-gradient(rgba(255,255,255,0.08) 1px,transparent 1.2px),radial-gradient(rgba(0,0,0,0.18) 1px,transparent 1.2px); background-size:3px 3px,5px 5px; background-position:0 0,1px 2px; mix-blend-mode:overlay }
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-width="${width}" data-height="${height}" data-start="0" data-duration="${total}">
${scenesHtml}
    </div>
    <script>
${js.join("\n")}
    </script>
  </body>
</html>`;
};

const SCAFFOLD_SOCIAL_REEL = makeScaffoldHTML({
	width: 1080,
	height: 1920,
	durations: [2.5, 2.5, 2.5, 2.5, 2.5, 2.5],
	fills: ["hook", "context", "build-up", "hero", "proof", "CTA"],
	shaderGroups: [{ indices: [2, 3], shader: "cinematic-zoom" }],
});

const SCAFFOLD_LAUNCH_TEASER = makeScaffoldHTML({
	width: 1920,
	height: 1080,
	durations: [3, 3, 3, 3.5, 3, 3, 3, 3.5],
	fills: [
		"hook",
		"context",
		"problem",
		"pivot",
		"solution",
		"proof",
		"momentum",
		"CTA",
	],
	shaderGroups: [
		{ indices: [3, 4], shader: "cinematic-zoom" },
		{ indices: [6, 7], shader: "light-leak" },
	],
});

const SCAFFOLD_EXPLAINER = makeScaffoldHTML({
	width: 1920,
	height: 1080,
	durations: [3, 3, 4, 3.5, 4, 5, 3.5, 4, 3.5, 4, 4, 3.5],
	fills: [
		"hook",
		"context",
		"problem-1",
		"problem-2",
		"pivot",
		"solution-1",
		"solution-2",
		"proof-1",
		"proof-2",
		"momentum",
		"vision",
		"CTA",
	],
	shaderGroups: [
		{ indices: [2, 3], shader: "cinematic-zoom" },
		{ indices: [8, 9], shader: "domain-warp" },
	],
});

const SCAFFOLD_CINEMATIC = makeScaffoldHTML({
	width: 1920,
	height: 1080,
	durations: [8, 7, 8, 10, 9, 10, 8],
	fills: [
		"title",
		"world",
		"tension",
		"revelation",
		"transformation",
		"consequence",
		"resolve",
	],
	shaderGroups: [
		{ indices: [2, 3], shader: "cross-warp-morph" },
		{ indices: [5, 6], shader: "thermal-distortion" },
	],
});

// ── Template registry ─────────────────────────────────────────────────────────

interface TemplateEntry {
	name: string;
	description: string;
	filename: string;
	html: string;
}

const TEMPLATES: TemplateEntry[] = [
	{
		name: "Neon Launch",
		description: "Dark purple/pink, 1920x1080, 18s - dramatic product launch",
		filename: "neon-launch.html",
		html: TPL_NEON_LAUNCH,
	},
	{
		name: "Social Reel",
		description: "Bold vertical, 1080x1920, 15s - punchy social promo",
		filename: "social-reel.html",
		html: TPL_SOCIAL_REEL,
	},
	{
		name: "Clean Minimal",
		description: "Light editorial, 1920x1080, 15s - typography-forward",
		filename: "clean-minimal.html",
		html: TPL_CLEAN_MINIMAL,
	},
	{
		name: "Tech Data",
		description: "Dark/teal, 1920x1080, 20s - metrics and product proof",
		filename: "tech-data.html",
		html: TPL_TECH_DATA,
	},
	{
		name: "Warm Cinema",
		description: "Amber/gold, 1920x1080, 18s - cinematic storytelling",
		filename: "warm-cinema.html",
		html: TPL_WARM_CINEMA,
	},
	{
		name: "Scaffold Social Reel",
		description:
			"Structural scaffold: 1080x1920, 15s, 6 scenes, 1 shader group",
		filename: "scaffold-social-reel.html",
		html: SCAFFOLD_SOCIAL_REEL,
	},
	{
		name: "Scaffold Launch Teaser",
		description:
			"Structural scaffold: 1920x1080, 25s, 8 scenes, 2 shader groups",
		filename: "scaffold-launch-teaser.html",
		html: SCAFFOLD_LAUNCH_TEASER,
	},
	{
		name: "Scaffold Explainer",
		description:
			"Structural scaffold: 1920x1080, 45s, 12 scenes, 2 shader groups",
		filename: "scaffold-explainer.html",
		html: SCAFFOLD_EXPLAINER,
	},
	{
		name: "Scaffold Cinematic",
		description:
			"Structural scaffold: 1920x1080, 60s, 7 scenes, 2 shader groups, long durations",
		filename: "scaffold-cinematic.html",
		html: SCAFFOLD_CINEMATIC,
	},
];

const TEMPLATE_NAMES = TEMPLATES.map((t) =>
	t.filename.replace(".html", ""),
) as [string, ...string[]];

// ── Tool ──────────────────────────────────────────────────────────────────────

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path for the new project. Choose a meaningful slug that reflects the content (e.g. /projects/vietnam-travel or /projects/product-launch). Never use generic names like 'default', 'project', or 'untitled'.",
		),
	template: z
		.enum(TEMPLATE_NAMES)
		.optional()
		.describe(
			`Template to use for index.html. Options: ${TEMPLATE_NAMES.join(", ")}. Defaults to neon-launch if omitted.`,
		),
	force: z
		.boolean()
		.optional()
		.describe("Overwrite if the project already exists (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesInitTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description: `Initialise a new HyperFrames project. Writes index.html using the chosen Tailwind-first template. Available templates: ${TEMPLATES.map((t) => `${t.filename.replace(".html", "")} (${t.description})`).join(" | ")}. Use force: true to overwrite an existing project.`,
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const indexFile = compositionFile(input.project_path, config?.rootPath);

		if (!input.force) {
			try {
				await readFileBytes(dfs, indexFile, config);
				return `Error: ${indexFile} already exists. Use force: true to overwrite.`;
			} catch {
				// Does not exist - proceed
			}
		}

		const chosen =
			TEMPLATES.find((t) => t.filename === `${input.template}.html`) ??
			TEMPLATES[0];

		await writeFileBytes(dfs, indexFile, chosen.html, true, config);

		return `Initialised: ${indexFile} with Tailwind template "${chosen.name}" (${chosen.description}). Edit with hyperframes_write, then hyperframes_validate and hyperframes_show.`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesInitTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
