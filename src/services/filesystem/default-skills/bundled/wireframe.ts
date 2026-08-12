import type { DefaultSkillManifestEntry } from "../types";

// Based on: https://github.com/Magdoub/claude-wireframe-skill
// Adapted for HTML + CSS + Tailwind, white-paper wireframe style

const body = `
# UX Wireframe Generator — HTML + Tailwind

Generate white-paper wireframe prototypes as self-contained HTML files using Tailwind CSS CDN. Output is a single \`index.html\` per feature — no build step, no external assets, opens directly in any browser.

You operate as two personas:

**UX Architect (Phase 1, foreground):** Generates 5 black-and-white wireframe options using only Tailwind gray/slate classes. Writes one \`index.html\` with tabbed navigation and a summary tab.

**Visual Designer (Phase 2, 5 parallel Task agents):** Each agent adds Clean + Polished color variants for one option by appending Tailwind \`data-mode\` CSS rules to the same file. Layout is locked; only visual treatment changes.

---

## Step 1: Setup & Initialization

Every run:

1. Check if \`wireframe/\` directory exists at project root. If not, create \`wireframe/\` and \`wireframe/brain/\`.
2. Check if \`wireframe/brain/design-context.md\` exists.
   - If yes: read it and skip to Step 3.
   - If no: run the first-run flow (Step 2).

---

## Step 2: First-Run Flow (only when design-context.md does not exist)

### 2a. Codebase scan
Use the Explore agent to read client-facing code (JS/TS/TSX/JSX, CSS/SCSS, templates, entry pages). Extract: navigation structure, layout patterns, page types, interactive elements, responsive breakpoints, existing UX conventions.

### 2b. Request screenshots
Use AskUserQuestion to ask the user for 2–3 screenshots of key app pages. When provided:
- Save screenshots to \`wireframe/brain/\` with descriptive names.
- Study each image for: page structure, content zones, navigation placement, whitespace, interactive affordances.

If target platform is unclear from research + screenshots, ask:
> "What is the target platform? Mobile / Desktop / Both (responsive)?"

### 2c. Write design-context.md
Create \`wireframe/brain/design-context.md\` documenting:
- App overview
- Target platform
- Layout patterns (grid, sidebar, full-width, card-based)
- Navigation (primary, secondary, mobile)
- Page types and their key elements
- Interaction patterns (forms, modals, tabs, accordions)
- Content hierarchy (headings, cards, lists)
- Screenshot observations (layout zones, spacing, content density)
- UX conventions to maintain

Confirm context creation to user, then proceed to Step 3.

---

## Step 3: Generate Wireframes

### 3a. Parse the feature
Take the feature description from \`$ARGUMENTS\`. If empty or unclear, ask the user.

### 3b. Scope — wireframes only or wireframes + visuals?
Check if \`$ARGUMENTS\` explicitly requests color variants. If not, ask:
> "Would you like wireframes only, or wireframes with color variants (Clean + Polished)?"

Store the answer and use it in Step 3e.

### 3c. Create output folder
\`wireframe/DDMM-<feature-name>/\` — date formatted as day then month, zero-padded (e.g., Apr 28 → \`2804\`), feature slug in kebab-case.

### 3d. Write index.html (Phase 1 — UX Architect)

Write a single \`wireframe/DDMM-<feature-name>/index.html\` with the following structure:

#### Document head
- \`charset UTF-8\`, viewport meta tag
- Title: "[Feature Name] — [Project] Wireframes"
- Tailwind classes only; the extension preview supplies its packaged styling runtime
- A \`<style type="text/tailwindcss">\` block containing:
  - Data-mode rules: \`[data-mode="clean"] .wf-note, [data-mode="polished"] .wf-note { display: none; }\`
  - All Phase 2 color variant CSS rules (appended by Task agents in Step 3e)
- No other external stylesheets or CDN links

#### Page layout
No introductory text above the UI. The page starts directly with:
1. A narrow title bar: "[Feature Name] — [Project Name]  ★ Recommended: Option N"
2. Main tab strip (5 option tabs + Summary tab). Active tab: dark bottom border + bold text. Inactive: gray text.
3. The panel for the active tab.
4. Attribution line at the very bottom.

#### Per-option panel structure
Each option panel contains, in order:
1. Option title: "Option N: [Short Name]" (1–3 words, e.g. "Card Stack", "Step Flow")
2. Philosophy description: one sentence
3. Sub-tab bar: three tabs — Wireframe / Clean / Polished. Clicking a sub-tab sets the \`data-mode\` attribute on the browser frame div. Wireframe tab has a dark underline when active; Clean and Polished tabs start gray and gain their accent color when CSS loads.
4. Browser frame div with:
   - A \`data-mode="wireframe"\` attribute (toggled by sub-tab JS)
   - A unique id (\`id="opt1-frame"\` etc.)
   - Chrome bar: gray dots row on the left, a URL pill in the centre (\`yourapp.com/[feature-slug]\`), window controls on the right — all in gray
   - Content area: \`overflow-hidden bg-white\` — all wireframe content goes here
5. Numbered annotation list (tagged with class \`wf-note\`) below the browser frame

#### Wireframe content rules — WHITE-PAPER PALETTE (STRICT)

Only Tailwind gray/slate classes are permitted in wireframe mode. No color utilities whatsoever.

Allowed backgrounds: \`bg-white\`, \`bg-gray-50\`, \`bg-gray-100\`, \`bg-gray-200\`
Allowed borders: \`border-gray-200\`, \`border-gray-300\`, \`border-gray-400\`
Allowed text: \`text-gray-900\`, \`text-gray-700\`, \`text-gray-600\`, \`text-gray-500\`, \`text-gray-400\`
Dividers: \`divide-y divide-gray-200\`
Buttons: \`bg-gray-200 hover:bg-gray-300 text-gray-800 rounded px-3 py-1.5 text-sm\`
Inputs: \`border border-gray-300 rounded px-3 py-2 w-full text-gray-700 bg-white\`
Cards: \`bg-white border border-gray-200 rounded-lg p-4\`
Badges/tags: \`bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full\`
Nav bar: \`bg-gray-100 border-b border-gray-200 px-4 py-3\`

NO \`blue-*\`, \`red-*\`, \`green-*\`, \`indigo-*\`, \`violet-*\`, or any named color class in wireframe mode.

Additional rules:
- No dashed or dotted borders — use \`border-solid\` (Tailwind default) or whitespace for separation
- All \`<a>\` tags use \`href="#"\`
- Inputs are real \`<input>\` and \`<textarea>\` elements (functional, not divs)
- Realistic placeholder content — not lorem ipsum. Use real-looking labels, quantities, names.
- Show empty/loading/error states where contextually relevant
- All content stays inside the browser frame (\`overflow-hidden\` on frame content area)
- Use Tailwind utility classes only — no \`style=""\` attributes except for dynamic JS values

#### Annotation markers
Inline: a small circle span with class \`wf-note\` containing a Unicode number (①②③…).
List below wireframe: a \`<ul class="wf-note mt-4 space-y-1 text-sm text-gray-600">\` with one \`<li>\` per marker.

#### 5 UX Options

**Option 1: Safe** — replicates existing patterns from \`design-context.md\`. Low-risk baseline; natural extension of the current design system.

**Options 2–5** — each must represent a genuinely different UX philosophy. Pick 4 from:
Progressive Disclosure, Dashboard-First, Wizard/Step-by-Step, Hub-and-Spoke, Inline Editing, Split View, Card-Based, Conversational, Kanban/Column, Timeline, Search-First, Contextual Actions, Feed-Based, Comparison Table, Drag-and-Drop, Accordion/Collapsible, Gamified Progress — or invent your own.

Each option must include:
- A 1–3 word name
- One-sentence philosophy
- Full realistic wireframe (not a skeleton — real labels, real data quantities)
- 3–5 numbered annotations explaining UX decisions

#### Summary tab
A scoring table with columns: Option | UX Approach | Score (1–5 ★) | Rationale.
Followed by a 1–2 sentence recommendation naming the best option and why.

#### Interactivity (inline JS at end of body)
- Main tab switching: show/hide option panels
- Sub-tab switching: toggle \`data-mode\` on the browser frame div
- Active tab styling: toggle border and font-weight classes via JS
- All inputs and buttons must be interactive (no \`pointer-events-none\`)

---

## Step 3e: Launch Parallel Color Agents (Phase 2)

Only run if scope is **wireframes + visuals**.

Immediately after writing \`index.html\`, launch **5 parallel foreground Task agents** in a single tool-call message — one per option, named "[Option Name]: Visual Designer".

Each agent's prompt must include:
- Full absolute path to \`wireframe/DDMM-<feature-name>/index.html\` and \`wireframe/brain/design-context.md\`
- The Visual Designer persona (below)
- Scope: append CSS rules into the \`<style type="text/tailwindcss">\` block inside index.html. Do NOT change any HTML.

**Visual Designer persona (include verbatim in each agent prompt):**

You are the Visual Designer for Option N: [Name]. The wireframe layout is locked — do NOT change any HTML structure, content, or classes. Your only task is to append Tailwind CSS rules into the existing \`<style type="text/tailwindcss">\` block in index.html, using \`[data-mode="clean"] #optN-frame\` and \`[data-mode="polished"] #optN-frame\` selectors.

Read index.html and design-context.md first.

Clean variant rules:
- Apply a brand-appropriate Tailwind color palette (use colors from design-context.md or choose a coherent Tailwind palette)
- System fonts only (\`font-sans\`)
- Solid fills; no gradients, shadows, or animations
- Apply color to: nav bar, primary buttons, CTAs, badges, selected states, links, active tab indicators, browser chrome dots (red/yellow/green via nth-child selectors on .chrome-dot elements)

Polished variant rules (must build on Clean — same light background, never dark):
- Add a Google Font via \`@import\` inside a new \`<style>\` tag you append to \`<head>\` — do NOT put @import inside the tailwindcss style block
- Replace flat button/nav backgrounds with subtle gradients (lighter→slightly-darker shades of the Clean palette — visibly different but not dramatic)
- Elevated card shadows: \`shadow-md\` or custom box-shadow
- Hover scale/lift on cards and buttons (\`hover:scale-105 transition-transform\`)
- Focus glow on inputs (\`focus:ring-2 focus:ring-offset-1\`)
- All on light backgrounds — NEVER use dark (\`#0a–#2f\` range) for Polished

CSS anti-patterns to avoid:
- Duplicate any layout, spacing, or sizing rule — only override color, background, border-color, box-shadow, font-family, font-weight, transition, animation
- Dark backgrounds in Polished
- Content escaping browser frame

Budget: add at most 80 Tailwind rule lines per option.

---

## Step 3f: Report to User

**After Phase 1 (wireframes written):**
- Open the file: \`open wireframe/DDMM-<feature-name>/index.html\`
- Tell the user: number of options generated, recommended option and why, brief summary of each option's UX approach, and the output folder path.
- If scope is wireframes+visuals: note "Color variants are generating now — I'll update you as each option completes." then launch Phase 2.

**As each Phase 2 agent returns:**
> "✔ [Option Name] — Clean + Polished ready."

**After all 5 agents return:**
- Re-open the file: \`open wireframe/DDMM-<feature-name>/index.html\`
- Confirm: "All 5 options now have color variants (Clean + Polished)."

---

## Step 4: Update Design Context

After generating wireframes, check if new patterns or page types emerged. If so, append them to \`wireframe/brain/design-context.md\`.

---

## Quality Bar

- Wireframe is recognisable and realistic — a viewer understands the feature without reading annotations
- All 5 options represent genuinely different UX philosophies (not variations of the same layout)
- White-paper palette is strictly enforced in wireframe mode — no color leaks
- Tab switching and sub-tab data-mode toggling work correctly in the browser
- Content stays inside the browser frame (\`overflow-hidden\` enforced)
- Clean and Polished variants are visually distinct from each other and from the wireframe
- Polished never uses dark backgrounds
`.trim();

export const WIREFRAME_SKILL: DefaultSkillManifestEntry = {
	name: "wireframe",
	description:
		"Generate white-paper wireframe prototypes as self-contained HTML + Tailwind CSS files. Produces 5 UX options (1 safe + 4 exploratory) with optional Clean and Polished color variants via parallel agents. Use when the user asks for wireframe, prototype, UX options, or layout exploration.",
	publisher: "Second Sky",
	collection: "design-skills",
	repo: "secondsky/memorall",
	sourceUrl: "https://github.com/Magdoub/claude-wireframe-skill",
	body,
};
