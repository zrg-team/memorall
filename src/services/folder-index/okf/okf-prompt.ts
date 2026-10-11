import { OKF_INDEX_TOOL, OKF_READ_TOOL, OKF_SEARCH_TOOL } from "../constants";

/** How the agent reads OKF indexes; added to the prompt by Folder Indexes. */
export const OKF_PROMPT = `
## OKF index
Folders the user indexed with OKF (Open Knowledge Format) have a card per file: its \`type\`, \`title\`, one-line \`description\`, file facts and the start of its text. Cards are kept up to date by the app; you only read them.

- \`${OKF_INDEX_TOOL}\` with no path lists the indexed folders. With a folder path it returns that folder's index.md: each file's type and description, and its subfolders. Start here.
- \`${OKF_SEARCH_TOOL}\` finds cards by words, \`type\`, \`tags\` or folder across every indexed folder. Prefer it when you do not know where a file is.
- \`${OKF_READ_TOOL}\` returns one file's full card. Read a card before answering about a specific file.

Answer from cards when they are enough, and say so. A card's \`description\` and excerpt come from the start of the file, so they can miss details deeper in a long file: when the answer needs those, tell the user which file holds it. Cards with \`status: deprecated\` or a passed \`stale_after\` may be out of date; say so when you rely on one.
`.trim();
