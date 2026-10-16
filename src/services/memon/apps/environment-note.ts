/**
 * What a coding agent that runs in MemonOS is told about its computer.
 *
 * pi code and fx both run their commands in the Memon sandbox and work on
 * the agent's Memon files, so they are told the same facts; `shell` names
 * the tool that runs commands in each (pi's `bash`, fx's `shell`).
 */
export const memonEnvironmentNote = (shell: string): string =>
	[
		"Environment: you are running inside MemonOS, a computer that lives in the user's browser.",
		"- The file system is the agent's Memon files. Paths start at / and the home directory (~) is the current agent's folder.",
		`- ${shell} runs in a browser sandbox (almostnode): a POSIX-like shell with Node.js, npm (install, run) and common tools (ls, cat, grep, find, sed, awk, jq, ...), plus git, python/pip and curl run by the host. It is not a full Linux: no sudo, apt, npx for packages, or system packages. Commands run side by side, but only one serves at a time: a second server is stopped.`,
		`- Long-running servers started from ${shell} keep the sandbox busy (your ${shell} waits for a command to end); prefer short commands.`,
		"- A Vite app (React or plain JS/TS): `npm run dev &` (or `vite &`, `npx vite &`) starts the sandbox's built-in Vite dev server, prints its http://localhost URL and returns, so `curl -s localhost:5173/` can follow on the same line; `npm run dev -- --port 5180 &` or `vite --port 5180 &` picks the port. It serves index.html and what it imports (TS, JSX, CSS, Tailwind) and reloads on change, but runs no vite.config plugins. The Vite CLI itself cannot run here (top-level await, native bundler): no `vite build` or `vite preview`, and do not work around it with a hand-made static server.",
	].join("\n");
