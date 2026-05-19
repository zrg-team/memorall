# OpenUI Integration Plan

## What OpenUI Actually Is (from shadcn-chat)

The LLM's **text response IS the OpenUI Lang markup** — not a tool call, not metadata, just streaming text:

```
root = Card(
  TextContent("Weather in Tokyo"),
  Alert("22°C, Sunny", "info"),
  FollowUpBlock([FollowUpItem("Check forecast")])
)
```

The frontend accumulates this text as it streams and passes it to `<Renderer>` from `@openuidev/react-lang`, which renders it as React components progressively.

**Tools** (get_weather, get_stock_price, etc.) are for **data fetching only** — the LLM calls them first to get data, then embeds the data directly into the OpenUI markup. Tools are not involved in rendering.

**The agent "sees" the UI** through its own message history — it wrote the OpenUI Lang, so it knows exactly what is rendered. For a follow-up ("show more detail"), the user sends another message, the LLM generates new/updated OpenUI Lang, and the renderer re-renders.

---

## Corrected Architecture Fit

| OpenUI Concept | Memorall Equivalent |
|---|---|
| System prompt (component catalog) | Hardcoded string in `visualize-response` step — no CLI |
| LLM generates OpenUI Lang as TEXT response | Streams through existing text delta path — untouched |
| Data tools (get_weather, etc.) | New tools added to `state.tools` — knowledge graph queries |
| `<Renderer>` + component library | New `<OpenUIRenderer>` wrapping `@openuidev/react-lang` |
| Frontend detects OpenUI vs plain text | Check if accumulated content starts with OpenUI pattern |
| Agent iterates on UI | User sends follow-up → LLM generates new markup → renderer replaces |
| `Query()` autonomous fetching | Optional: wire to extension message bus (Phase 4) |

**Zero changes to:** graph state, graph structure, `process-chat.ts`, `StreamBuffer`, chunk types.

---

## Packages

```bash
npm install @openuidev/react-lang @openuidev/react-headless
```

| Package | Purpose |
|---|---|
| `@openuidev/react-lang` | `defineComponent()`, `<Renderer>`, parser |
| `@openuidev/react-headless` | `openAIMessageFormat` utilities (optional, for message format helpers) |

No `@openuidev/openui-cli` — system prompt is a hardcoded TypeScript string.

---

## Phase 1 — Component Library

**Goal:** Define what components the LLM can generate, as React renderers. All use components from `src/main/components/ui/`.

### Shadcn components already available

| File | Exports used |
|---|---|
| `ui/card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `ui/badge.tsx` | `Badge` (variants: `default` `secondary` `destructive` `outline` `pill` `chip` `warm`) |
| `ui/button.tsx` | `Button` (variants: `default` `outline` `secondary` `ghost`; sizes: `default` `sm` `lg`) |
| `ui/alert.tsx` | `Alert`, `AlertTitle`, `AlertDescription` (variants: `default` `destructive`) |
| `ui/progress.tsx` | `Progress` |
| `ui/tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| `ui/dialog.tsx` | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle` |
| `ui/carousel.tsx` | `Carousel`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext` |
| `ui/collapsible.tsx` | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` |
| `ui/select.tsx` | `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` |
| `ui/input.tsx` | `Input` |
| `ui/switch.tsx` | `Switch` |
| `ui/textarea.tsx` | `Textarea` |
| `ui/separator.tsx` | `Separator` |
| `ui/scroll-area.tsx` | `ScrollArea` |
| `ui/avatar.tsx` | `Avatar`, `AvatarImage`, `AvatarFallback` |
| `ui/shadcn-io/code-block/index.tsx` | `CodeBlock`, `CodeBlockHeader`, `CodeBlockBody`, `CodeBlockContent`, `CodeBlockCopyButton` |

### Shadcn components to ADD

Two components not yet in the project:

```bash
# Add via shadcn CLI or copy from shadcn/ui registry
npx shadcn@latest add table    # → src/main/components/ui/table.tsx
npx shadcn@latest add chart    # → src/main/components/ui/chart.tsx (recharts wrapper)
```

Also install recharts (for chart component):
```bash
npm install recharts
```

### OpenUI component definitions

**File structure:**
```
src/main/modules/openui/                ← UI only, runs in popup context
├── components/
│   ├── content.tsx     # CardBlock, TextContent, AlertBlock, BadgeBlock, ProgressBlock, CodeBlockComp, SeparatorBlock
│   ├── charts.tsx      # BarChartBlock, LineChartBlock, PieChartBlock, TableBlock, Col
│   ├── interactive.tsx # ButtonBlock, ButtonsBlock, TabsBlock, TabItem, CollapsibleBlock, DialogBlock, CarouselBlock
│   ├── forms.tsx       # FormBlock, InputBlock, SelectBlock, SelectItemBlock, SwitchBlock, TextareaBlock
│   └── knowledge.tsx   # KnowledgeCard, FactList, Timeline, EntityList, TopicSummary, FollowUpBlock, FollowUpItem
├── OpenUIRenderer.tsx  # <Renderer> wrapper + isOpenUILang() detection helper
└── index.ts            # exports componentLibrary map

src/services/flows/steps/features/visualize-response/
├── index.ts            # LangGraph step — headless, no DOM, runs in service worker
└── prompt.ts           # Hardcoded system prompt string (pure TS string, no DOM)
```

> **Why split:** `src/services/` runs in the service worker and offscreen contexts — no DOM, no React. The step + prompt string are headless and belong there. React component definitions only run in the popup and belong in `src/main/modules/openui/`.

**Example — CardBlock (root container):**
```ts
// src/main/modules/openui/components/content.tsx
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/main/components/ui/card";

export const CardBlock = defineComponent({
  name: "CardBlock",
  description: "Primary container. Always use as root. Wrap all other components inside.",
  props: z.object({
    title: z.string().optional().describe("Card heading"),
    children: z.array(z.any()),
  }),
  component: ({ props, renderNode }) => (
    <Card>
      {props.title && (
        <CardHeader><CardTitle>{props.title}</CardTitle></CardHeader>
      )}
      <CardContent className="space-y-3 pt-0">
        {renderNode(props.children)}
      </CardContent>
    </Card>
  ),
});
```

**Example — TableBlock:**
```ts
// src/main/modules/openui/components/charts.tsx
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/main/components/ui/table";

export const TableBlock = defineComponent({
  name: "TableBlock",
  description: "Data table. columns is array of Col(), rows is 2D array of strings.",
  props: z.object({
    columns: z.array(z.any()),
    rows: z.array(z.array(z.string())),
  }),
  component: ({ props }) => (
    <Table>
      <TableHeader>
        <TableRow>{props.columns.map((c: any) => <TableHead key={c.props.header}>{c.props.header}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row, i) => (
          <TableRow key={i}>{row.map((cell, j) => <TableCell key={j}>{cell}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  ),
});
```

**Example — KnowledgeCard (domain-specific):**
```ts
// src/main/modules/openui/components/knowledge.tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/main/components/ui/card";
import { Badge } from "@/main/components/ui/badge";
import { Separator } from "@/main/components/ui/separator";

export const KnowledgeCard = defineComponent({
  name: "KnowledgeCard",
  description: "Shows a single knowledge entity with its type badge and list of facts.",
  props: z.object({
    name: z.string().describe("Entity name"),
    entityType: z.string().describe("Entity type e.g. Person, Concept, Project"),
    facts: z.array(z.string()).describe("List of fact strings about this entity"),
    summary: z.string().optional(),
  }),
  component: ({ props }) => (
    <Card>
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">{props.name}</CardTitle>
        <Badge variant="secondary">{props.entityType}</Badge>
      </CardHeader>
      {props.summary && (
        <CardContent className="pt-0 text-sm text-muted-foreground">{props.summary}</CardContent>
      )}
      {props.facts.length > 0 && (
        <CardContent className="pt-0">
          <Separator className="mb-3" />
          <ul className="space-y-1">
            {props.facts.map((f, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-muted-foreground">•</span>{f}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  ),
});
```

### Full component catalog

| OpenUI Name | Built with | Description |
|---|---|---|
| `CardBlock` | `Card` | Root container — always the root |
| `TextContent` | `<p>` | Text paragraph with optional size (`sm` `base` `lg`) |
| `AlertBlock` | `Alert` | Info/warning/error callout with title and message |
| `BadgeBlock` | `Badge` | Inline label with variant (`default` `secondary` `destructive` `outline`) |
| `ProgressBlock` | `Progress` | Progress bar with value 0–100 and optional label |
| `SeparatorBlock` | `Separator` | Horizontal divider |
| `CodeBlockComp` | `CodeBlock` (shadcn-io) | Syntax-highlighted code block with language and copy button |
| `TableBlock` + `Col` | `table.tsx` (add) | Data table with header columns and 2D row data |
| `BarChartBlock` | `chart.tsx` + recharts | Vertical bar chart with categories and values |
| `LineChartBlock` | `chart.tsx` + recharts | Line chart for trends |
| `PieChartBlock` | `chart.tsx` + recharts | Pie/donut chart for proportions |
| `ButtonBlock` | `Button` | Single clickable button with label and variant |
| `ButtonsBlock` | `Button` | Row of buttons |
| `TabsBlock` + `TabItem` | `Tabs` | Tabbed content panels |
| `CollapsibleBlock` | `Collapsible` | Expandable section with trigger label |
| `DialogBlock` | `Dialog` | Button that opens a modal with content |
| `CarouselBlock` | `Carousel` | Horizontally scrollable card carousel |
| `SelectBlock` + `SelectItemBlock` | `Select` | Dropdown selector |
| `InputBlock` | `Input` | Text input with label |
| `SwitchBlock` | `Switch` | Toggle switch with label |
| `TextareaBlock` | `Textarea` | Multi-line text input |
| `KnowledgeCard` | `Card` + `Badge` + `Separator` | Entity name, type badge, list of facts |
| `FactList` | `Card` + list | Subject → predicate → object fact triples |
| `Timeline` | `Card` + vertical list | Chronological events with dates |
| `EntityList` | `TableBlock` or list | Compact list of entity names + types |
| `TopicSummary` | `Card` + `Badge` + `Progress` | Stats card for a knowledge topic |
| `FollowUpBlock` + `FollowUpItem` | `Button` | Suggested follow-up prompts the user can click |

### System prompt (`src/services/flows/steps/features/visualize-response/prompt.ts`)

Hardcoded TS string — lives in services because it's consumed by the LangGraph step (headless, no DOM). Contains:
- OpenUI Lang syntax rules (root first, positional args, line-oriented)
- Every component: name, props schema, one usage example
- When to use visualizations vs plain text
- Memorall-specific guidance (use `KnowledgeCard` / `FactList` / `Timeline` for knowledge graph responses)

### Key Files
- `src/main/components/ui/table.tsx` (add via shadcn CLI)
- `src/main/components/ui/chart.tsx` (add via shadcn CLI)
- `src/main/modules/openui/components/content.tsx` (new)
- `src/main/modules/openui/components/charts.tsx` (new)
- `src/main/modules/openui/components/interactive.tsx` (new)
- `src/main/modules/openui/components/forms.tsx` (new)
- `src/main/modules/openui/components/knowledge.tsx` (new)
- `src/main/modules/openui/index.ts` (new)
- `src/services/flows/steps/features/visualize-response/prompt.ts` (new)

---

## Phase 2 — Feature Step (`visualize-response`)

**Goal:** One step, one file. Injects system prompt + knowledge graph data tools into the existing flow.

**File:** `src/services/flows/steps/features/visualize-response/index.ts`

The step runs before `chat-completion`. It does two things:

### 1. Append system message

```ts
state.messages.push({
  role: "system",
  content: OPENUI_SYSTEM_PROMPT, // imported from ./prompt.ts (same directory)
});
```

Same pattern as the existing `add-system` step.

### 2. Push knowledge data tools into `state.tools`

These are the tools the LLM calls to **fetch data** before generating OpenUI markup — same pattern as `get_weather` / `get_stock_price` in the example:

| Tool | Description | Returns |
|---|---|---|
| `search_knowledge` | Search entities by query | `[{ id, name, type, summary }]` |
| `get_entity` | Full detail for one entity | `{ id, name, type, facts[], relatedEntities[] }` |
| `get_topic_facts` | All facts for a topic | `[{ subject, predicate, object, date? }]` |
| `get_recent_entities` | Recently saved entities | `[{ id, name, type, savedAt }]` |

The LLM calls these tools first (via the existing agent tool loop), gets the data, then generates OpenUI Lang markup embedding that data directly — exactly how `get_weather` works in the example.

### Registration

```ts
stepRegistry.register("visualize-response", factory, {
  description: "Enables LLM to generate interactive UI components using OpenUI Lang",
  enabledByDefault: false,
  injectAfter: "add-system",
  defaultStateMapping: { messages: "messages", tools: "tools" },
});
```

### Feature catalog entry

```ts
// src/services/flows/steps/features/feature-catalog-registry.ts
{
  name: "visualize-response",
  displayName: "Visualize Response",
  description: "LLM generates interactive UI components instead of plain text",
  type: "response-format",
  nameKey: "feature.visualize_response",
  steps: ["visualize-response"],
}
```

### What does NOT change
- All graph state files — untouched
- All graph files — untouched
- `process-chat.ts` — untouched
- `StreamBuffer` — untouched

### Key Files
- `src/services/flows/steps/features/visualize-response/index.ts` (new)
- `src/services/flows/steps/features/feature-catalog-registry.ts` (add entry)
- Translation files for `feature.visualize_response`

---

## Phase 3 — Frontend Rendering

**Goal:** Render OpenUI Lang in the popup (`src/main/`). Show a "not supported" fallback in the embedded content script (`src/embedded/`).

### Shared detection utility

**File:** `src/utils/openui.ts` — accessible from both `src/main/` and `src/embedded/`

```ts
// OpenUI Lang always starts with a variable assignment: `identifier = ComponentName(`
export function isOpenUILang(content: string): boolean {
  const firstLine = content.trimStart().split("\n")[0];
  return /^\w+\s*=\s*\w+\(/.test(firstLine);
}
```

---

### Popup: `OpenUIRenderer` (full rendering)

**File:** `src/main/modules/openui/OpenUIRenderer.tsx`

```tsx
import { Renderer } from "@openuidev/react-lang";
import { componentLibrary } from "@/main/modules/openui/index";

export function OpenUIRenderer({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <ErrorBoundary fallback={<MarkdownRenderer content={content} />}>
      <Renderer content={content} componentLibrary={componentLibrary} streaming={streaming} />
    </ErrorBoundary>
  );
}
```

**`MessageGroup.tsx` changes** (`src/main/modules/chat/components/MessageGroup.tsx`):
- Check `isOpenUILang(message.content)` on completed assistant messages → `<OpenUIRenderer streaming={false} />`
- Check `isOpenUILang(inProgressMessage.content)` during streaming → `<OpenUIRenderer streaming={true} />`
- Otherwise: existing markdown renderer — no regression

---

### Embedded: "Not supported" notice

The embedded context is a content script injected into web pages. It uses isolated shadow DOM styles and cannot safely run `@openuidev/react-lang` or the shadcn chart/table dependencies.

**`AssistantMessageContent.tsx` change** (`src/embedded/components/messages/AssistantMessageContent.tsx`):

```tsx
import { isOpenUILang } from "@/utils/openui";
import { openStandalonePage } from "@/utils/open-standalone";

export const AssistantMessageContent: React.FC<{ content: string; isStreaming: boolean }> = ({ content, isStreaming }) => {
  if (isOpenUILang(content)) {
    return (
      <div className="memorall-openui-notice">
        <span className="memorall-openui-notice__icon">⊞</span>
        <span className="memorall-openui-notice__text">
          This response contains an interactive visualization
        </span>
        <button
          className="memorall-openui-notice__button"
          onClick={() => openStandalonePage()}
        >
          Open full view
        </button>
      </div>
    );
  }

  // existing rendering below — unchanged
  const segments = parseArtifactSegments(content);
  ...
};
```

The notice uses embedded CSS class names (prefixed `memorall-`) — no shadcn classes, no Tailwind CSS variables. Style it in the embedded stylesheet.

---

### Key Files
- `src/utils/openui.ts` (new — shared between main and embedded)
- `src/main/modules/openui/OpenUIRenderer.tsx` (new)
- `src/main/modules/chat/components/MessageGroup.tsx` (add renderer switch)
- `src/embedded/components/messages/AssistantMessageContent.tsx` (add OpenUI notice)
- Embedded stylesheet: add `.memorall-openui-notice` styles

---

## Phase 4 — Knowledge `Query()` Bridge (Optional Enhancement)

**Goal:** Let OpenUI components fetch their own data autonomously via `Query()`, instead of requiring the LLM to embed all data upfront.

This follows the OpenUI Lang spec's `Query()` primitive — components declare their own data dependency and it resolves at render time.

### Query bridge

**File:** `src/services/openui/query-bridge.ts`

Wires OpenUI `Query()` calls to the extension message bus:

```ts
// component definition uses Query:
data = Query("get_entity", { id: "abc123" })
card = KnowledgeCard([data.name, data.facts])

// bridge translates the query key to a chrome.runtime.sendMessage call
// and returns the response to the renderer
```

Supported query keys mirror the tools from Phase 2:
`get_entity`, `search_knowledge`, `get_topic_facts`, `get_recent_entities`

### Benefit vs Phase 2 tools

| Phase 2 tools | Phase 4 Query bridge |
|---|---|
| LLM fetches data before generating markup | Component fetches its own data at render time |
| Data embedded statically in markup | Data always fresh when component mounts |
| Works with any LLM (no runtime dependency) | Requires query bridge wiring |
| Simpler | More dynamic |

**Phase 2 tools alone are sufficient for MVP.** Phase 4 is an enhancement for components that need live/interactive data.

### Key Files
- `src/main/modules/openui/query-bridge.ts` (new — runs in popup, uses `chrome.runtime.sendMessage`)

---

## Phase 5 — Prompt Tuning & Tests

### System prompt tuning

Add Memorall-specific few-shot examples to `prompt.ts`:

| User asks | LLM should generate |
|---|---|
| "Show me everything about React" | Calls `get_entity` → generates `KnowledgeCard` + `FactList` + `Timeline` |
| "What did I save last week?" | Calls `get_recent_entities` → generates `Table` of recent items |
| "Summarize my TypeScript notes" | Calls `get_topic_facts` → generates `Card` + `FactList` |
| "Find notes about performance" | Calls `search_knowledge` → generates `Table` with results |

### Tests

1. **Step test** — `visualize-response` step appends correct system message and pushes 4 tools into `state.tools`
2. **Detection test** — `isOpenUILang()` correctly identifies OpenUI Lang vs markdown
3. **Renderer test** — `OpenUIRenderer` renders a known OpenUI Lang string to the correct component tree
4. **Component tests** — each component renders with sample props
5. **Fallback test** — invalid OpenUI Lang falls back to markdown, no error thrown

---

## Rollout

```
Phase 1 (components + prompt)
    ↓
Phase 2 (feature step)      ← MVP: enables the full loop end-to-end
    ↓
Phase 3 (frontend renderer) ← MVP complete: renders in chat
    ↓
Phase 4 (Query bridge)      ← enhancement: live data in components
    ↓
Phase 5 (tuning + tests)
```

**Files changed in total:**
- 1 new npm package (`@openuidev/react-lang`)
- `src/services/openui/` — new directory, ~8 files
- `src/services/flows/steps/features/visualize-response/index.ts` — new, ~60 lines
- `src/services/flows/steps/features/feature-catalog-registry.ts` — add 1 entry
- `src/main/modules/chat/components/OpenUIRenderer.tsx` — new, ~25 lines
- `src/main/modules/chat/components/MessageGroup.tsx` — ~10 lines changed

Core infrastructure: **zero changes.**
