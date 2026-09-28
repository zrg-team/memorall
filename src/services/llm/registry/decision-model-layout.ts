/**
 * Typed-decision models as they sit in a Hub repo.
 *
 * A decision model is recognised by its files, never its name: a decision
 * config (`rl_agent_config.json`, holding the prompt budget and calibration
 * temperatures), a `tokenizer.json`, and ONNX graphs that score one `[MASK]`
 * marker per answer option. Repos lay those out in many ways - one graph or an
 * encoder + head pair, in the root or a subfolder, weights inline or in
 * external data (possibly split into `.partNNN` chunks), several precisions
 * side by side - so every combination found becomes a variant to pick from.
 */

export const DECISION_CONFIG_FILE = "rl_agent_config.json";

export interface DecisionGraphFile {
	/** Repo path of the `.onnx` graph. */
	file: string;
	/** External weight files in load order; concatenated when chunked. */
	data: string[];
}

export type DecisionGraphs =
	| { layout: "single"; model: DecisionGraphFile }
	| { layout: "split"; encoder: DecisionGraphFile; head: DecisionGraphFile };

export interface DecisionModelVariant {
	/** Stable id inside the repo, e.g. `en/model_int4`. */
	id: string;
	/** Short human label, e.g. `en/model_int4` or `v1/encoder_q8 + head_q8`. */
	label: string;
	/** Repo path of the decision config. */
	config: string;
	tokenizer: string;
	tokenizerConfig?: string;
	graphs: DecisionGraphs;
	/** Download size of every graph and weight file, when the Hub reports it. */
	sizeBytes: number;
}

interface Sibling {
	rfilename: string;
	size?: number;
}

const dirname = (path: string) => {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
};

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

const within = (path: string, dir: string) =>
	dir === "" || path.startsWith(`${dir}/`);

/** `.data`, `_data`, `.data.part003`, `_data_1` after the graph's own name. */
const EXTERNAL_DATA_SUFFIX = /^(?:\.data|_data)(?:\.part(\d+)|_(\d+))?$/i;

function externalDataOf(graph: string, files: readonly string[]): string[] {
	return files
		.flatMap((file) => {
			if (!file.startsWith(graph)) return [];
			const match = EXTERNAL_DATA_SUFFIX.exec(file.slice(graph.length));
			if (!match) return [];
			const order = Number(match[1] ?? match[2] ?? -1);
			return [{ file, order }];
		})
		.sort((left, right) => left.order - right.order)
		.map((entry) => entry.file);
}

/** `encoder_q8.onnx` -> `_q8`; null when the name is not an encoder/head. */
const splitSuffix = (name: string, part: "encoder" | "head") => {
	const lower = name.toLowerCase();
	return lower.startsWith(part) && lower.endsWith(".onnx")
		? name.slice(part.length, -".onnx".length)
		: null;
};

const labelOf = (root: string, graph: string) =>
	graph.slice(root ? root.length + 1 : 0).replace(/\.onnx$/i, "");

/**
 * Every runnable decision model in a repo, smallest download first.
 * Empty when the repo is not a typed-decision model.
 */
export function decisionVariantsOf(
	siblings: readonly Sibling[] = [],
): DecisionModelVariant[] {
	const files = siblings.map((sibling) => sibling.rfilename);
	const sizes = new Map(
		siblings.map((sibling) => [sibling.rfilename, sibling.size ?? 0]),
	);
	const roots = files
		.filter((file) => basename(file) === DECISION_CONFIG_FILE)
		.map(dirname);
	// A file belongs to the deepest root that contains it.
	const rootOf = (file: string) =>
		roots
			.filter((root) => within(file, root))
			.sort((left, right) => right.length - left.length)[0];

	const variants: DecisionModelVariant[] = [];
	for (const root of roots) {
		const owned = files.filter((file) => rootOf(file) === root);
		const tokenizer = [
			join(root, "tokenizer.json"),
			join(root, "tokenizer/tokenizer.json"),
		].find((path) => owned.includes(path));
		if (!tokenizer) continue;
		const tokenizerConfig = join(dirname(tokenizer), "tokenizer_config.json");
		const graphs = owned.filter((file) => /\.onnx$/i.test(file));
		const graphFile = (file: string): DecisionGraphFile => ({
			file,
			data: externalDataOf(file, owned),
		});
		const sizeOf = (...parts: DecisionGraphFile[]) =>
			parts
				.flatMap((part) => [part.file, ...part.data])
				.reduce((total, file) => total + (sizes.get(file) ?? 0), 0);
		const base = {
			config: join(root, DECISION_CONFIG_FILE),
			tokenizer,
			...(owned.includes(tokenizerConfig) ? { tokenizerConfig } : {}),
		};

		const paired = new Set<string>();
		for (const encoder of graphs) {
			const suffix = splitSuffix(basename(encoder), "encoder");
			if (suffix === null) continue;
			const head = graphs.find(
				(file) =>
					dirname(file) === dirname(encoder) &&
					splitSuffix(basename(file), "head") === suffix,
			);
			if (!head) continue;
			paired.add(encoder);
			paired.add(head);
			const encoderFile = graphFile(encoder);
			const headFile = graphFile(head);
			const id = `${labelOf(root, encoder)}+${labelOf(root, head)}`;
			variants.push({
				...base,
				id: root ? `${root}/${id}` : id,
				label: `${root ? `${root}/` : ""}${labelOf(root, encoder)} + ${labelOf(root, head)}`,
				graphs: { layout: "split", encoder: encoderFile, head: headFile },
				sizeBytes: sizeOf(encoderFile, headFile),
			});
		}

		for (const graph of graphs) {
			const name = basename(graph);
			// A lone encoder or head is half a model.
			if (
				paired.has(graph) ||
				splitSuffix(name, "encoder") !== null ||
				splitSuffix(name, "head") !== null
			) {
				continue;
			}
			const model = graphFile(graph);
			const label = `${root ? `${root}/` : ""}${labelOf(root, graph)}`;
			variants.push({
				...base,
				id: label,
				label,
				graphs: { layout: "single", model },
				sizeBytes: sizeOf(model),
			});
		}
	}
	return variants.sort(
		(left, right) =>
			left.sizeBytes - right.sizeBytes || left.id.localeCompare(right.id),
	);
}

/** The variant a model config asks for, else the smallest. */
export function selectedDecisionVariant(
	decision: { variants: DecisionModelVariant[]; variant?: string } | undefined,
): DecisionModelVariant | undefined {
	if (!decision?.variants.length) return undefined;
	return (
		decision.variants.find((variant) => variant.id === decision.variant) ??
		decision.variants[0]
	);
}
