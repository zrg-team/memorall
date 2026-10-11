import { OKF_INDEX_TYPE_ID, OKF_USER_ACTOR } from "./constants";
import { indexRootOf, normalizeFolderPath, parentFolder } from "./index-config";
import { readCardBody } from "./okf/okf-query";
import {
	frontmatterString,
	frontmatterTags,
	isStale,
	lifecycleStatus,
	type OkfDocument,
	serializeOkfDocument,
	trustTier,
} from "./okf/frontmatter";
import type {
	FolderIndexCard,
	FolderIndexOperationJobPayload,
	FolderIndexOperationJobResult,
	FolderIndexStateView,
} from "./operation-types";
import { getFolderIndexRuntime } from "./runtime";

export {
	FOLDER_INDEX_OPERATION_JOB_NAME,
	type FolderIndexOperationJobPayload,
	type FolderIndexOperationJobResult,
} from "./operation-types";

const toCard = (
	path: string,
	card: OkfDocument | null,
	root: string,
): FolderIndexCard | null => {
	if (!card) return null;
	const { frontmatter } = card;
	const generated = frontmatter.generated as { at?: unknown } | undefined;
	return {
		path,
		text: serializeOkfDocument(card),
		type: frontmatterString(frontmatter, "type") ?? "File",
		title: frontmatterString(frontmatter, "title"),
		description: frontmatterString(frontmatter, "description"),
		tags: frontmatterTags(frontmatter),
		trust: trustTier(frontmatter),
		status: lifecycleStatus(frontmatter),
		stale: isStale(frontmatter),
		...(typeof generated?.at === "string" ? { generatedAt: generated.at } : {}),
		...readCardBody(card.body, path, root),
	};
};

/** The OKF bundle root a file's card belongs to, for its bundle-relative links. */
const okfRootOf = async (path: string): Promise<string> => {
	const config = await getFolderIndexRuntime().indexer.loadConfig();
	return (
		indexRootOf(config, OKF_INDEX_TYPE_ID, parentFolder(path) ?? "/") ?? "/"
	);
};

const state = (): Promise<FolderIndexStateView> =>
	getFolderIndexRuntime().indexer.getState();

/** Runs one folder-index operation where the indexes live. */
export const runFolderIndexOperation = async (
	job: FolderIndexOperationJobPayload,
): Promise<FolderIndexOperationJobResult> => {
	const { indexer, okf, okfReader } = getFolderIndexRuntime();
	switch (job.operation) {
		case "state.get":
			return { operation: job.operation, result: await state() };
		case "folder.setType":
			await indexer.setFolderType(
				job.payload.path,
				job.payload.typeId,
				job.payload.enabled,
			);
			return { operation: job.operation, result: await state() };
		case "settings.set":
			await indexer.setSettings(job.payload.settings);
			return { operation: job.operation, result: await state() };
		case "folder.rebuild":
			await indexer.rebuild(job.payload.path);
			return { operation: job.operation, result: await state() };
		case "folder.entries":
			return {
				operation: job.operation,
				result: await indexer.folderEntries(
					normalizeFolderPath(job.payload.path),
				),
			};
		case "folder.graph": {
			const path = normalizeFolderPath(job.payload.path);
			const config = await indexer.loadConfig();
			const root = indexRootOf(config, OKF_INDEX_TYPE_ID, path) ?? path;
			return {
				operation: job.operation,
				result: await okfReader.graph(path, root),
			};
		}
		case "card.get": {
			const path = normalizeFolderPath(job.payload.path);
			return {
				operation: job.operation,
				result: toCard(path, await okf.readCard(path), await okfRootOf(path)),
			};
		}
		case "card.save": {
			const path = normalizeFolderPath(job.payload.path);
			const saved = await okf.curate(path, job.payload.fields, OKF_USER_ACTOR);
			// The folder's index.md shows the new title and description.
			if (saved) void indexer.syncPaths([path]);
			return {
				operation: job.operation,
				result: toCard(path, saved, await okfRootOf(path)),
			};
		}
	}
};
