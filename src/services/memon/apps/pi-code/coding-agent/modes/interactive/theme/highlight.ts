/**
 * The `highlight` / `supportsLanguage` pair pi's theme takes from
 * cli-highlight, built on Prism so it runs in the browser. Token kinds map to
 * the same theme keys cli-highlight uses (keyword, string, comment, ...).
 */
import "./prism-setup";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sass";
import "prismjs/components/prism-less";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-r";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-clojure";
import "prismjs/components/prism-elixir";
import "prismjs/components/prism-erlang";
import "prismjs/components/prism-haskell";
import "prismjs/components/prism-ocaml";
import "prismjs/components/prism-vim";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-protobuf";
import "prismjs/components/prism-hcl";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-makefile";
import "prismjs/components/prism-cmake";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-ini";

/** cli-highlight theme keys pi's theme fills in. */
export type HighlightTheme = Record<string, (text: string) => string>;

/** cli-highlight / highlight.js language names that Prism spells differently. */
const LANGUAGE_ALIASES: Record<string, string> = {
	html: "markup",
	xml: "markup",
	svg: "markup",
	shell: "bash",
	sh: "bash",
	zsh: "bash",
	fish: "bash",
	dockerfile: "docker",
	javascript: "javascript",
	js: "javascript",
	ts: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	cs: "csharp",
	"c++": "cpp",
	yml: "yaml",
	md: "markdown",
	toml: "toml",
	tf: "hcl",
};

/** Prism token kinds → cli-highlight theme keys. */
const TOKEN_THEME_KEYS: Record<string, string> = {
	comment: "comment",
	prolog: "comment",
	doctype: "comment",
	cdata: "comment",
	keyword: "keyword",
	important: "keyword",
	atrule: "keyword",
	rule: "keyword",
	builtin: "built_in",
	"class-name": "class",
	tag: "type",
	selector: "type",
	namespace: "type",
	boolean: "literal",
	constant: "literal",
	symbol: "literal",
	null: "literal",
	nil: "literal",
	number: "number",
	string: "string",
	char: "string",
	"template-string": "string",
	"attr-value": "string",
	regex: "string",
	url: "string",
	function: "function",
	"function-variable": "function",
	method: "function",
	macro: "function",
	"attr-name": "attr",
	property: "attr",
	variable: "variable",
	parameter: "params",
	operator: "operator",
	entity: "operator",
	punctuation: "punctuation",
	deleted: "deletion",
	inserted: "addition",
};

const resolveLanguage = (lang: string): string =>
	LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();

export function supportsLanguage(lang: string): boolean {
	return Boolean(Prism.languages[resolveLanguage(lang)]);
}

/** Color one piece of text, line by line so styles never span a newline. */
const paint = (text: string, style?: (text: string) => string): string =>
	style
		? text
				.split("\n")
				.map((line) => (line ? style(line) : line))
				.join("\n")
		: text;

function render(
	stream: Prism.TokenStream,
	theme: HighlightTheme,
	inherited?: (text: string) => string,
): string {
	if (typeof stream === "string") return paint(stream, inherited);
	if (Array.isArray(stream)) {
		return stream.map((part) => render(part, theme, inherited)).join("");
	}
	const kinds = [
		stream.type,
		...(Array.isArray(stream.alias)
			? stream.alias
			: stream.alias
				? [stream.alias]
				: []),
	];
	const key = kinds
		.map((kind) => TOKEN_THEME_KEYS[kind])
		.find((value) => value && theme[value]);
	return render(stream.content, theme, key ? theme[key] : inherited);
}

export function highlight(
	code: string,
	options: {
		language: string;
		theme: HighlightTheme;
		ignoreIllegals?: boolean;
	},
): string {
	const grammar = Prism.languages[resolveLanguage(options.language)];
	if (!grammar) return code;
	return render(Prism.tokenize(code, grammar), options.theme);
}
