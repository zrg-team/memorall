/**
 * The web apps Memorall hosts (Files and MemonOS open files with them, and
 * the agent edits files through their engines), pinned to one upstream
 * commit and built by tools/build-hosted-apps.mjs into public/vendors/apps.
 *
 * Upstream: https://github.com/HeyPuter/everything (MIT, Puter Technologies
 * Inc.). Each app is a standalone Vite site that talks to its host through
 * the Puter SDK; the build swaps that SDK for tools/hosted-apps/host and adds
 * a headless engine (tools/hosted-apps/engines/<id>.js) built from the same
 * source.
 *
 * `edits` are exact source replacements, each expected a set number of
 * times: a new commit that moves the code fails the build instead of
 * shipping an app that half works.
 */

export const HOSTED_APPS_SOURCE = {
	repository: "https://github.com/HeyPuter/everything.git",
	commit: "eef08b2e5cf6e2578bdb250af3a9b2c055788dd9",
	license: "MIT",
};

/**
 * Remote defaults a library carries even when the app passes local paths
 * (tesseract.js names jsDelivr and its dev server). Rewritten in every built
 * file so nothing can be fetched from them, and so the MV3 audit passes.
 */
export const DIST_REWRITES = [
	["https://cdn.jsdelivr.net/npm/", "./remote-disabled/"],
	["http://localhost:3000/dist/", "./remote-disabled/"],
];

/**
 * The apps' words for their host: "Saved to Puter", "Open from Puter…". Here
 * the host is Memorall, so the name the user reads is too. The company's
 * copyright lines and the SDK's own name are left as they are.
 */
export const HOST_NAME_REWRITE = {
	pattern: /\bPuter\b(?! Technologies)(?!\.js)/g,
	replacement: "Memorall",
};

/**
 * Controls of Puter's cloud that mean nothing here (signing in, sharing,
 * organizations, Puter AI), hidden by the host's stylesheet in every app:
 * the files are the user's own, in Memorall.
 */
export const HIDE_EVERYWHERE = [
	'[data-account-action="sign-in"]',
	".account-signin",
];

/** @typedef {{ file: string, find: string, replace: string, count: number }} SourceEdit */

/**
 * @typedef {object} HostedAppBuild
 * @property {string} id
 * @property {string} path Folder in the upstream repo.
 * @property {boolean} [patchPackage] Runs patch-package after install (the app's postinstall).
 * @property {boolean} [signedIn] What the shim reports for auth; false keeps cloud-only features off.
 * @property {string[]} [prune] Paths in dist the host never uses (demos, fixtures, Puter Workers).
 * @property {string[]} [hide] CSS selectors of the app's own cloud controls to hide.
 * @property {SourceEdit[]} [edits]
 * @property {Array<{ from: string, to: string }>} [engineAssets] Files from the app's folder copied next to the engine.
 */

/** @type {HostedAppBuild[]} */
export const HOSTED_APP_BUILDS = [
	{
		id: "spreadsheet",
		path: "src/spreadsheet",
		signedIn: true,
		prune: ["og", "email", "worker", "mock.html"],
	},
	{
		id: "documents",
		path: "src/documents",
		signedIn: true,
		prune: ["fixtures", "worker", "playground.html", "mirror.html", "mock.html"],
		// Sharing goes through Puter's drive.
		hide: [".ed-share", "#bs-tab-share"],
		edits: [
			{
				// A font face built in code took the site's root; the app lives
				// in a folder here.
				file: "src/engine/script-font-size.js",
				find: "source:`url(\"/fonts/${file}\")`",
				replace:
					"source:`url(\"${import.meta.env.BASE_URL}fonts/${file}\")`",
				count: 1,
			},
		],
	},
	{
		id: "presentation",
		path: "src/presentation",
		// patches/fflate+0.8.3.patch hardens unzip against zip bombs.
		patchPackage: true,
		signedIn: true,
	},
	{
		id: "whiteboard",
		path: "src/whiteboard",
		// Signed out, the board stays in the browser and in its file; signed
		// in it would also copy every board to ~/whiteboard.
		signedIn: false,
		prune: ["worker"],
		hide: [
			// Saving to and sharing through Puter's cloud, live sessions.
			'[data-action="cloud-save"]',
			'[data-action="share"]',
			'[data-action="participants"]',
			// The board library is this browser's cache of opened files; Files
			// is where boards live.
			'[data-action="home"]',
			".org-start",
		],
		edits: [
			{
				// The logo came from the site's root; the app lives in a folder.
				file: "src/main.js",
				find: 'const brandImage = `<img src="/icons/icon-64.png" srcset="/icons/icon-128.png 2x"',
				replace: 'const brandImage = `<img src="./icons/icon-64.png" srcset="./icons/icon-128.png 2x"',
				count: 1,
			},
			{
				// AI answers with the chat model chosen in Memorall, which needs
				// no Puter account: the board stays signed out.
				file: "src/ai/ai-ui.js",
				find: "    if (!p.auth.isSignedIn()) {\n      await signIn();\n      // Signing in can reveal an organization, whose policy then applies.\n      if (org.info?.role) return request(task, prompt, image);\n    }\n",
				replace: "",
				count: 1,
			},
			{
				// Its AI notice names Puter's AI and account; here it is the
				// user's own chosen model.
				file: "src/ai/ai-ui.js",
				find: ': "Requests use Puter AI with your Puter account. Board content you choose is sent to the AI model.")',
				replace:
					': "Requests use the chat model chosen in Memorall. Board content you choose is sent to it.")',
				count: 1,
			},
			{
				// A site-wide organization is Puter hosting's; none here.
				file: "src/organization/client.js",
				find: 'const res = await fetcher("/organization.json", { cache: "no-cache" });',
				replace: "const res = { ok: false };",
				count: 1,
			},
			{
				// Board addresses only work on http(s) pages; a board launched
				// from a file opens directly.
				file: "src/main.js",
				find: "  else await followBoardAddress(location.href);\n  holdPreviews(false);",
				replace:
					"  else if (boards.some((b) => b.id === globalThis.__memorallLaunchBoard))\n    await openBoard(boards.find((b) => b.id === globalThis.__memorallLaunchBoard), { keepAddress: true });\n  else await followBoardAddress(location.href);\n  holdPreviews(false);",
				count: 1,
			},
		],
	},
	{
		id: "pdf",
		path: "src/pdf",
		signedIn: true,
		edits: [
			{
				// The engine runs from engine/, not the app's page: fonts are
				// found from the app's folder it names.
				file: "src/core/document.js",
				find: "fetch(`${import.meta.env.BASE_URL}fonts/${file}`)",
				replace:
					"fetch(`${globalThis.__memorallHostedAppBase?.pdf ?? import.meta.env.BASE_URL}fonts/${file}`)",
				count: 1,
			},
		],
	},
];
