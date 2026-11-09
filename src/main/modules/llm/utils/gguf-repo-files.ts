export interface GgufRepoFile {
	name: string;
	size: number;
}

interface RepoSibling {
	rfilename: string;
	size?: number;
}

/** The projector a repo's model loads with, in the runner's preference order. */
export function pickProjectorFile(
	siblings: RepoSibling[],
): GgufRepoFile | undefined {
	const projectors = siblings.filter((sibling) => {
		const name = sibling.rfilename.toLowerCase();
		return name.endsWith(".gguf") && name.includes("mmproj");
	});
	const projector =
		projectors.find((sibling) => sibling.rfilename.includes("Q8_0")) ??
		projectors.find((sibling) => sibling.rfilename.includes("Q4_K_M")) ??
		projectors[0];
	return projector
		? { name: projector.rfilename, size: projector.size || 0 }
		: undefined;
}

/**
 * Files that only load alongside a model: a multimodal projector, or an `mtp-`
 * draft model for speculative decoding.
 */
const isCompanionGguf = (name: string): boolean => {
	const lower = name.toLowerCase();
	return lower.includes("mmproj") || /(^|\/)mtp-/.test(lower);
};

/** `name-00001-of-00003.gguf` — llama.cpp's split-model naming. */
const SPLIT_GGUF_FILE = /^(.+)-(\d{5})-of-(\d{5})\.gguf$/i;

/**
 * The GGUF files in a Hugging Face repo that can actually be served, smallest
 * first.
 *
 * A repo lists more .gguf files than it has loadable models: a multimodal one
 * ships a projector that only loads alongside its model, and a split model
 * lists every shard even though wllama addresses it by the first one. Offering
 * those as choices hands the user a file that cannot load on its own — and
 * because the caller preselects the first entry of this list, the tiny
 * projector of a vision repo would otherwise become the default.
 */
export function listLoadableGgufFiles(siblings: RepoSibling[]): GgufRepoFile[] {
	const ggufFiles = siblings.filter((sibling) =>
		sibling.rfilename.toLowerCase().endsWith(".gguf"),
	);

	return ggufFiles
		.filter((sibling) => !isCompanionGguf(sibling.rfilename))
		.map((sibling): GgufRepoFile | null => {
			const split = sibling.rfilename.match(SPLIT_GGUF_FILE);
			if (!split) {
				return { name: sibling.rfilename, size: sibling.size || 0 };
			}
			if (split[2] !== "00001") return null;
			// A split model is only as big as all of its shards together.
			const size = ggufFiles
				.filter(
					(shard) =>
						shard.rfilename.startsWith(`${split[1]}-`) &&
						shard.rfilename.endsWith(`-of-${split[3]}.gguf`),
				)
				.reduce((total, shard) => total + (shard.size || 0), 0);
			return { name: sibling.rfilename, size };
		})
		.filter((file): file is GgufRepoFile => file !== null)
		.sort((a, b) => a.size - b.size);
}
