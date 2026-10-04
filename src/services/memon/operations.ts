import type { WebOutlineActionRequest } from "@/services/web-browser/web-browser-protocol";
import { MEMON_KIT_APPS } from "./apps";
import { normalizeMemonFeatureConfig } from "./feature-config";
import {
	cancelMemonWaits,
	disposeMemonMachine,
	findMemonMachine,
	getMemonMachine,
	listMemonMachines,
} from "./machine-registry";
import type { MemonMachine } from "./memon-machine";
import type { MemonTerminalLineOutcome } from "./terminal/memon-terminal";
import type { MemonOperationJobPayload } from "./operation-types";
import type { MemonMachineSnapshot } from "./types";

export {
	MEMON_OPERATION_JOB_NAME,
	type MemonOperation,
	type MemonOperationJobPayload,
	type MemonOperationJobResult,
	type MemonOperationPayloadMap,
	type MemonOperationResultMap,
} from "./operation-types";

const trim = (value: string, max = 60): string =>
	value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Entry names, for the agent's change log. */
const names = (paths: readonly string[]): string =>
	paths.map((path) => path.split("/").pop() ?? path).join(", ");

/**
 * Runs one user input on a machine. Input while the agent is mid-action takes
 * the computer over first; every input is logged for the agent to read.
 */
const userInput = async (
	key: string,
	change: string,
	act: (machine: MemonMachine) => Promise<unknown> | void,
): Promise<MemonMachineSnapshot> => {
	const machine = await getMemonMachine(key);
	if (machine.status === "working") machine.takeOver();
	await act(machine);
	machine.noteUserChange(change);
	return machine.snapshot();
};

/**
 * Input that answers or steers what the agent started (a prompt, an
 * approval, Ctrl+C): logged for the agent, without taking the computer over,
 * so the agent's waiting call carries on. The change may depend on what the
 * input did.
 */
const userAside = async <Result>(
	key: string,
	change: string | ((result: Result) => string),
	act: (machine: MemonMachine) => Promise<Result> | Result,
): Promise<MemonMachineSnapshot | null> => {
	const machine = findMemonMachine(key);
	if (!machine) return null;
	const result = await act(machine);
	machine.noteUserChange(
		typeof change === "function" ? change(result) : change,
	);
	return machine.snapshot();
};

const control = (
	key: string,
	act: (machine: MemonMachine) => void,
): MemonMachineSnapshot | null => {
	const machine = findMemonMachine(key);
	if (!machine) return null;
	act(machine);
	return machine.snapshot();
};

const describeBrowserAction = (
	action: WebOutlineActionRequest["action"],
	ref: string | undefined,
	value: string | undefined,
): string => {
	if (action === "scrollScreen") {
		return `scrolled the page ${value === "up" ? "up" : "down"}`;
	}
	const verb =
		action === "input"
			? "typed into"
			: action === "submit"
				? "submitted"
				: "clicked";
	return `${verb} ${ref ?? "the page"}`;
};

export const runMemonOperation = async (
	job: MemonOperationJobPayload,
): Promise<unknown> => {
	switch (job.operation) {
		case "snapshot.get": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			const snapshot = machine.snapshot();
			return job.payload.sinceRevision === snapshot.revision ? null : snapshot;
		}
		case "machines.list":
			return listMemonMachines().map((machine) => machine.summary());
		case "machine.start": {
			const { key, config, agentId } = job.payload;
			const machine = await getMemonMachine(key, {
				config: config ? normalizeMemonFeatureConfig(config) : undefined,
				agentId,
			});
			return machine.snapshot();
		}
		case "agent.home": {
			const { createMemonHomePort } = await import("./ports");
			return createMemonHomePort().resolve(job.payload.agentId);
		}
		case "agent.renamed": {
			const { agentId, from, to } = job.payload;
			const machines = listMemonMachines().filter(
				(machine) => machine.agent === agentId,
			);
			// Writes still on their way go to the old folder before it moves.
			await Promise.all(machines.map((machine) => machine.flushWrites()));
			const { createMemonHomePort } = await import("./ports");
			const home = await createMemonHomePort().rename(from, to);
			for (const machine of machines) machine.setAgent(agentId, home);
			return home;
		}
		case "machine.stop": {
			// Shutting down mid-action would pull the computer out from under
			// the agent; the user pauses or takes over first.
			if (findMemonMachine(job.payload.key)?.status === "working") {
				throw new Error(
					"MemonOS Bot is using the computer. Pause or take over first.",
				);
			}
			await disposeMemonMachine(job.payload.key);
			return null;
		}
		case "control.takeover":
			return control(job.payload.key, (machine) => machine.takeOver());
		case "control.resume":
			return control(job.payload.key, (machine) => machine.resume());
		case "control.pause":
			return control(job.payload.key, (machine) => machine.pause());
		case "control.cancelWaits":
			cancelMemonWaits(job.payload.key);
			return null;
		case "browser.navigate": {
			const { key, url, newTab, embedded } = job.payload;
			return userInput(key, `went to ${trim(url)}`, (machine) =>
				machine.openUrl(url, { newTab, embedded }),
			);
		}
		case "browser.servers": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			await machine.terminal.checkServers();
			return machine.snapshot();
		}
		case "browser.embeddedNavigated": {
			const { key, url } = job.payload;
			return userAside(
				key,
				`went to ${trim(url)} in the embedded tab`,
				(machine) => machine.refreshBrowser(),
			);
		}
		case "browser.act": {
			const { key, ref, action, value } = job.payload;
			return userInput(
				key,
				describeBrowserAction(action, ref, value),
				async (machine) => {
					await machine.browserAction({ ref, action, value }, { byUser: true });
				},
			);
		}
		case "browser.history": {
			const { key, direction } = job.payload;
			return userInput(key, `went ${direction}`, (machine) =>
				machine.browserHistory(direction),
			);
		}
		case "browser.tab": {
			const { key, index, close } = job.payload;
			return userInput(
				key,
				`${close ? "closed" : "switched to"} tab ${index}`,
				(machine) =>
					close ? machine.closeTab(index) : machine.selectTab(index),
			);
		}
		case "browser.refresh": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			await machine.refreshBrowser();
			return machine.snapshot();
		}
		case "browser.show": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			await machine.showBrowserTab();
			return machine.snapshot();
		}
		case "scheduler.refresh": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			await machine.refreshSchedules();
			return machine.snapshot();
		}
		case "scheduler.save": {
			const { key, schedule } = job.payload;
			return userInput(
				key,
				`${schedule.id ? "edited" : "created"} schedule "${trim(schedule.name)}" (${schedule.scheduleExpression}, ${schedule.status}) in the Scheduler`,
				async (machine) => {
					await machine.saveSchedule(schedule);
				},
			);
		}
		case "scheduler.delete": {
			const { key, id } = job.payload;
			const name = findMemonMachine(key)
				?.snapshot()
				.scheduler.items.find((schedule) => schedule.id === id)?.name;
			return userInput(
				key,
				`deleted schedule "${trim(name ?? id)}" from the Scheduler`,
				async (machine) => {
					await machine.deleteSchedule(id);
				},
			);
		}
		case "skills.refresh":
			return userAside(job.payload.key, "refreshed Skills", (machine) =>
				machine.refreshSkills(),
			);
		case "skills.open": {
			const { key, name } = job.payload;
			const machine = findMemonMachine(key);
			if (!machine) return null;
			if (name) await machine.openSkill(name);
			else machine.closeSkill();
			return machine.snapshot();
		}
		case "skills.toggle": {
			const { key, name, enabled } = job.payload;
			return userAside(
				key,
				`${enabled ? "enabled" : "disabled"} the skill "${trim(name)}"`,
				(machine) => machine.setSkillEnabled(name, enabled),
			);
		}
		case "skills.save": {
			const { key, name, description, body } = job.payload;
			return userAside(key, `saved the skill "${trim(name)}"`, (machine) =>
				machine.saveSkill({ name, description, body }),
			);
		}
		case "skills.delete": {
			const { key, name } = job.payload;
			return userAside(key, `deleted the skill "${trim(name)}"`, (machine) =>
				machine.deleteSkill(name),
			);
		}
		case "connections.refresh": {
			const { key, connectionId } = job.payload;
			const machine = findMemonMachine(key);
			if (!machine) return null;
			if (connectionId) await machine.rediscoverConnection(connectionId);
			else await machine.refreshConnections();
			return machine.snapshot();
		}
		case "connections.select":
			return control(job.payload.key, (machine) =>
				machine.selectConnection(job.payload.provider),
			);
		case "connections.grant": {
			const { key, provider, granted } = job.payload;
			const label =
				findMemonMachine(key)
					?.snapshot()
					.connections.items.find((item) => item.key === provider)?.label ??
				"a connection";
			return userAside(
				key,
				`${granted ? "granted" : "revoked"} ${label}`,
				(machine) => machine.setConnectionGranted(provider, granted),
			);
		}
		case "app.action": {
			const { key, app, id, value } = job.payload;
			const machine = findMemonMachine(key);
			if (!machine) return null;
			const window = machine.findWindow(app);
			if (window) machine.focusWindow(window.id);
			const summary = await MEMON_KIT_APPS[app].act(machine, id, value, {
				byUser: true,
			});
			// Typing into a field is not news; what it leads to is.
			if (summary) machine.noteUserChange(summary);
			return machine.snapshot();
		}
		case "studio.refresh": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			await machine.refreshStudio();
			return machine.snapshot();
		}
		case "studio.run": {
			const { key, request } = job.payload;
			return userAside(key, `ran ${request.tool} in Studio`, (machine) => {
				// Started, not awaited: a model can take minutes; the run shows
				// in the Studio window as it goes.
				void machine.runStudio(request).catch(() => undefined);
			});
		}
		case "studio.select": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			machine.selectStudioTool(job.payload.tool);
			return machine.snapshot();
		}
		case "files.open": {
			const { key, path } = job.payload;
			return userInput(key, `opened ${trim(path)}`, async (machine) => {
				if (await machine.isFolder(path)) await machine.openFolder(path);
				// A launcher the user opens runs as their own command.
				else await machine.openFile(path, { byUser: true });
			});
		}
		case "files.uploaded": {
			const { key, paths } = job.payload;
			const names = paths.map((path) => path.split("/").pop() ?? path);
			return userAside(
				key,
				`uploaded ${trim(names.join(", "))} (${paths.join(", ")})`,
				(machine) => machine.refreshFiles(),
			);
		}
		case "files.ref": {
			const { key, ref } = job.payload;
			return userInput(key, `opened ${ref} in Files`, (machine) =>
				machine.openFileRef(ref, { byUser: true }),
			);
		}
		case "files.move":
		case "files.copy": {
			const { key, paths, to } = job.payload;
			const verb = job.operation === "files.move" ? "moved" : "copied";
			return userAside(
				key,
				`${verb} ${trim(names(paths))} to ${to}`,
				(machine) =>
					job.operation === "files.move"
						? machine.moveFiles(paths, to)
						: machine.copyFiles(paths, to),
			);
		}
		case "files.clipboard": {
			const { key, mode, paths } = job.payload;
			return userAside(
				key,
				paths.length
					? `${mode === "cut" ? "cut" : "copied"} ${trim(names(paths))} in Files`
					: "emptied the Files clipboard",
				(machine) => machine.setFileClipboard(mode, paths),
			);
		}
		case "files.paste": {
			const { key, to } = job.payload;
			const machine = findMemonMachine(key);
			const clipboard = machine?.snapshot().files.clipboard;
			const folder = to ?? machine?.snapshot().files.cwd ?? "/";
			return userAside(
				key,
				`pasted ${clipboard ? trim(names(clipboard.paths)) : "files"} into ${folder}`,
				(target) => target.pasteFiles(to),
			);
		}
		case "files.delete": {
			const { key, paths } = job.payload;
			return userAside(key, `deleted ${trim(names(paths))}`, (machine) =>
				machine.deleteFiles(paths),
			);
		}
		case "visual.save": {
			const { key, source } = job.payload;
			const path =
				findMemonMachine(key)?.snapshot().visual.path ?? "the visual";
			return userInput(key, `edited and saved the visual ${path}`, (machine) =>
				machine.saveVisual(source),
			);
		}
		case "editor.update": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			machine.setEditorContent(job.payload.content);
			return machine.snapshot();
		}
		case "editor.save": {
			const { key, content } = job.payload;
			const path = findMemonMachine(key)?.snapshot().editor.path ?? "the file";
			return userInput(key, `edited and saved ${path}`, async (machine) => {
				if (content !== undefined) machine.setEditorContent(content);
				await machine.saveEditor();
			});
		}
		case "terminal.exec": {
			const { key, command, terminalId } = job.payload;
			return userInput(key, `ran \`${trim(command)}\``, async (machine) => {
				// Started, not awaited: its output streams in.
				await machine.terminal.runCommand(command, {
					byUser: true,
					waitMs: 0,
					terminalId,
				});
			});
		}
		case "terminal.new":
			return userAside(job.payload.key, "opened a Terminal tab", (machine) => {
				machine.terminal.openTab();
			});
		case "terminal.select":
			return control(job.payload.key, (machine) =>
				machine.terminal.selectTab(job.payload.terminalId),
			);
		case "terminal.close":
			return userAside(
				job.payload.key,
				(closed: string) => `closed Terminal tab ${closed}`,
				(machine) => machine.terminal.closeTab(job.payload.terminalId),
			);
		case "terminal.input": {
			const { key, text } = job.payload;
			return userAside(
				key,
				(outcome: MemonTerminalLineOutcome) =>
					outcome === "ran"
						? `ran \`${trim(text.trim())}\` next to the running command`
						: `typed "${trim(text)}" into the running command`,
				(machine) => machine.terminal.enterLine(text),
			);
		}
		case "terminal.clear":
			return control(job.payload.key, (machine) =>
				machine.terminal.clearTab(job.payload.terminalId),
			);
		case "terminal.complete": {
			const { key, line, terminalId } = job.payload;
			const machine = findMemonMachine(key);
			if (!machine) return { line, suggestions: [] };
			return machine.terminal.complete(line, terminalId);
		}
		case "terminal.stop":
			return userAside(
				job.payload.key,
				"stopped the running command",
				(machine) => machine.terminal.stopCommand(),
			);
		case "terminal.clearHistory":
			return userAside(
				job.payload.key,
				"cleared the Terminal's command history",
				(machine) => machine.clearTerminalHistory(),
			);
		case "terminal.approval": {
			const { key, id, decision } = job.payload;
			const command = findMemonMachine(key)?.terminal.approval?.command ?? "";
			return userAside(
				key,
				`${decision === "approve" ? "approved" : "declined"} \`${trim(command)}\``,
				(machine) => machine.terminal.answerApproval(id, decision),
			);
		}
		case "piCode.approval": {
			const { key, id, decision } = job.payload;
			return userAside(
				key,
				decision === "approve"
					? "allowed your pi code request"
					: "declined your pi code request",
				(machine) => machine.piCode.answerApproval(id, decision),
			);
		}
		case "window.open": {
			const { key, app } = job.payload;
			return userInput(key, `opened ${app}`, async (machine) => {
				machine.openWindow(app);
				if (app === "files") await machine.refreshFiles();
				if (app === "scheduler") await machine.refreshSchedules();
				if (app === "studio") await machine.refreshStudio();
				if (app === "skills") await machine.refreshSkills();
				if (app === "connections") await machine.refreshConnections();
			});
		}
		case "window.focus":
			return userInput(
				job.payload.key,
				`switched to ${job.payload.windowId}`,
				(machine) => machine.focusWindow(job.payload.windowId),
			);
		case "window.minimize":
			return userInput(
				job.payload.key,
				`minimized ${job.payload.windowId}`,
				(machine) => machine.minimizeWindow(job.payload.windowId),
			);
		case "window.maximize":
			return userInput(
				job.payload.key,
				`resized ${job.payload.windowId}`,
				(machine) => machine.toggleMaximize(job.payload.windowId),
			);
		case "window.close":
			return userInput(
				job.payload.key,
				`closed ${job.payload.windowId}`,
				(machine) => machine.closeWindow(job.payload.windowId),
			);
		case "window.move": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			machine.moveWindow(job.payload.windowId, job.payload.rect);
			return machine.snapshot();
		}
		case "piCode.attach": {
			const { key, columns, rows, theme } = job.payload;
			const machine = findMemonMachine(key);
			const cursor = await machine?.piCode.attach(columns, rows, theme);
			return cursor === null || cursor === undefined ? null : { cursor };
		}
		case "piCode.read": {
			const { key, cursor, waitMs } = job.payload;
			const machine = findMemonMachine(key);
			if (!machine) return { data: "", cursor, reset: false, closed: true };
			return machine.piCode.read(cursor, Math.min(Math.max(waitMs, 0), 5_000));
		}
		case "piCode.input": {
			const machine = findMemonMachine(job.payload.key);
			if (!machine) return null;
			// Typing into pi keeps an idle computer from being put away.
			machine.lastActiveAt = Date.now();
			await machine.piCode.input(job.payload.data);
			return null;
		}
		case "piCode.resize": {
			const { key, columns, rows } = job.payload;
			await findMemonMachine(key)?.piCode.resize(columns, rows);
			return null;
		}
	}
};
