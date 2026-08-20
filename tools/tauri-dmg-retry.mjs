/**
 * Recovery for a wedged macOS DMG bundling step.
 *
 * hdiutil intermittently hangs on the macos-15-intel CI runners: bundle_dmg.sh
 * dies with no output of its own and the job ends with an orphaned
 * diskimages-help process. The compiled binary and the .app bundle are already
 * complete when that happens, so re-running the DMG step alone recovers a build
 * that is otherwise green.
 *
 * Every effect is injected so the decision logic can be tested off macOS.
 */

import { join } from "node:path";

export const MACOS_DMG_ATTEMPTS = 3;

const hasDmg = (files) =>
	files.some((file) => file.toLowerCase().endsWith(".dmg"));

/**
 * Drops any --bundles the caller passed so the retry targets the DMG alone.
 * It is a multi-value flag ("space or comma separated list"), so every value
 * after it is dropped until the next flag.
 */
export function bundleRetryArguments(tauriArguments) {
	const retryArguments = [];
	let skippingBundleValues = false;
	for (const argument of tauriArguments) {
		if (argument === "--bundles" || argument === "-b") {
			skippingBundleValues = true;
			continue;
		}
		if (argument.startsWith("--bundles=")) {
			skippingBundleValues = false;
			continue;
		}
		if (skippingBundleValues) {
			if (!argument.startsWith("-")) continue;
			skippingBundleValues = false;
		}
		retryArguments.push(argument);
	}
	retryArguments.push("--bundles", "dmg");
	return retryArguments;
}

/**
 * bundle_dmg.sh mounts its writable image at /Volumes/<productName>. A wedged
 * run leaves that mount behind, and macOS then parks later attaches on
 * "<productName> 1", so both shapes count as ours.
 */
export function staleVolumeNames(volumes, productName) {
	if (!productName) return [];
	return volumes.filter(
		(volume) => volume === productName || volume.startsWith(`${productName} `),
	);
}

/**
 * Returns 0 once a retry produces a DMG, otherwise the original failure code.
 *
 * Retries only when the .app exists and no .dmg was produced, so a genuine
 * build failure keeps its own exit code instead of being masked.
 */
export async function retryMacosDmgBundling({
	failureCode,
	platform,
	productName,
	bundleDirectory,
	tauriArguments = [],
	runTauri,
	exists,
	listDirectory,
	removeDirectory,
	listVolumes,
	detachVolume,
	log = () => {},
	attempts = MACOS_DMG_ATTEMPTS,
}) {
	if (platform !== "darwin") return failureCode;
	if (!productName) return failureCode;

	const applicationBundle = join(
		bundleDirectory,
		"macos",
		`${productName}.app`,
	);
	if (!exists(applicationBundle)) return failureCode;

	const dmgDirectory = join(bundleDirectory, "dmg");
	if (hasDmg(listDirectory(dmgDirectory))) return failureCode;

	const retryArguments = bundleRetryArguments(tauriArguments);
	for (let attempt = 2; attempt <= attempts; attempt += 1) {
		log(
			`DMG bundling failed. Retrying the DMG step (attempt ${attempt} of ${attempts}).`,
		);
		for (const volume of staleVolumeNames(listVolumes(), productName)) {
			detachVolume(join("/Volumes", volume));
		}
		removeDirectory(dmgDirectory);
		const retryCode = await runTauri(retryArguments);
		if (retryCode === 0 && hasDmg(listDirectory(dmgDirectory))) return 0;
	}
	return failureCode;
}
