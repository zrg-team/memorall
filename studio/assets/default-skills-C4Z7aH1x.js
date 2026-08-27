import{n as e}from"./logger-BUo2gG75.js";import{t}from"./createLucideIcon-DMZCQHJW.js";import{C as n,F as r,L as i,M as a,N as o,P as s,S as c,_ as l,g as u,t as d,v as f,x as p}from"./services-Cpgqd42a.js";import{t as m}from"./react-Dlsnd8OS.js";import{n as h}from"./mcp-connections-cBYdM1Rw.js";var g=t(`copy`,[[`rect`,{width:`14`,height:`14`,x:`8`,y:`8`,rx:`2`,ry:`2`,key:`17jyea`}],[`path`,{d:`M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2`,key:`zix9uf`}]]),_=(e,t)=>{if(e===t)return!0;if(typeof e!=typeof t)return!1;if(e===null||t===null)return e===t;if(typeof e!=`object`)return!1;let n=Array.isArray(e),r=Array.isArray(t);if(n!==r)return!1;if(n&&r){if(e.length!==t.length)return!1;for(let n=0;n<e.length;n++)if(!_(e[n],t[n]))return!1;return!0}let i=e,a=t,o=Object.keys(i),s=Object.keys(a);if(o.length!==s.length)return!1;for(let e of o)if(!Object.prototype.hasOwnProperty.call(a,e)||!_(i[e],a[e]))return!1;return!0},v=[{id:`foundation`,nameKey:`agentSettings.graphAgent`,descKey:`agentSettings.graphAgentDesc`},{id:`agent`,nameKey:`agentSettings.graphSimpleAgent`,descKey:`agentSettings.graphSimpleAgentDesc`}],y=e=>e===`agent`?a:s,b=[{mode:`smart`,stepName:`context-smart-retrieve`},{mode:`quick`,stepName:`context-quick-retrieve`},{mode:`llm`,stepName:`context-llm-retrieve`},{mode:`structmem`,stepName:`structmem-retrieve`}],x=new Set(b.map(e=>e.stepName)),S=e=>b.find(t=>t.mode===e)?.stepName??`context-smart-retrieve`,C=e=>{let t=new Set(e.filter(e=>x.has(e.name)&&e.enabled).map(e=>e.name));return b.find(e=>t.has(e.stepName))?.mode??`smart`},w=e=>({...e,steps:e.steps.map(e=>({...e,config:e.config?{...e.config}:void 0}))});function T(e){return d.flowBuilderService.getCatalog().steps.filter(t=>t.type===`feature`&&(t.graphTypes?.includes(e)??!1)).map(e=>{let t=e.metadata;return{name:e.name,displayName:typeof t.displayName==`string`?t.displayName:e.name,nameKey:typeof t.nameKey==`string`?t.nameKey:void 0,description:t.description??e.name,descriptionKey:typeof t.descriptionKey==`string`?t.descriptionKey:void 0,tools:Array.isArray(t.tools)?t.tools.map(String):[],systemPrompt:typeof t.systemPrompt==`string`?t.systemPrompt:``,customizable:!!t.customizable,icon:t.icon&&typeof t.icon==`object`&&`name`in t.icon&&`type`in t.icon?t.icon:void 0,accentColor:typeof t.accentColor==`string`?t.accentColor:void 0,legacy:!!t.legacy,section:t.section===`core`||t.section===`other`?t.section:void 0,sectionOrder:typeof t.sectionOrder==`number`?t.sectionOrder:void 0,hideInGrid:!!t.hideInGrid,requiresAccessibleAgents:!!t.requiresAccessibleAgents,detailView:Array.isArray(t.detailView)?t.detailView:void 0}})}var E=e=>Object.fromEntries(e.map(e=>[e,!1])),D=e=>e.map(e=>e.name),O=e=>{let t=e.steps.find(e=>e.name===p);return Array.isArray(t?.config?.accessibleAgentIds)?t.config.accessibleAgentIds.filter(e=>typeof e==`string`):[]},k=e=>{let t=e.steps.find(e=>e.name===f);return Array.isArray(t?.config?.connections)?t.config.connections:[]},A=e=>{let t=e.steps.find(e=>e.name===n);return Array.isArray(t?.config?.enabledSkillNames)?t.config.enabledSkillNames.filter(e=>typeof e==`string`):[]},j=e=>{let t=e.graphType===`agent`?`agent`:`foundation`,n=T(t),i=D(n),a=E(i),s=u(t).steps.find(e=>e.name===`add-system`)?.config?.content??``,l=e.steps.find(e=>e.name===`add-system`),d=e.steps.find(e=>e.name===`agent-completion`),f=e.steps.find(e=>e.name===`entities-facts-citation`),p=e.steps.filter(e=>x.has(e.name)),m=p.find(e=>typeof e.config?.prompt==`string`)?.config?.prompt;for(let t of i)a[t]=!!e.steps.find(e=>e.name===t)?.enabled;return a[`knowledge-retrieval`]=p.some(e=>e.enabled),a.citations=f?.enabled??!0,a[`agent-node`]=!1,{graphType:t,featureDefinitions:n,multiAgentAccessibleAgentIds:O(e),connections:k(e),enabledSkillNames:A(e),config:{...o,graphType:t,systemPrompt:typeof l?.config?.content==`string`&&l.config.content!==s?l.config.content:``,contextPrompt:typeof m==`string`&&m!==c?m:``,tools:Array.isArray(d?.config?.tools)?d.config.tools.map(String):[],maxIterations:r(d?.config?.maxIterations),enableContextRetrieval:p.some(e=>e.enabled),retrievalMode:C(e.steps),enableCitations:typeof f?.enabled==`boolean`?f.enabled:o.enableCitations},features:a}},M=(e,t,n,i,a,o)=>{let s=t.graphType===`agent`?`agent`:`foundation`,c=e.graphType===s?w(e):u(s),l=u(s),d=l.steps.find(e=>e.name===`add-system`)?.config?.content??``,f=new Set(l.steps.filter(e=>x.has(e.name)&&e.enabled).map(e=>e.name)),p=new Set(c.steps.filter(e=>x.has(e.name)&&e.enabled).map(e=>e.name)),m=S(t.retrievalMode),h=new Set(D(T(s)));return n[`knowledge-retrieval`]&&p.size===0&&p.add(f.has(m)?m:S(t.retrievalMode)),{...c,graphType:s,steps:c.steps.map(e=>{let s={...e,config:e.config?{...e.config}:void 0};return e.name===`add-system`&&(s.config={...s.config??{}},s.config.content=t.systemPrompt.trim()||d),e.name===`agent-completion`&&(s.config={...s.config??{},tools:[...t.tools],maxIterations:r(t.maxIterations)}),x.has(e.name)&&(s.enabled=!!n[`knowledge-retrieval`]&&e.name===m,s.config={...s.config??{}},t.contextPrompt.trim()?s.config.prompt=t.contextPrompt:`prompt`in s.config&&delete s.config.prompt),e.name===`entities-facts-citation`&&(s.enabled=!!n.citations),h.has(e.name)&&(s.enabled=!!n[e.name]),e.name===`multi-agent-feature`&&(s.config={...s.config??{},accessibleAgentIds:[...i]}),e.name===`mcp-feature`&&(s.config={...s.config??{},connections:[...a]},delete s.config.servers),e.name===`add-skill-context`&&(s.config={...s.config??{},enabledSkillNames:[...o]}),s.config&&Object.keys(s.config).length===0&&(s.config=void 0),s})}},N=(e,t,n,r,i,a,o,s,c,l)=>!_(e,t)||!_(n,r)||!_(i,a)||!_(o,s)||!_(c,l),P=m((t,n)=>{let a=async()=>{t({isSaving:!0,error:null});try{let{draftConfig:e,draftFeatures:r,draftMultiAgentAccessibleAgentIds:i,draftConnections:a,draftEnabledSkillNames:o,savedUnifiedConfig:s}=n(),c=n().currentFlowId,f=M(s&&(s.graphType===e.graphType||s.graphType!==`agent`&&e.graphType===`foundation`)?l(s,e.graphType):u(e.graphType),e,r,i,a,o);c?await d.flowBuilderService.saveUnifiedFlowConfig({flowId:c},f):await d.flowBuilderService.saveUnifiedFlowConfig({predefinedFlow:`foundation`},f),t({savedConfig:{...e},savedUnifiedConfig:f,savedFeatures:{...r},savedMultiAgentAccessibleAgentIds:[...i],savedConnections:[...a],savedEnabledSkillNames:[...o],isDirty:!1,isSaving:!1,isLegacyConfig:!1})}catch(n){e(`[AgentConfigStore] Failed to save unified config:`,n),t({error:n instanceof Error?n.message:`Failed to save unified config`,isSaving:!1})}};return{savedConfig:{...o},draftConfig:{...o},savedUnifiedConfig:null,savedFeatures:{},draftFeatures:{},featureDefinitions:[],availableTools:[],availableAgents:[],savedMultiAgentAccessibleAgentIds:[],draftMultiAgentAccessibleAgentIds:[],savedConnections:[],draftConnections:[],savedEnabledSkillNames:[],draftEnabledSkillNames:[],currentFlowId:null,currentGraphType:`foundation`,isLegacyConfig:!1,isOpen:!1,isLoading:!1,isSaving:!1,isDirty:!1,error:null,open:e=>{let r=n();r.isOpen?e&&e!==r.currentFlowId&&!r.isLoading&&r.initialize(e):(t({isOpen:!0}),r.isLoading||r.initialize(e??r.currentFlowId))},close:()=>t({isOpen:!1}),initialize:async a=>{t({isLoading:!0,error:null});try{let s=a??n().currentFlowId,c=s?{flowId:s}:{predefinedFlow:`foundation`},l=await d.flowBuilderService.listPredefinedFlows(`foundation`);if(await d.flowBuilderService.getFlowConfigStorageFormat(c)===`legacy`){let e=s?await d.flowBuilderService.getFlowConfig({flowId:s}):await d.flowBuilderService.getFlowConfig({predefinedFlow:`foundation`}),n={...o,...e,maxIterations:r(e.maxIterations)},a=n.graphType===`agent`?`agent`:`foundation`,u=T(a),f=E(D(u)),p=await d.flowBuilderService.getFlowFeatureFlags(c);t({savedConfig:n,draftConfig:{...n},savedUnifiedConfig:null,savedFeatures:{...f,...p},draftFeatures:{...f,...p},featureDefinitions:u,availableTools:i.getRegisteredToolNames(),availableAgents:l,savedMultiAgentAccessibleAgentIds:[],draftMultiAgentAccessibleAgentIds:[],savedConnections:[],draftConnections:[],savedEnabledSkillNames:[],draftEnabledSkillNames:[],currentFlowId:s??null,currentGraphType:a,isDirty:!1,isLoading:!1,isLegacyConfig:!0});return}let u=await d.flowBuilderService.getUnifiedFlowConfig(c),f=u;try{let e=await h(u);f=e.config,e.migrated&&await d.flowBuilderService.saveUnifiedFlowConfig(c,f)}catch(t){e(`[AgentConfigStore] Connection migration failed:`,t)}let p=j(f);t({savedConfig:p.config,draftConfig:{...p.config},savedUnifiedConfig:f,savedFeatures:{...p.features},draftFeatures:{...p.features},featureDefinitions:p.featureDefinitions,availableTools:i.getRegisteredToolNames(),availableAgents:l,savedMultiAgentAccessibleAgentIds:[...p.multiAgentAccessibleAgentIds],draftMultiAgentAccessibleAgentIds:[...p.multiAgentAccessibleAgentIds],savedConnections:[...p.connections],draftConnections:[...p.connections],savedEnabledSkillNames:[...p.enabledSkillNames],draftEnabledSkillNames:[...p.enabledSkillNames],currentFlowId:s??null,currentGraphType:p.graphType,isDirty:!1,isLoading:!1,isLegacyConfig:!1})}catch(n){e(`[AgentConfigStore] Failed to initialize:`,n),t({error:n instanceof Error?n.message:`Failed to load config`,isLoading:!1})}},updateField:(e,r)=>{let i={...n().draftConfig,[e]:r};t({draftConfig:i,isDirty:N(n().savedConfig,i,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},setKnowledgeRetrievalMode:e=>{let r={...n().draftConfig,retrievalMode:e},i={...n().draftFeatures,"knowledge-retrieval":!0};t({draftConfig:r,draftFeatures:i,isDirty:N(n().savedConfig,r,n().savedFeatures,i,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},setGraphType:e=>{let r=T(e),i=E(D(r)),a={...n().draftConfig,graphType:e},o=e===`foundation`?n().draftMultiAgentAccessibleAgentIds:[];t({draftConfig:a,draftFeatures:i,draftMultiAgentAccessibleAgentIds:o,featureDefinitions:r,currentGraphType:e,isDirty:N(n().savedConfig,a,n().savedFeatures,i,n().savedMultiAgentAccessibleAgentIds,o,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},toggleFeature:e=>{let r={...n().draftFeatures,[e]:!n().draftFeatures[e]};t({draftFeatures:r,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,r,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},toggleTool:e=>{let r=n().draftConfig.tools,i=r.includes(e)?r.filter(t=>t!==e):[...r,e],a={...n().draftConfig,tools:i};t({draftConfig:a,isDirty:N(n().savedConfig,a,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},toggleAccessibleAgent:e=>{let r=n().draftMultiAgentAccessibleAgentIds,i=r.includes(e)?r.filter(t=>t!==e):[...r,e];t({draftMultiAgentAccessibleAgentIds:i,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,i,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},setAccessibleAgents:e=>{let r=[...new Set(e)];t({draftMultiAgentAccessibleAgentIds:r,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,r,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},setAgentConnections:e=>{let r=[...e],i={...n().draftFeatures,[f]:r.length>0};t({draftConnections:r,draftFeatures:i,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,i,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,r,n().savedEnabledSkillNames,n().draftEnabledSkillNames)})},toggleSkill:e=>{let r=n().draftEnabledSkillNames,i=r.includes(e)?r.filter(t=>t!==e):[...r,e];t({draftEnabledSkillNames:i,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,i)})},setEnabledSkills:e=>{let r=[...new Set(e)];t({draftEnabledSkillNames:r,isDirty:N(n().savedConfig,n().draftConfig,n().savedFeatures,n().draftFeatures,n().savedMultiAgentAccessibleAgentIds,n().draftMultiAgentAccessibleAgentIds,n().savedConnections,n().draftConnections,n().savedEnabledSkillNames,r)})},save:async()=>{if(n().isLegacyConfig){t({error:`Legacy config must be converted before saving.`});return}await a()},convertToUnified:async()=>{await a()},patchStepConfig:(e,r)=>{let{savedUnifiedConfig:i}=n();i&&t({savedUnifiedConfig:{...i,steps:i.steps.map(t=>t.name===e?{...t,config:{...t.config??{},...r}}:t)},isDirty:!0})},revert:()=>{let e=n().savedConfig,r=e.graphType===`agent`?`agent`:`foundation`;t({draftConfig:{...e},draftFeatures:{...n().savedFeatures},draftMultiAgentAccessibleAgentIds:[...n().savedMultiAgentAccessibleAgentIds],draftConnections:[...n().savedConnections],draftEnabledSkillNames:[...n().savedEnabledSkillNames],featureDefinitions:T(r),currentGraphType:r,isDirty:!1})},resetToDefaults:()=>{let e=j(u(`foundation`));t({draftConfig:e.config,draftFeatures:e.features,draftMultiAgentAccessibleAgentIds:[...e.multiAgentAccessibleAgentIds],draftConnections:[...e.connections],draftEnabledSkillNames:[...e.enabledSkillNames],featureDefinitions:e.featureDefinitions,currentGraphType:e.graphType,isDirty:N(n().savedConfig,e.config,n().savedFeatures,e.features,n().savedMultiAgentAccessibleAgentIds,e.multiAgentAccessibleAgentIds,n().savedConnections,e.connections,n().savedEnabledSkillNames,e.enabledSkillNames)})}}}),F=[{name:`focused-fix`,description:`Use when the user asks to fix, debug, or make a specific feature, module, or area work end-to-end. This skill is for systematic deep-dive repair across all files and dependencies, not quick single-bug fixes.`,publisher:`Alireza Rezvani`,collection:`engineering`,repo:`alirezarezvani/claude-skills`,sourceUrl:`https://github.com/alirezarezvani/claude-skills/blob/main/engineering/focused-fix/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/focused-fix/SKILL.md`},{name:`code-tour`,description:`Use when the user asks to create a CodeTour .tour file: onboarding tours, architecture tours, PR review tours, RCA tours, contributor guides, or any structured code walkthrough that links to real files and line numbers.`,publisher:`Alireza Rezvani`,collection:`engineering`,repo:`alirezarezvani/claude-skills`,sourceUrl:`https://github.com/alirezarezvani/claude-skills/blob/main/engineering/code-tour/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/code-tour/SKILL.md`},{name:`pr-review-expert`,description:`Use when the user asks to review pull requests, analyze code changes, check for security issues in PRs, or assess code quality of diffs.`,publisher:`Alireza Rezvani`,collection:`engineering`,repo:`alirezarezvani/claude-skills`,sourceUrl:`https://github.com/alirezarezvani/claude-skills/blob/main/engineering/pr-review-expert/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/pr-review-expert/SKILL.md`},{name:`meeting-analyzer`,description:`Analyzes meeting transcripts and recordings to surface behavioral patterns, communication anti-patterns, and actionable coaching feedback. Use for meeting transcript review, speaking ratio analysis, filler words, conflict avoidance, and communication habits over time.`,publisher:`Alireza Rezvani`,collection:`project-management`,repo:`alirezarezvani/claude-skills`,sourceUrl:`https://github.com/alirezarezvani/claude-skills/blob/main/project-management/meeting-analyzer/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/project-management/meeting-analyzer/SKILL.md`},{name:`behuman`,description:`Use when the user wants more human-like AI responses: less robotic, less list-heavy, and more authentic. This is for conversational or emotionally charged exchanges, not technical questions, code generation, or factual lookups.`,publisher:`Alireza Rezvani`,collection:`engineering`,repo:`alirezarezvani/claude-skills`,sourceUrl:`https://github.com/alirezarezvani/claude-skills/blob/main/engineering/behuman/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/behuman/SKILL.md`}],I=[{name:`algorithmic-art`,description:`Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/algorithmic-art/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/algorithmic-art/SKILL.md`},{name:`brand-guidelines`,description:`Applies Anthropic's official brand colors and typography to any sort of artifact that may benefit from having Anthropic's look-and-feel. Use it when brand colors or style guidelines, visual formatting, or company design standards apply.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md`},{name:`canvas-design`,description:`Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece. Create original visual designs, never copying existing artists' work to avoid copyright violations.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/canvas-design/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/canvas-design/SKILL.md`},{name:`claude-api`,description:`Build, debug, and optimize Claude API and Anthropic SDK apps, including prompt caching and model migrations. Trigger when code imports the Anthropic SDK or when the user asks about Claude API features, managed agents, thinking, tool use, files, citations, or memory.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/claude-api/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/claude-api/SKILL.md`},{name:`doc-coauthoring`,description:`Guide users through a structured workflow for co-authoring documentation. Use when user wants to write documentation, proposals, technical specs, decision docs, or similar structured content.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/doc-coauthoring/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/doc-coauthoring/SKILL.md`},{name:`frontend-design`,description:`Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications and wants polished UI instead of generic AI aesthetics.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md`},{name:`internal-comms`,description:`A set of resources to help write internal communications in company-style formats. Use for status reports, leadership updates, project updates, incident reports, newsletters, FAQs, and similar communication tasks.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/internal-comms/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/internal-comms/SKILL.md`},{name:`theme-factory`,description:`Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reports, or HTML pages. It includes preset themes with colors and fonts and can also generate a new theme on the fly.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/theme-factory/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/theme-factory/SKILL.md`},{name:`web-artifacts-builder`,description:`Suite of tools for creating elaborate HTML artifacts using React, Tailwind CSS, and shadcn/ui. Use for complex artifacts requiring state management, routing, or component systems rather than simple single-file HTML.`,publisher:`Anthropic`,collection:`anthropics/skills examples`,repo:`anthropics/skills`,sourceUrl:`https://github.com/anthropics/skills/blob/main/skills/web-artifacts-builder/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/anthropics/skills/main/skills/web-artifacts-builder/SKILL.md`}],L=[{name:`ascii-art`,description:`Generate detailed ASCII art images from a description, uploaded image, or concept. Supports portraits, scenes, UI wireframes, flowcharts, logos, and pixel art using the full Unicode box-drawing and block-element character set.`,publisher:`Second Sky`,collection:`design-skills`,repo:`secondsky/memorall`,sourceUrl:``,body:`# ASCII Art Image Generator

Generate ASCII art images from a text description, an uploaded image, or a concept. Output rich, detailed ASCII representations using the full Unicode box-drawing and block-element character set.

---

## When to use this skill

Trigger when the user asks to:
- Draw or sketch something in ASCII
- Convert an image to ASCII
- Create a diagram, scene, character, logo, map, or chart in text form
- Generate pixel-art-style or wireframe-style ASCII output

---

## Character Palettes

### Density ramp (darkest → lightest)

    █ ▓ ▒ ░   (block fill)
    @ # % * + = - : . \` (printable ramp)
      (space = lightest / background)

### Box-drawing (wireframes & UI)

    Single:  ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼
    Double:  ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬
    Mixed:   ╒ ╓ ╕ ╖ ╘ ╙ ╛ ╜ ╞ ╟ ╡ ╢ ╤ ╥ ╧ ╨ ╪ ╫
    Rounded: ╭ ╮ ╰ ╯

### Arrows & connectors

    → ← ↑ ↓ ↔ ↕ ⇒ ⇐ ⇑ ⇓ ➜ ▶ ◀ ▲ ▼

### Shading & texture

    ░░ light   ▒▒ medium   ▓▓ dark   ██ solid

---

## Output Rules

1. Always wrap output in a fenced code block — use \`\`\`art or \`\`\`text so the renderer uses a monospace font.
2. Aspect ratio: terminal characters are ~2× taller than wide — compensate by making images wider than they are tall.
3. Width: default to 60–80 columns unless the user specifies otherwise.
4. Shading accuracy: map luminosity regions to the density ramp above.
5. Annotations: add a short legend or label below the art when it aids comprehension.
6. Detail over speed: spend extra tokens producing a larger, more detailed image. Do not produce a tiny or sparse result when a detailed one is possible.
7. No placeholders: never output [IMAGE] or ... — draw every section fully.

---

## Workflow

### Step 1 — Analyse the subject
Identify: overall shape, major regions, light source (if applicable), foreground vs background, and any text elements.

### Step 2 — Choose style

| Subject type         | Style                          |
|----------------------|--------------------------------|
| UI / wireframe       | Box-drawing characters         |
| Portrait / face      | Density ramp + shading         |
| Landscape / scene    | Mixed ramp + texture fills     |
| Logo / icon          | Bold fills + clean outlines    |
| Diagram / flowchart  | Arrows + boxes + labels        |
| Pixel art            | Block elements (█ ▓ ▒ ░ · )   |

### Step 3 — Build the image
- Sketch the outline first, then fill regions.
- Use darker characters for shadows/depth, lighter for highlights.
- For images with text, render the text inside the art.

### Step 4 — Refine
- Check symmetry where expected.
- Confirm columns are consistent.
- Add caption or legend line below.

---

## Examples

### Portrait shading

\`\`\`art
          ░░▒▒▒▒▒▒░░
        ░▒▓▓▓▓▓▓▓▓▓▒░
       ░▒▓█▓░    ░▓█▓▒░
       ░▒▓░  ██  ██ ░▓▒░
       ▒▓▓░        ░▓▓▒
       ▒▓▓▓░  __  ░▓▓▓▒
        ░▒▓▓▓▓▓▓▓▓▓▒░
          ░░▒▒▒▒▒▒░░
\`\`\`

### UI wireframe

\`\`\`art
╭──────────────────────────────────────────╮
│  ☰  MyApp                    🔔  👤     │
├──────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────────────┐  │
│  │ Navigation │  │  Main Content      │  │
│  │            │  │                    │  │
│  │ ▶ Home     │  │  ┌──────────────┐  │  │
│  │   Dashboard│  │  │  Chart Area  │  │  │
│  │   Reports  │  │  │  ░░▒▒▓▓██▓▒  │  │  │
│  │   Settings │  │  └──────────────┘  │  │
│  │            │  │                    │  │
│  │ [  Login ] │  │  [ Save ]  [Cancel]│  │
│  └────────────┘  └────────────────────┘  │
╰──────────────────────────────────────────╯
\`\`\`

### Scene

\`\`\`art
       *  .  *    .        *
  .  *    ☽    *   .    *    .
 ____________________________
|░░░░░  🏠  ░░░░░░░░░░░░░░|
|░░░░░░░░░░░░░  🌲  ░░░░░░|
|▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓|
|████████  road  ████████|
 ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾
\`\`\`

### Flowchart

\`\`\`art
  ┌─────────────┐
  │    Start    │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐     Yes    ┌──────────┐
  │  Condition? │──────────▶ │ Action A │
  └──────┬──────┘            └──────────┘
         │ No
         ▼
  ┌─────────────┐
  │  Action B   │
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │     End     │
  └─────────────┘
\`\`\`

---

## Image input

When the user attaches an image:
1. Describe the luminosity regions you observe (darkest → lightest zones).
2. Map them to the density ramp.
3. Reproduce major edges, outlines, and shading in ASCII.
4. Aim for at least 40 rows × 80 columns for meaningful detail.

---

## Quality bar

A good ASCII image produced by this skill should be:
- **Recognisable** — a viewer should identify the subject without reading the caption.
- **Detailed** — fills regions with appropriate texture, not blank space.
- **Consistent** — column alignment is exact; no ragged right edges.
- **Well-labelled** — title or legend line follows the code block.`},{name:`wireframe`,description:`Generate white-paper wireframe prototypes as self-contained HTML + Tailwind CSS files. Produces 5 UX options (1 safe + 4 exploratory) with optional Clean and Polished color variants via parallel agents. Use when the user asks for wireframe, prototype, UX options, or layout exploration.`,publisher:`Second Sky`,collection:`design-skills`,repo:`secondsky/memorall`,sourceUrl:`https://github.com/Magdoub/claude-wireframe-skill`,body:`# UX Wireframe Generator — HTML + Tailwind

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
- Polished never uses dark backgrounds`}],R=[{name:`code-review`,description:`Code review practices with technical rigor and verification gates. Use for receiving feedback, requesting code-reviewer subagent reviews, or preventing false completion claims in pull requests.`,publisher:`Second Sky`,collection:`tooling-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/code-review/skills/code-review/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/code-review/skills/code-review/SKILL.md`},{name:`systematic-debugging`,description:`Four-phase debugging framework that ensures root cause investigation before attempting fixes. Never jump to solutions. Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes.`,publisher:`Second Sky`,collection:`tooling-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/systematic-debugging/skills/systematic-debugging/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/systematic-debugging/skills/systematic-debugging/SKILL.md`},{name:`root-cause-tracing`,description:`Systematically trace bugs backward through call stack to find original trigger. Use when errors occur deep in execution and you need to trace back to find the original trigger.`,publisher:`Second Sky`,collection:`tooling-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/root-cause-tracing/skills/root-cause-tracing/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/root-cause-tracing/skills/root-cause-tracing/SKILL.md`},{name:`verification-before-completion`,description:`Run verification commands and confirm output before claiming success. Use when about to claim work is complete, fixed, or passing, before committing or creating PRs.`,publisher:`Second Sky`,collection:`tooling-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/verification-before-completion/skills/verification-before-completion/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/verification-before-completion/skills/verification-before-completion/SKILL.md`},{name:`feature-dev`,description:`Automate 7-phase feature development with specialized agents. Use for multi-file features, architectural decisions, or ambiguous requirements and integration patterns.`,publisher:`Second Sky`,collection:`tooling-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/feature-dev/skills/feature-dev/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/feature-dev/skills/feature-dev/SKILL.md`},{name:`technical-specification`,description:`Creates detailed technical specifications for software projects covering requirements, architecture, APIs, and testing strategies. Use when planning features, documenting system design, or creating architecture decision records.`,publisher:`Second Sky`,collection:`documentation-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/technical-specification/skills/technical-specification/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/technical-specification/skills/technical-specification/SKILL.md`},{name:`api-design-principles`,description:`Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight developers. Use when designing new APIs, reviewing API specifications, or establishing API design standards.`,publisher:`Second Sky`,collection:`api-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/api-design-principles/skills/api-design-principles/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/api-design-principles/skills/api-design-principles/SKILL.md`},{name:`api-testing`,description:`HTTP API testing for TypeScript and Python stacks. Covers REST APIs, GraphQL, request and response validation, authentication, and error handling.`,publisher:`Second Sky`,collection:`api-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/api-testing/skills/api-testing/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/api-testing/skills/api-testing/SKILL.md`},{name:`responsive-web-design`,description:`Builds adaptive web interfaces using Flexbox, CSS Grid, and media queries with a mobile-first approach. Use when creating multi-device layouts, implementing flexible UI systems, or ensuring cross-browser compatibility.`,publisher:`Second Sky`,collection:`web-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/responsive-web-design/skills/responsive-web-design/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/responsive-web-design/skills/responsive-web-design/SKILL.md`},{name:`web-performance-optimization`,description:`Optimizes web application performance through code splitting, lazy loading, caching strategies, and Core Web Vitals monitoring. Use when improving load times, implementing service workers, or reducing bundle sizes.`,publisher:`Second Sky`,collection:`web-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/web-performance-optimization/skills/web-performance-optimization/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/web-performance-optimization/skills/web-performance-optimization/SKILL.md`},{name:`progressive-web-app`,description:`Progressive Web Apps with service workers, web manifest, offline support, and installation prompts. Use for installable web apps, offline functionality, push notifications, or service worker and manifest setup.`,publisher:`Second Sky`,collection:`web-skills`,repo:`secondsky/claude-skills`,sourceUrl:`https://github.com/secondsky/claude-skills/blob/main/plugins/progressive-web-app/skills/progressive-web-app/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/secondsky/claude-skills/main/plugins/progressive-web-app/skills/progressive-web-app/SKILL.md`}],z=[{name:`karpathy-guidelines`,description:`Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.`,publisher:`Andrej Karpathy`,collection:`tooling-skills`,repo:`forrestchang/andrej-karpathy-skills`,sourceUrl:`https://github.com/forrestchang/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md`,rawUrl:`https://raw.githubusercontent.com/forrestchang/andrej-karpathy-skills/refs/heads/main/skills/karpathy-guidelines/SKILL.md`}],B=`bergside/awesome-design-skills`,V=`https://github.com/bergside/awesome-design-skills/tree/main`,H=`https://raw.githubusercontent.com/bergside/awesome-design-skills/main`,U=[{slug:`agentic`,description:`Conversational AI-first interface with minimal controls, clear outcomes, and delegated task flows for agentic workflows.`},{slug:`artistic`,description:`High-contrast, expressive style with creative typography and bold color choices for visually striking interfaces.`},{slug:`bold`,description:`Strong visual presence with heavyweight typography, high-contrast colors, and commanding layouts.`},{slug:`brutalism`,description:`Raw, anti-design aesthetic inspired by concrete architecture with unadorned elements, jarring layouts, and functional minimalism.`},{slug:`cafe`,description:`Cozy cafe-inspired interface with warm tones, soft typography, and clean layouts for a relaxed browsing experience.`},{slug:`claymorphism`,description:`Soft, rounded 3D-like shapes mimicking malleable clay with playful, puffy elements and colorful surfaces.`},{slug:`clean`,description:`Simplicity-focused design with ample whitespace, legible typography, and a limited color palette to reduce visual clutter.`},{slug:`colorful`,description:`Vibrant, high-contrast palettes and gradients for engaging, memorable, and modern user experiences.`},{slug:`contemporary`,description:`Current-era minimalist design with bento grids, dark mode support, and high-performance accessible layouts.`},{slug:`corporate`,description:`Professional, brand-aligned design with structured grids, minimalist layouts, and consistent enterprise patterns.`},{slug:`cosmic`,description:`Futuristic sci-fi aesthetic with dark themes, vibrant neon accents, and immersive spatial elements.`},{slug:`creative`,description:`Playful, character-driven design with expressive typography and bold graphics for landing pages and creative projects.`},{slug:`dithered`,description:`Dot-pattern rendering technique that simulates shades with a limited palette for nostalgic, retro, high-contrast visuals.`},{slug:`doodle`,description:`Hand-drawn, sketch-like style with doodles, handwritten fonts, and imperfect lines for a playful, informal feel.`},{slug:`dramatic`,description:`High-contrast, theatrical design with bold layouts, immersive visuals, and unconventional compositions that command attention.`},{slug:`editorial`,description:`Magazine-inspired editorial layout with refined serif typography, structured grids, and elegant reading experiences.`},{slug:`elegant`,description:`Graceful, refined aesthetic with delicate typography, minimal palettes, and polished layouts that exude sophistication.`},{slug:`energetic`,description:`Dynamic, vibrant style with thick borders, geometric shapes, high-contrast colors, and expressive typography conveying motion and vitality.`},{slug:`enterprise`,description:`Clean, high-contrast enterprise design for data-driven workflows with intuitive drag-and-drop patterns and structured layouts.`},{slug:`expressive`,description:`Vibrant, personality-driven design with bold colors, playful graphics, and dynamic layouts that balance creativity with structure.`},{slug:`fantasy`,description:`Game-inspired fantasy aesthetic with bold, premium visuals, rich color palettes, and immersive thematic elements.`},{slug:`flat`,description:`Two-dimensional minimalist style with vibrant colors, clean typography, and no 3D effects for fast, user-friendly interfaces.`},{slug:`friendly`,description:`Approachable, intuitive design with rounded elements, ample whitespace, and soft pastel color palettes.`},{slug:`futuristic`,description:`Forward-looking design with tech-inspired typography, modern layouts, and a sleek, innovation-driven aesthetic.`},{slug:`glassmorphism`,description:`Frosted glass effect with translucent layers, subtle blur, and luminous borders for depth and modern elegance.`},{slug:`gradient`,description:`Smooth color transitions and gradient-rich surfaces for modern, playful interfaces with visual depth.`},{slug:`luxury`,description:`High-end dark aesthetic with bold headings, monochromatic palette, and premium feel for luxury brand experiences.`},{slug:`material`,description:`Google's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns.`},{slug:`minimal`,description:`Stripped-back design emphasizing whitespace, clean typography, and restrained color for maximum clarity and focus.`},{slug:`modern`,description:`Contemporary editorial style with serif typography, minimal palettes, and clean layouts for polished digital products.`},{slug:`mono`,description:`Monospace-driven, matrix-inspired design with high-contrast elements, compact density, and a hacker-chic aesthetic.`},{slug:`neobrutalism`,description:`Modern take on brutalism with bold borders, vivid accent colors, and raw, high-contrast layouts on warm surfaces.`},{slug:`neon`,description:`Electric neon glow effects with high-contrast color pairings for bold, attention-grabbing interfaces.`},{slug:`neumorphism`,description:`Soft, extruded UI elements with inner and outer shadows on monochromatic surfaces for a tactile, embedded look.`},{slug:`pacman`,description:`Retro arcade-inspired design with pixel fonts, dotted borders, playful high-contrast colors, and 8-bit game aesthetics.`},{slug:`paper`,description:`Paper-textured, print-inspired design with minimal colors, clean serif/sans typography, and tactile surface qualities.`},{slug:`perspective`,description:`Spatial depth design with isometric views, vanishing points, and layered elements that guide attention through 3D-like realism.`},{slug:`premium`,description:`Apple-inspired premium aesthetic with precise spacing, modern typography, and a refined, polished visual language.`},{slug:`professional`,description:`Polished, business-ready design with modern typography, structured layouts, and a trustworthy visual identity.`},{slug:`publication`,description:`Print-inspired visual language for books, magazines, and reports with editorial grids and expressive typography.`},{slug:`refined`,description:`Carefully curated, modern minimal style with elegant serif typography and understated, sophisticated palettes.`},{slug:`retro`,description:`Throwback design with vintage-inspired typography, high-contrast retro palettes, and nostalgic visual elements.`},{slug:`shadcn`,description:`Shadcn/ui-inspired design with minimal, clean components, monochrome palette, and utility-first patterns.`},{slug:`simple`,description:`Straightforward, no-frills design with clean typography, neutral colors, and intuitive layouts that stay out of the way.`},{slug:`skeumorphism`,description:`Real-world mimicry with textured surfaces, 3D effects, and familiar physical metaphors for intuitive digital interfaces.`},{slug:`sleek`,description:`Modern minimalist aesthetic with clean lines, intentional color palette, subtle interactions, and consistent spacing.`},{slug:`spacious`,description:`Generous whitespace, consistent padding, and grid-based layouts for clean, readable, and breathing interfaces.`},{slug:`storytelling`,description:`Narrative-driven design using visuals, copy, and interaction to guide users through engaging, emotionally resonant journeys.`},{slug:`tetris`,description:`Classic block-game inspired design with playful colors, bold display fonts, and compact, high-energy layouts.`},{slug:`vibrant`,description:`Lively, colorful design with bold playful typography, warm accents, and dynamic visual energy.`},{slug:`vintage`,description:`1950s-1990s nostalgia with skeuomorphic touches, grainy textures, retro color palettes, and pixel-style typography.`},{slug:`levels`,description:`Conversion-focused design that removes friction and guides users toward action through clarity, trust, and speed.`},{slug:`bento`,description:`Modular grid layout with card-like blocks, clear hierarchy, soft spacing, and subtle visual contrast for organized, scannable interfaces.`},{slug:`lingo`,description:`Playful, minimal design with bright colors, rounded shapes, tactile 3D borders, and friendly illustrations for approachable interfaces.`},{slug:`dashboard`,description:`Dark-themed cloud-platform aesthetic with modular grids, glass-like panels, and strong data hierarchy for productivity dashboards.`},{slug:`application`,description:`App dashboard with purple-themed aesthetic, top-bar navigation, card-based layouts, and developer-first workflows.`},{slug:`ant`,description:`Structured, enterprise-focused design system emphasizing clarity, consistency, and efficiency for data-dense web applications.`}].map(({slug:e,description:t})=>({name:e,description:t,publisher:`Bergside`,collection:`design-skills`,repo:B,sourceUrl:`${V}/skills/${e}`,rawUrls:[`${H}/skills/${e}/SKILL.md`,`${H}/skills/${e}/DESIGN.md`]})),W=[{name:`audio-jingle`,description:`Audio generation skill — jingles, beds, voiceover, and sound effects. Routes music requests to Suno V5 / Udio / Lyria, speech to MiniMax TTS / FishAudio / ElevenLabs V3, and SFX to ElevenLabs SFX or AudioCraft. Output is one MP3/WAV file saved to the project folder.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/audio-jingle`,body:`# Audio Jingle Skill

Three sub-modes. The active project's \`audioKind\` decides which one
runs:

| \`audioKind\` | Models we route to | Plan focus |
|---|---|---|
| \`music\` | Suno V5 (default), Udio, Lyria 2 | genre + tempo + instrumentation |
| \`speech\` | MiniMax TTS (default), Fish, ElevenLabs V3 | script + voice + pacing |
| \`sfx\` | ElevenLabs SFX (default), AudioCraft | texture + impact + duration |

## Resource map

\`\`\`
audio-jingle/
├── SKILL.md
└── example.html
\`\`\`

## Workflow

### Step 0 — Read the project metadata

\`audioKind\`, \`audioModel\`, \`audioDuration\` (seconds), and (for speech)
\`voice\`. Branch by \`audioKind\` and use the values verbatim — no
clarifying form unless something is marked \`(unknown — ask)\`.

Important: \`voice\` is provider-specific. For \`minimax-tts\`, \`--voice\`
must be a valid MiniMax \`voice_id\` (for example \`male-qn-qingse\`), not
a natural-language description. If you only have a prose voice brief
("warm female narrator", "neutral Mandarin"), keep that in your plan
but omit \`--voice\` so the daemon's default voice id applies, or ask the
user to choose a specific id.

### Step 1 — Plan

**Music**
- Genre + reference artists (1-2)
- Tempo (BPM) + key
- Instrumentation (3-5 instruments max)
- Vocals: yes / no / hummed / choir
- Mood arc (intro → chorus → outro)

**Speech**
- Script (final, not draft — TTS runs verbatim)
- Voice target + pacing
  For MiniMax this means a real \`voice_id\`, not prose in \`--voice\`
- Pronunciation hints for proper nouns / acronyms

**SFX**
- Texture (impact / whoosh / ambience / foley)
- Duration + envelope (sharp attack vs. gentle swell)
- Layering note (single hit vs. stacked)

State the plan in 2-3 sentences before dispatching.

### Step 2 — Compose the prompt

Use the format the upstream model prefers. Bind \`audioDuration\` to the
API parameter directly; never put "make it 30 seconds" in prose.

### Step 3 — Dispatch via the media contract

Use the unified dispatcher — do **not** call provider APIs by hand:

\`\`\`bash
node "$OD_BIN" media generate \\
  --project "$OD_PROJECT_ID" \\
  --surface audio \\
  --audio-kind "<music|speech|sfx>" \\
  --model "<audioModel from metadata>" \\
  --duration <audioDuration seconds> \\
  [--voice "<provider voice id (speech only)>"] \\
  --output "<short-slug>-<duration>s.mp3" \\
  --prompt "<assembled prompt from Step 2 — for speech, the literal script>"
\`\`\`

The command prints one line of JSON: \`{"file": {"name": "...", ...}}\`.
The bytes land in the project; the FileViewer renders the audio
transport controls automatically.

### Step 4 — Hand off

Reply with: plan summary, the filename returned by the dispatcher, and
one sentence on what to try if the user wants a variation (e.g. "swap
tempo from 92 to 108 BPM" rather than "make it different").

## Hard rules

- TTS runs your script **literally**. Proof it before dispatching —
  even one stray comma changes the cadence.
- MiniMax TTS rejects free-form voice prose in \`--voice\`. Use a real
  MiniMax \`voice_id\` (for example \`male-qn-qingse\`) or omit the flag
  and let the daemon's default voice apply.
- Music: under 30s = single section; 30–90s = intro + body; 90s+ =
  full arc. Don't try to fit a 3-act song into 15 seconds.
- SFX: prefer one well-described layer over a paragraph of "make it
  cool" — generators reward specific texture words.
- Save the file every turn. The audio viewer shows transport controls
  the moment the file lands.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Audio jingle — example</title>
    <style>
      :root {
        --bg: #f5efe5;
        --panel: #ffffff;
        --ink: #1c1b1a;
        --muted: #8b8579;
        --accent: #c96442;
        --grid: #e6dfd1;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
        font-family: 'Iowan Old Style', 'Charter', Georgia, serif; }
      body { min-height: 100dvh; display: grid; place-items: center; padding: 32px; }
      .card {
        width: min(640px, 92vw);
        background: var(--panel);
        border-radius: 8px;
        padding: 26px 28px 22px;
        box-shadow: 0 16px 40px rgba(28,27,26,0.10), 0 1px 2px rgba(28,27,26,0.05);
        border: 1px solid rgba(28,27,26,0.06);
      }
      .row1 { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
      .icon {
        width: 44px; height: 44px; border-radius: 50%;
        background: var(--accent); color: #fff;
        display: grid; place-items: center;
        box-shadow: 0 6px 18px rgba(201, 100, 66, 0.35);
      }
      .icon svg { width: 22px; height: 22px; }
      .title { margin: 0; font-size: 20px; line-height: 1.2; }
      .sub { font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 11px; color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px; }

      .wave {
        display: flex; align-items: end; gap: 3px;
        height: 96px; padding: 0 4px;
        border-top: 1px dashed var(--grid);
        border-bottom: 1px dashed var(--grid);
      }
      .wave span {
        flex: 1; background: linear-gradient(180deg, var(--accent), #a4502f);
        border-radius: 2px;
        animation: bob 2s ease-in-out infinite;
        animation-delay: var(--d, 0s);
      }
      @keyframes bob {
        0%, 100% { height: var(--h, 30%); }
        50% { height: calc(var(--h, 30%) * 1.6); }
      }

      .transport {
        margin-top: 14px;
        display: grid; grid-template-columns: auto 1fr auto auto; gap: 12px;
        align-items: center;
      }
      .play {
        width: 36px; height: 36px; border-radius: 50%;
        background: var(--ink); color: #fff;
        display: grid; place-items: center;
      }
      .timeline {
        height: 4px; border-radius: 2px;
        background: linear-gradient(90deg, var(--accent) 0 32%, var(--grid) 32% 100%);
      }
      .time {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 11px; color: var(--muted);
        letter-spacing: 0.08em;
      }
      .badge {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 10px; color: var(--accent);
        letter-spacing: 0.18em; text-transform: uppercase;
        padding: 4px 8px; border-radius: 999px;
        background: rgba(201, 100, 66, 0.1);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="row1">
        <div class="icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </div>
        <div>
          <h1 class="title">A 30s coffee-shop launch jingle.</h1>
          <div class="sub">suno-v5 · 92 BPM · loop-friendly tail</div>
        </div>
      </div>
      <div class="wave" aria-hidden>
        <span style="--h:24%;--d:0s"></span>
        <span style="--h:38%;--d:.05s"></span>
        <span style="--h:52%;--d:.1s"></span>
        <span style="--h:64%;--d:.15s"></span>
        <span style="--h:48%;--d:.2s"></span>
        <span style="--h:70%;--d:.25s"></span>
        <span style="--h:42%;--d:.3s"></span>
        <span style="--h:58%;--d:.35s"></span>
        <span style="--h:36%;--d:.4s"></span>
        <span style="--h:62%;--d:.45s"></span>
        <span style="--h:26%;--d:.5s"></span>
        <span style="--h:50%;--d:.55s"></span>
        <span style="--h:34%;--d:.6s"></span>
        <span style="--h:46%;--d:.65s"></span>
        <span style="--h:58%;--d:.7s"></span>
        <span style="--h:30%;--d:.75s"></span>
        <span style="--h:44%;--d:.8s"></span>
        <span style="--h:54%;--d:.85s"></span>
        <span style="--h:28%;--d:.9s"></span>
        <span style="--h:48%;--d:.95s"></span>
      </div>
      <div class="transport">
        <div class="play" aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 4v16l14-8z"/></svg>
        </div>
        <div class="timeline" aria-hidden></div>
        <span class="time">00:09 / 00:30</span>
        <span class="badge">MP3</span>
      </div>
    </div>
  </body>
</html>

\`\`\``},{name:`blog-post`,description:`A long-form article / blog post — masthead, hero image placeholder, article body with figures and pull quotes, author byline, related posts. Use when the brief asks for "blog", "article", "post", "essay", or "case study".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/blog-post`,body:`# Blog Post Skill

Produce a single long-form article page — editorial layout, no chrome.

## Workflow

1. **Read the active DESIGN.md** (injected above). Lean into the typography
   tokens — long-form is 70% type, 20% image, 10% chrome.
2. **Pick the topic** from the brief and write a real article — at least 600
   words across 4–6 H2 sections. No lorem ipsum.
3. **Sections**, in order:
   - **Masthead** — small wordmark + 4–6 nav links, plain.
   - **Article header** — category eyebrow, headline (display token, large),
     deck (1–2 sentence subhead), author name + role + date.
   - **Hero image** — a 16:9 placeholder block using a DS-tinted gradient or
     solid fill (no external images). Add a 1-line caption underneath.
   - **Body** — alternating prose paragraphs with at least:
     - 1 pull quote (large display type, accent rule on the left).
     - 1 figure (image placeholder + caption).
     - 1 list (numbered or bulleted).
     - 1 inline blockquote.
   - **Author footer** — author avatar (initials in a circle), bio paragraph.
   - **Related** — 3 cards linking to other posts. Each card: tiny image
     block, title, 1-line excerpt, date.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Article body uses the DS body font, centered, max-width per DS layout
     rule (typically 680–720px).
   - Drop caps (\`first-letter\`) only if the DS mood is editorial / serif —
     skip on tech-y DSes.
   - \`data-od-id\` on the headline, hero, body, pull quote, related grid.
5. **Self-check**:
   - Type hierarchy is unambiguous — H1 is clearly the headline; H2s are
     section dividers; pull quotes do not compete with H1.
   - Line length 60–75 chars for body prose.
   - Accent appears at most twice (eyebrow + pull-quote rule, or one link).
   - The page reads like a magazine, not a marketing landing.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="post-slug" type="text/html" title="Article Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Why we rewrote our sync engine in Rust — Filebase</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1b1a; --muted: #6b6964; --border: #e6e4e0;
      --accent: #c96442; --surface: #ffffff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 18px/1.65 Georgia, 'Iowan Old Style', serif; }
    .wrap { max-width: 680px; margin: 0 auto; padding: 56px 28px 96px; }
    nav.top { font-family: -apple-system, system-ui, sans-serif; font-size: 13px; color: var(--muted); margin-bottom: 56px; }
    nav.top a { color: inherit; text-decoration: none; }
    .eyebrow { font-family: -apple-system, system-ui, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); margin-bottom: 14px; }
    h1 { font-size: clamp(36px, 5vw, 52px); line-height: 1.1; letter-spacing: -0.015em; margin: 0 0 20px; }
    .byline { font-family: -apple-system, system-ui, sans-serif; font-size: 14px; color: var(--muted); margin: 0 0 40px; display: flex; align-items: center; gap: 12px; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); opacity: 0.18; }
    .lede { font-size: 22px; line-height: 1.5; color: var(--fg); margin: 0 0 40px; font-style: italic; }
    .hero-figure { aspect-ratio: 16/9; background: linear-gradient(135deg, var(--accent), #6b6964); border-radius: 8px; margin-bottom: 48px; opacity: 0.85; }
    p { margin: 24px 0; }
    p:first-of-type::first-letter { float: left; font-size: 64px; line-height: 0.9; padding: 6px 10px 0 0; font-weight: 600; color: var(--accent); }
    h2 { font-size: 28px; letter-spacing: -0.01em; margin: 56px 0 12px; line-height: 1.2; }
    blockquote { margin: 40px 0; padding: 0 32px; font-size: 24px; line-height: 1.4; color: var(--fg); border-left: 3px solid var(--accent); font-style: italic; }
    code { font-family: ui-monospace, monospace; background: var(--surface); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
    pre { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px 18px; overflow-x: auto; font: 14px/1.55 ui-monospace, monospace; }
    figure.numbers { font-family: -apple-system, system-ui, sans-serif; display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin: 40px -24px; padding: 28px 24px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    figure.numbers .stat .value { font-family: Georgia, serif; font-size: 38px; letter-spacing: -0.01em; line-height: 1; }
    figure.numbers .stat .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 6px; }
    .endnote { font-family: -apple-system, system-ui, sans-serif; font-size: 13px; color: var(--muted); margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--border); }
    .endnote a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <article class="wrap" data-od-id="article">
    <nav class="top"><a href="#">← Filebase blog</a></nav>
    <div class="eyebrow">Engineering</div>
    <h1>Why we rewrote our sync engine in Rust</h1>
    <div class="byline">
      <div class="avatar"></div>
      <span>By Mira Hassan · April 22, 2026 · 8 min read</span>
    </div>
    <p class="lede">For two years our Go sync engine was good enough. Then video editors started joining the customer list, and the GC pauses we'd been politely ignoring turned into bug reports we couldn't ignore.</p>
    <div class="hero-figure" data-od-id="hero-figure"></div>

    <p>The decision wasn't sudden. We'd been watching the GC pause distribution shift for six months before we admitted what the data was telling us. P50 latency was great. P99 was a horror movie. Customers syncing 30 GB of <code>.psd</code> files in active editing sessions were the ones writing in.</p>

    <p>Rewriting an entire sync engine sounds like the kind of project a startup is told never to do. We did it anyway. Here's how it went, what surprised us, and the parts I'd do differently.</p>

    <h2>The trigger: GC pauses we couldn't fix</h2>
    <p>Go's garbage collector is brilliant. It is also, fundamentally, a tradeoff. Our hot path allocated short-lived buffer slices on every block diff — and at our scale, on a heavy uploader, the collector ran often enough that the P99 pause crept past 50ms.</p>

    <p>We tried the usual fixes: pooling buffers with <code>sync.Pool</code>, tuning <code>GOGC</code>, reducing allocations in the merge path. They each helped a little. None of them got us under 20ms, and the customers we cared about needed under 5.</p>

    <blockquote>"We can't fix this in Go. We can fix it in something without a GC."</blockquote>

    <p>Our staff engineer Sasha said this in a meeting in October. He was right. The question wasn't whether to leave Go. It was what to leave it for, and how much we could keep.</p>

    <h2>What we kept; what we threw out</h2>
    <p>The CLI stayed in Go. The control plane stayed in Go. The bit that does block-level diffing in a hot loop on a customer's laptop — that became Rust. The boundary became a single FFI surface with a small, opinionated protocol.</p>

    <figure class="numbers">
      <div class="stat"><div class="value">38ms → 4ms</div><div class="label">P99 sync latency</div></div>
      <div class="stat"><div class="value">62%</div><div class="label">Memory drop</div></div>
      <div class="stat"><div class="value">11 weeks</div><div class="label">From RFC to ship</div></div>
    </figure>

    <p>The numbers above are real and from production. They are also misleading without context: the Rust port doesn't just remove the GC, it also removes a layer of abstraction we'd been carrying since the Go MVP.</p>

    <h2>What I'd do differently</h2>
    <p>One thing: the FFI boundary. We chose <code>cgo</code> for symmetry — Go calling Rust feels right when you already have Go everywhere. But the binding ceremony is brittle, and we ate two production incidents from string lifetime mistakes before we wrote a wrapper layer that handled them once.</p>

    <p>If I were starting today, I'd reach for <code>uniffi</code> or generate the bindings from a schema. The lessons isn't <em>don't use cgo</em>; it's <em>treat the boundary like an external API the moment you cross language families</em>.</p>

    <div class="endnote">Filebase is hiring engineers who like writing this kind of post. <a href="#">See open roles →</a></div>
  </article>
</body>
</html>

\`\`\``},{name:`critique`,description:`Run a 5-dimension expert design review on any HTML artifact in the project — Philosophy / Visual hierarchy / Detail / Functionality / Innovation, each scored 0–10. Outputs a single self-contained HTML report with a radar chart, evidence-backed scores, and three lists: Keep / Fix / Quick-wins. Use when the brief asks for a "design review", "design critique", "5 维度评审", "design audit", or "what's wrong with my design".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/critique`,body:`# Critique Skill · 5 维度专家评审

Produce a single-file HTML "design review report" that scores any
artifact across 5 dimensions and proposes actionable fixes. Inspired by
the *huashu-design* expert-critique flow.

## When to use

- After the agent (or user) generates an artifact (deck / prototype /
  landing page) and the user asks "what's wrong with this?" or
  "review this"
- As a self-check loop the agent can run on its own output **before**
  emitting it
- For comparing two variants of the same design

## What you produce

A single self-contained \`<artifact type="text/html">\` review report
including:

1. **Header** — what artifact was reviewed, date, reviewer ("OD ·
   Critique skill"), 1-line verdict
2. **Radar chart** (inline SVG, no library) showing the 5 scores
3. **Five dimension cards**, each with:
   - Score 0–10 (with band: 0–4 *Broken* · 5–6 *Functional* · 7–8 *Strong*
     · 9–10 *Exceptional*)
   - 1-paragraph evidence (cite specific elements / files / lines)
   - One Keep / Fix / Quick-win bullet
4. **Combined action lists** at the bottom:
   - **Keep** — what's working, don't touch
   - **Fix** — P0 / P1 issues that are visually expensive
   - **Quick wins** — 5–15 minute tweaks with disproportionate impact

## The 5 dimensions

> Each dimension is independent — a deck can be 9/10 on Innovation but
> 4/10 on Hierarchy and the report should say so plainly. Don't average
> away interesting failures.

### 1. Philosophy consistency · 哲学一致性

> Does the artifact pick a clear *direction* and stick to it through
> every micro-decision (chrome / kicker / spacing / accent)?

**Evidence to look for:**
- Is there one declared design direction (e.g. Monocle / WIRED /
  Kinfolk) or is it three styles in a trench coat?
- Does the chrome / kicker vocabulary stay in one register, or does
  page 3 say "Vol.04 · Spring" and page 7 say "BUT WAIT 🔥"?
- Are accent / serif / mono used by the same rule throughout?

**0–4** Three styles fighting each other. **5–6** One direction but
half the elements drift. **7–8** Coherent, occasional drift on edge
pages. **9–10** Every element argues for the same thesis.

### 2. Visual hierarchy · 视觉层级

> Can a stranger figure out what to read first, second, third — without
> being told?

**Evidence to look for:**
- Is the largest type clearly the most important thing on each page?
- Do mono / serif / sans roles match the information's *role* (meta /
  body / display)?
- Lots of "loud" elements competing? Or a clear primary + secondary +
  tertiary tier?

**0–4** Everything shouts. **5–6** Hierarchy works on hero pages but
breaks on body. **7–8** Clear tiers, occasional collision. **9–10** Eye
moves with zero friction.

### 3. Detail execution · 细节执行

> The 90/10 stuff — alignment, leading, kerning at large sizes, image
> framing, foot/chrome polish, edge-case spacing.

**Evidence to look for:**
- Big-stat pages: does the number sit on a baseline, or float?
- Left/right column tops aligned in \`grid-2-7-5\`?
- \`frame-img\` + caption proportions consistent across pages?
- Mono labels: same letter-spacing? same uppercase rule?
- Any orphaned \`<br>\` causing 1-character lines?

**0–4** Visible tape and string. **5–6** Most pages clean, 1–2
ragged. **7–8** Polished, expert eye finds 2–3 misses. **9–10**
Magazine-grade — the kind of detail that makes printed-by-hand
typographers nod.

### 4. Functionality · 功能性

> Does the artifact *work* for its intended use? Click targets, nav,
> readability at presentation distance, copy-paste-ability for code
> blocks, mobile fallback if relevant.

**Evidence to look for:**
- Deck: keyboard / wheel / touch nav all working? Iframe scroll
  fallback?
- Landing: CTA above the fold? Phone number tappable on mobile?
- Runbook: code blocks copyable, mono font, no smart quotes?
- Critical info readable from 4m away (large screen presentation)?

**0–4** Visually fine but doesn't accomplish its job. **5–6** Core
flow works, edge cases broken. **7–8** Robust through normal use.
**9–10** Defensively engineered — handles iframe / fullscreen / paste
/ print without flinching.

### 5. Innovation · 创新性

> Does this push past the median? Is there one element that makes
> people lean in?

**Evidence to look for:**
- One *unexpected* layout / motion / typographic move that wasn't
  required?
- Or 100% safe — could be any deck/landing from any agency?
- Is the innovation *earned* (matches direction) or grafted on
  (random WebGL on a Kinfolk slow-living deck)?

**0–4** Generic AI-slop median. **5–6** Competent and unmemorable.
**7–8** One memorable moment, the rest solid. **9–10** Multiple
moves you'd steal — but each one obviously serves the thesis.

## Scoring discipline (read before you score)

- **Always cite evidence** — "scored 4 because hero page mixes
  Playfair display with Inter sans on the same line" beats "feels
  inconsistent". Numbers without evidence get rejected.
- **Don't average up** — if Hierarchy is 5 because page 3 is broken,
  don't bump to 7 because pages 1 and 2 are fine. The score is the
  *worst sustained band*.
- **Don't grade-inflate** — a 7 means *strong*, not *acceptable*. If
  every score is 7+, you're not reviewing critically.
- **Innovation is allowed to be low** — 5/10 is fine for production
  deliverables. Don't punish *appropriate* conservatism.

## Workflow

### Step 1 — Acquire the artifact

Three modes:

1. **Project file** — user said "review the index.html I just made":
   open it from the project folder.
2. **Pasted HTML** — user pasted code in the chat: read it from the
   message.
3. **Generated by you in this turn** — you just emitted an artifact
   above and want to self-critique: re-read your own \`<artifact>\`.

If multiple HTML files exist, ask which one (don't review all).

### Step 2 — Read enough to score

Skim the entire \`<style>\`, then read 6–8 representative content
blocks. **Do not score from frontmatter alone.** The score depends on
*executed* design, not declared intent.

### Step 3 — Score with evidence

For each of the 5 dimensions, write the score and a 30–80 word
evidence paragraph that names specific elements. Use line numbers,
class names, page numbers.

Example:
\`\`\`
Dimension: Detail execution
Score: 6 / 10
Evidence: Stat-cards on page 3 align cleanly (grid-6, 3×2), but on
page 8 the right column foot sits 2vh higher than the left because
.callout has 3vh top margin while the figure doesn't. Image captions
use mono on page 5 but sans on page 7 — pick one.
\`\`\`

### Step 4 — Build the action lists

Aggregate the 5 evidence paragraphs into:

- **Keep** (3–5 bullets) — concrete things working that the user must
  not break in the next iteration. Cite by class / page / element.
- **Fix** (3–6 bullets) — must-do, ordered by *visual cost saved per
  minute spent*. Each bullet ≤ 1 sentence.
- **Quick wins** (3–5 bullets) — 5–15 minutes each, high
  signal-to-noise (e.g. "swap \`display:flex\` for \`grid\` on page 4 to
  fix the column drift").

### Step 5 — Emit the report HTML

Build a single file:

- Header: artifact name + reviewer credit + date
- Big radar chart (SVG)
- 5 dimension cards in a 1-column or 2-column grid
- Three action lists at the bottom with checkbox affordance

Use the active DESIGN.md tokens if one exists; otherwise default to a
neutral light theme (off-white background, near-black text, one accent
for radar fill).

## Output contract

\`\`\`
<artifact identifier="critique-<artifact-slug>" type="text/html" title="Critique · <Artifact Title>">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact ("Reviewed X across 5 dimensions, see
report below.") and **stop after \`</artifact>\`** — do not paraphrase
the report in chat; the user will read the artifact.

## Hard rules

- **5 scores, every time** — partial reports (e.g. only 3 dimensions)
  are not allowed.
- **Evidence per score** — no "feels off" / "needs work". If you
  can't cite an element, the score is not justified.
- **Don't grade-inflate** — overall mean above 8 is suspicious; check
  yourself.
- **Don't review your own artifact in the same turn** — the user
  needs to see it first. Self-critique only on explicit request
  ("now critique what you just made").
- **Single-file HTML only** — no external CSS/JS. Inline everything.
- **Radar chart is mandatory** — gives the report a recognizable
  silhouette and lets the user spot weak axes at a glance.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Critique · magazine-web-ppt example deck</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f3ee;
      --paper: #ffffff;
      --ink: #1a1a1c;
      --muted: #6b6964;
      --rule: #e2dfd7;
      --accent: #c96442;
      --good: #4a7a3f;
      --warn: #c96442;
      --bad: #a83a2a;

      --serif: 'Source Serif 4', Georgia, serif;
      --sans: 'Inter', -apple-system, system-ui, sans-serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--sans);
      font-size: 16px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    a { color: var(--accent); }

    .wrap {
      max-width: 1080px;
      margin: 0 auto;
      padding: 56px 40px 96px;
    }

    /* ============ Header ============ */
    .hd {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 40px;
      padding-bottom: 28px;
      border-bottom: 1px solid var(--rule);
      margin-bottom: 40px;
    }
    .hd-title {
      font-family: var(--serif);
      font-weight: 700;
      font-size: clamp(34px, 4.4vw, 56px);
      line-height: 1.05;
      letter-spacing: -0.015em;
      margin: 0 0 10px;
    }
    .hd-meta {
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hd-verdict {
      font-family: var(--serif);
      font-style: italic;
      font-size: 18px;
      line-height: 1.45;
      color: var(--muted);
      max-width: 36ch;
      text-align: right;
    }
    .hd-verdict strong { color: var(--ink); font-style: normal; font-weight: 600; }

    /* ============ Top row: radar + score table ============ */
    .top {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 48px;
      margin-bottom: 64px;
      align-items: center;
    }
    @media (max-width: 800px) {
      .top { grid-template-columns: 1fr; }
    }
    .radar-card {
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 24px;
      text-align: center;
    }
    .radar-card .lbl {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 14px;
    }
    .radar-card svg { width: 100%; height: auto; max-width: 300px; }
    .radar-card .overall {
      font-family: var(--serif);
      font-size: 13px;
      color: var(--muted);
      margin-top: 18px;
    }
    .radar-card .overall .n {
      font-weight: 700;
      font-size: 20px;
      color: var(--ink);
      letter-spacing: -0.01em;
    }

    /* Score table */
    .scores { display: flex; flex-direction: column; gap: 14px; }
    .score-row {
      display: grid;
      grid-template-columns: 22ch 1fr 6ch 14ch;
      gap: 16px;
      align-items: center;
      padding: 14px 0;
      border-top: 1px solid var(--rule);
    }
    .score-row:first-child { border-top: 0; }
    .score-name {
      font-family: var(--serif);
      font-weight: 600;
      font-size: 17px;
    }
    .score-name .en {
      display: block;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 400;
      margin-top: 2px;
    }
    .score-bar {
      position: relative;
      height: 4px;
      background: var(--rule);
      border-radius: 2px;
      overflow: hidden;
    }
    .score-bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      background: var(--ink);
    }
    .score-num {
      font-family: var(--serif);
      font-weight: 700;
      font-size: 24px;
      letter-spacing: -0.02em;
      text-align: right;
    }
    .score-num .denom {
      font-size: 13px;
      color: var(--muted);
      font-weight: 400;
    }
    .score-band {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--muted);
      text-align: right;
    }
    .band-broken { color: var(--bad); }
    .band-functional { color: var(--muted); }
    .band-strong { color: var(--good); }
    .band-exceptional { color: var(--accent); }

    /* ============ Dimension cards ============ */
    .section-title {
      font-family: var(--serif);
      font-weight: 600;
      font-size: 22px;
      letter-spacing: -0.005em;
      margin: 64px 0 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--rule);
    }
    .section-title .en {
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 400;
      margin-left: 10px;
    }
    .dim-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 800px) {
      .dim-grid { grid-template-columns: 1fr; }
    }
    .dim {
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 22px 24px;
    }
    .dim-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 8px;
    }
    .dim-name {
      font-family: var(--serif);
      font-weight: 600;
      font-size: 19px;
    }
    .dim-name .en {
      display: block;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 400;
      margin-top: 2px;
    }
    .dim-score {
      font-family: var(--serif);
      font-weight: 700;
      font-size: 26px;
      letter-spacing: -0.02em;
    }
    .dim-score .denom {
      font-size: 13px;
      color: var(--muted);
      font-weight: 400;
    }
    .dim-evidence {
      font-family: var(--serif);
      font-size: 14.5px;
      line-height: 1.65;
      color: #2d2d30;
      margin: 10px 0 16px;
    }
    .dim-evidence code {
      font-family: var(--mono);
      font-size: 0.88em;
      background: var(--rule);
      padding: 1px 6px;
      border-radius: 3px;
    }
    .dim-tags {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .tag-row {
      display: grid;
      grid-template-columns: 70px 1fr;
      gap: 12px;
      font-size: 13.5px;
      line-height: 1.55;
    }
    .tag {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 3px;
      color: var(--paper);
      align-self: start;
      text-align: center;
    }
    .tag-keep { background: var(--good); }
    .tag-fix { background: var(--warn); }
    .tag-qw { background: #2c4d6e; }

    /* ============ Action lists ============ */
    .lists-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      margin-top: 24px;
    }
    @media (max-width: 800px) {
      .lists-grid { grid-template-columns: 1fr; }
    }
    .list-card {
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 6px;
      padding: 22px 24px;
    }
    .list-head {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.26em;
      text-transform: uppercase;
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--rule);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .list-head.keep { color: var(--good); }
    .list-head.fix { color: var(--warn); }
    .list-head.qw { color: #2c4d6e; }
    .list-head .ct {
      font-size: 16px;
      font-family: var(--serif);
      letter-spacing: -0.01em;
      color: var(--ink);
      font-weight: 600;
    }
    .list-card ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .list-card li {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 10px;
      font-family: var(--serif);
      font-size: 14.5px;
      line-height: 1.55;
    }
    .list-card li::before {
      content: "";
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1.5px solid var(--rule);
      margin-top: 4px;
    }
    .list-card li code {
      font-family: var(--mono);
      font-size: 0.85em;
      background: var(--bg);
      padding: 1px 6px;
      border-radius: 3px;
    }

    /* ============ Footer ============ */
    .ft {
      margin-top: 80px;
      padding-top: 24px;
      border-top: 1px solid var(--rule);
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      flex-wrap: wrap;
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .ft .br { color: var(--ink); font-weight: 600; }
  </style>
</head>
<body>
  <div class="wrap">

    <!-- ============ Header ============ -->
    <header class="hd">
      <div>
        <div class="hd-meta">
          <span>5-Dim Critique</span>
          <span>·</span>
          <span>2026.04.27</span>
          <span>·</span>
          <span>OD · Critique skill</span>
        </div>
        <h1 class="hd-title">magazine-web-ppt<br>example deck</h1>
      </div>
      <p class="hd-verdict">
        <strong>7.4 / 10 overall.</strong> Strong philosophical
        backbone and detail — the deck looks like one designer made
        every slide. Innovation is conservative on purpose; functionality
        loses points only because the example ships without real images.
      </p>
    </header>

    <!-- ============ Radar + Score table ============ -->
    <section class="top">
      <div class="radar-card">
        <div class="lbl">Score Radar</div>
        <!-- Pentagon radar, 5 axes; score grid at 0/2.5/5/7.5/10 -->
        <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg" aria-label="Score radar chart">
          <defs>
            <style>
              .axis { stroke: #e2dfd7; stroke-width: 1; fill: none; }
              .grid { stroke: #e8e5dd; stroke-width: 1; fill: none; }
              .grid-mid { stroke: #e2dfd7; stroke-width: 1; fill: none; }
              .area { fill: rgba(201,100,66,0.18); stroke: #c96442; stroke-width: 1.6; stroke-linejoin: round; }
              .dot { fill: #c96442; }
              .lbl { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; fill: #6b6964; }
              .lbl-n { font-family: 'Source Serif 4', serif; font-size: 12px; font-weight: 600; fill: #1a1a1c; }
            </style>
          </defs>
          <!-- Center 150,150. Radius 110 = 10/10. -->
          <!-- Grid rings 25/50/75/100% of 110 = 27.5 / 55 / 82.5 / 110 -->
          <!-- Pentagon angles: -90, -18, 54, 126, 198 (deg) measured from center.
               Order: top=Philosophy, top-right=Hierarchy, bottom-right=Detail,
                      bottom-left=Function, top-left=Innovation -->
          <!-- Outer rings (5 sided) -->
          <polygon class="grid" points="150,40 254.66,116.05 214.69,238.95 85.31,238.95 45.34,116.05" />
          <polygon class="grid" points="150,67.5 228.47,124.54 198.51,216.71 101.49,216.71 71.53,124.54" />
          <polygon class="grid-mid" points="150,95 202.33,133.02 182.34,194.48 117.66,194.48 97.67,133.02" />
          <polygon class="grid" points="150,122.5 176.16,141.51 166.17,172.24 133.83,172.24 123.84,141.51" />
          <!-- Axes -->
          <line class="axis" x1="150" y1="150" x2="150" y2="40" />
          <line class="axis" x1="150" y1="150" x2="254.66" y2="116.05" />
          <line class="axis" x1="150" y1="150" x2="214.69" y2="238.95" />
          <line class="axis" x1="150" y1="150" x2="85.31" y2="238.95" />
          <line class="axis" x1="150" y1="150" x2="45.34" y2="116.05" />

          <!-- Score area · Phil 8 / Hier 7 / Det 8 / Func 6 / Innov 5
               Distances from center (radius 110):
               Phil   8 → 88     :  150, 150 - 88           = 150, 62
               Hier   7 → 77     :  150 + 77*sin(72°),  150 - 77*cos(72°)
                                  ≈  150 + 73.24,  150 - 23.79
                                  =  223.24, 126.21
               Det    8 → 88     :  150 + 88*sin(144°), 150 - 88*cos(144°)
                                  ≈  150 + 51.72,  150 + 71.20
                                  =  201.72, 221.20
               Func   6 → 66     :  150 - 66*sin(36°),  150 + 66*cos(36°)
                                  ≈  150 - 38.79,  150 + 53.40
                                  =  111.21, 203.40
               Innov  5 → 55     :  150 - 55*sin(108°),150 - 55*cos(108°)
                                  ≈  150 - 52.32,  150 + 17.00
                                  =  97.68, 167.00
                                  Wait - cos(108°) is negative, so 150 - 55*(-0.309) = 150 + 17, that's bottom of axis. But Innov axis is top-left. Let me redo.
                                  Innov axis end point: 45.34, 116.05. Vector from center (150,150): (-104.66, -33.95), magnitude 110.
                                  At score 5, scale = 5/10 = 0.5: center + 0.5 * (-104.66, -33.95) = 150 - 52.33, 150 - 16.97 = 97.67, 133.03 -->
          <polygon class="area" points="150,62 223.24,126.21 201.72,221.20 111.21,203.40 97.67,133.03" />
          <circle class="dot" cx="150" cy="62" r="3" />
          <circle class="dot" cx="223.24" cy="126.21" r="3" />
          <circle class="dot" cx="201.72" cy="221.20" r="3" />
          <circle class="dot" cx="111.21" cy="203.40" r="3" />
          <circle class="dot" cx="97.67" cy="133.03" r="3" />

          <!-- Axis labels -->
          <text class="lbl" x="150" y="28" text-anchor="middle">PHILOSOPHY</text>
          <text class="lbl-n" x="150" y="14" text-anchor="middle">8</text>
          <text class="lbl" x="270" y="116" text-anchor="middle">HIERARCHY</text>
          <text class="lbl-n" x="278" y="100" text-anchor="middle">7</text>
          <text class="lbl" x="220" y="259" text-anchor="middle">DETAIL</text>
          <text class="lbl-n" x="220" y="275" text-anchor="middle">8</text>
          <text class="lbl" x="80" y="259" text-anchor="middle">FUNCTION</text>
          <text class="lbl-n" x="80" y="275" text-anchor="middle">6</text>
          <text class="lbl" x="30" y="116" text-anchor="middle">INNOVATION</text>
          <text class="lbl-n" x="22" y="100" text-anchor="middle">5</text>
        </svg>
        <div class="overall">Overall · <span class="n">7.4</span> / 10 · band <em>Strong</em></div>
      </div>

      <div class="scores" aria-label="Score breakdown">
        <div class="score-row">
          <div class="score-name">Philosophy consistency<span class="en">Phil. cons.</span></div>
          <div class="score-bar"><span class="score-bar-fill" style="width:80%"></span></div>
          <div class="score-num">8<span class="denom">/10</span></div>
          <div class="score-band band-strong">Strong</div>
        </div>
        <div class="score-row">
          <div class="score-name">Visual hierarchy<span class="en">Hier.</span></div>
          <div class="score-bar"><span class="score-bar-fill" style="width:70%"></span></div>
          <div class="score-num">7<span class="denom">/10</span></div>
          <div class="score-band band-strong">Strong</div>
        </div>
        <div class="score-row">
          <div class="score-name">Detail execution<span class="en">Detail</span></div>
          <div class="score-bar"><span class="score-bar-fill" style="width:80%"></span></div>
          <div class="score-num">8<span class="denom">/10</span></div>
          <div class="score-band band-strong">Strong</div>
        </div>
        <div class="score-row">
          <div class="score-name">Functionality<span class="en">Func.</span></div>
          <div class="score-bar"><span class="score-bar-fill" style="width:60%"></span></div>
          <div class="score-num">6<span class="denom">/10</span></div>
          <div class="score-band band-functional">Functional</div>
        </div>
        <div class="score-row">
          <div class="score-name">Innovation<span class="en">Innov.</span></div>
          <div class="score-bar"><span class="score-bar-fill" style="width:50%"></span></div>
          <div class="score-num">5<span class="denom">/10</span></div>
          <div class="score-band band-functional">Functional</div>
        </div>
      </div>
    </section>

    <!-- ============ Dimension cards ============ -->
    <h2 class="section-title">Dimension reports<span class="en">Evidence per axis</span></h2>

    <div class="dim-grid">
      <article class="dim">
        <div class="dim-head">
          <div class="dim-name">Philosophy consistency<span class="en">Phil. cons. · 哲学一致性</span></div>
          <div class="dim-score">8<span class="denom">/10</span></div>
        </div>
        <p class="dim-evidence">
          The 9-slide rhythm reads as a single direction (Monocle Editorial)
          from cover to close. <code>chrome</code> vocabulary stays in one
          register: <em>"A Talk · 2026.04.22"</em>, <em>"Act II · 04 / 09"</em>,
          <em>"Page 06 · 金句"</em>. The drift is the <code>kicker</code> on
          slide 5 — <em>"Act II"</em> is good, but the slide title <em>"折叠"</em>
          is a one-character display word that competes with the Act number for
          eyeballs. Worth tightening.
        </p>
        <div class="dim-tags">
          <div class="tag-row"><span class="tag tag-keep">Keep</span><span>The chrome / kicker / foot vocabulary across all 9 slides — it's the deck's identity.</span></div>
          <div class="tag-row"><span class="tag tag-fix">Fix</span><span>Slide 5: bump the kicker to <em>"Act II · 折叠"</em> or shrink the display title to clear the hierarchy.</span></div>
        </div>
      </article>

      <article class="dim">
        <div class="dim-head">
          <div class="dim-name">Visual hierarchy<span class="en">Hier. · 视觉层级</span></div>
          <div class="dim-score">7<span class="denom">/10</span></div>
        </div>
        <p class="dim-evidence">
          Hero pages (1, 5, 7, 9) are textbook — display serif dominates,
          <code>kicker</code> and <code>meta-row</code> recede. Body pages
          mostly hold up: stat-cards on slide 2 use <code>.stat-label</code>
          (mono small) → <code>.stat-nb</code> (serif large) → <code>.stat-note</code>
          (sans body), three tiers, no collision. The miss is slide 3's
          <code>callout</code> — its left-rule competes visually with the
          <code>.h-xl</code> heading because both sit at the same x-coord
          and similar weight. Eye doesn't know if to read heading-first or
          quote-first.
        </p>
        <div class="dim-tags">
          <div class="tag-row"><span class="tag tag-keep">Keep</span><span>Stat-card 3-tier structure on slide 2 — copy this everywhere.</span></div>
          <div class="tag-row"><span class="tag tag-fix">Fix</span><span>Slide 3: indent the <code>callout</code> by <code>2vw</code> or push it below the lead so it visibly belongs to a lower tier.</span></div>
        </div>
      </article>

      <article class="dim">
        <div class="dim-head">
          <div class="dim-name">Detail execution<span class="en">Detail · 细节执行</span></div>
          <div class="dim-score">8<span class="denom">/10</span></div>
        </div>
        <p class="dim-evidence">
          Magazine-grade in places — every <code>.foot</code> aligns
          baseline-to-baseline across all 9 slides; <code>.meta-row</code>
          uses one mono spec throughout (<code>.16em</code> tracking,
          uppercase). Pipeline on slide 4 keeps perfect grid even when
          column count drops to 3. Two real misses: (1) Slide 3 image-slot
          uses <code>aspect-ratio:16/10</code> but the placeholder text
          inside is centered which makes it look hollow at viewport widths
          ≤ 1100px; (2) the dot-nav at the bottom overlaps the foot text
          on slide 5 because the hero centered grid eats vertical space.
        </p>
        <div class="dim-tags">
          <div class="tag-row"><span class="tag tag-keep">Keep</span><span>The mono <code>.foot</code> spec — it's the deck's grace note, do not change letter-spacing.</span></div>
          <div class="tag-row"><span class="tag tag-fix">Fix</span><span>Slide 5 hero grid: cap inner content at <code>min-height:78vh</code> so the foot stays clear of the dot-nav.</span></div>
        </div>
      </article>

      <article class="dim">
        <div class="dim-head">
          <div class="dim-name">Functionality<span class="en">Func. · 功能性</span></div>
          <div class="dim-score">6<span class="denom">/10</span></div>
        </div>
        <p class="dim-evidence">
          Keyboard / wheel / touch navigation works correctly inside the
          host iframe (verified: ←/→/PageUp/PageDown all advance). ESC
          opens the index overview, dot clicks register. Big miss is the
          example ships <em>without real images</em> — slide 3 shows a
          dashed <code>.img-slot</code> placeholder where a product
          screenshot belongs, which is the right call for an example file
          but means the user can't judge how the layout holds at full
          fidelity. Second miss: <code>iframe</code> sandbox is
          <code>allow-scripts</code> only in the example card, so the
          WebGL background loads but the dot-nav inside the iframe takes
          a click before keyboard nav captures focus.
        </p>
        <div class="dim-tags">
          <div class="tag-row"><span class="tag tag-keep">Keep</span><span>The 5-bug-fix nav script (real scroller detection, capture-phase listeners) — proven and stable.</span></div>
          <div class="tag-row"><span class="tag tag-fix">Fix</span><span>Add a <code>data:</code> URI placeholder image (1×1 colored gradient) in the example so slide 3's layout reads at any width.</span></div>
        </div>
      </article>

      <article class="dim">
        <div class="dim-head">
          <div class="dim-name">Innovation<span class="en">Innov. · 创新性</span></div>
          <div class="dim-score">5<span class="denom">/10</span></div>
        </div>
        <p class="dim-evidence">
          Innovation is intentionally conservative — this is a port of
          歸藏's guizang-ppt-skill, and the value proposition is
          <em>predictability</em>, not novelty. The dual WebGL background
          (Holographic Dispersion on dark, Spiral Vortex on light) is the
          one earned moment; the cross-fade on slide-theme transitions is
          subtle and well-timed. But everything else (layout vocabulary,
          chrome / foot pattern, theme presets) is faithfully replicated
          from the upstream. There is no "lean-forward" surprise that
          makes a viewer screenshot a slide. For its declared purpose
          (Monocle Editorial direction), this is appropriate. For an
          AI demo-day deck, it's a missed opportunity.
        </p>
        <div class="dim-tags">
          <div class="tag-row"><span class="tag tag-keep">Keep</span><span>The dual-shader cross-fade — it's the only "magic" the deck performs and it earns its keep.</span></div>
          <div class="tag-row"><span class="tag tag-qw">Quick win</span><span>Add one <em>typographic</em> moment per deck — e.g. an oversized italic <code>em</code> kicker that breaks the grid on the closing slide.</span></div>
        </div>
      </article>
    </div>

    <!-- ============ Action lists ============ -->
    <h2 class="section-title">Action lists<span class="en">Keep · Fix · Quick wins</span></h2>

    <div class="lists-grid">
      <section class="list-card">
        <div class="list-head keep"><span>Keep</span><span class="ct">don't break it</span></div>
        <ul>
          <li>The 9-page rhythm: <code>hero dark → light → dark → light → hero light → dark → hero dark → light → hero light</code>. It's the gold standard.</li>
          <li>Dual WebGL backdrops + the <code>1.2s</code> cross-fade between dark and light slides.</li>
          <li><code>chrome</code> / <code>kicker</code> / <code>foot</code> vocabulary — they carry the Monocle direction.</li>
          <li>3-tier <code>stat-card</code> on slide 2 (<code>label</code> → <code>nb</code> → <code>note</code>).</li>
        </ul>
      </section>

      <section class="list-card">
        <div class="list-head fix"><span>Fix</span><span class="ct">P0 — visually expensive</span></div>
        <ul>
          <li>Slide 3 callout indent — currently competes with <code>.h-xl</code>; push 2vw right or below the lead.</li>
          <li>Slide 5 hero centered grid — cap content height at <code>78vh</code> so foot doesn't overlap the dot nav.</li>
          <li>Slide 3 add a <code>data:</code> gradient placeholder image so the layout reads at narrow widths even without real assets.</li>
          <li>Slide 5 kicker / display: pick one to be primary — currently both fight.</li>
        </ul>
      </section>

      <section class="list-card">
        <div class="list-head qw"><span>Quick wins</span><span class="ct">5–15 min, high signal</span></div>
        <ul>
          <li>Inject <code>data-screen-label</code> on every slide for accessibility + grep self-checks.</li>
          <li>Add one oversized italic <em>en</em> moment on the closing slide for typographic surprise.</li>
          <li>Move the <code>#hint</code> overlay from <code>opacity:.4</code> to <code>.55</code> on hero pages — currently invisible.</li>
          <li>Add a print stylesheet (one slide per page) so PDF export carries the rhythm.</li>
        </ul>
      </section>
    </div>

    <footer class="ft">
      <span>OD · Critique skill · v0.1</span>
      <span>5 dimensions · Phil / Hier / Det / Func / Innov</span>
      <span class="br">github.com/alchaincyf/huashu-design</span>
    </footer>
  </div>
</body>
</html>

\`\`\``},{name:`dashboard`,description:`Admin / analytics dashboard in a single HTML file. Fixed left sidebar, top bar with user/search, main grid of KPI cards and one or two charts. Use when the brief asks for a "dashboard", "admin", "analytics", or "control panel" screen.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/dashboard`,body:`# Dashboard Skill

Produce a single-screen admin / analytics dashboard.

## Workflow

1. **Read the active DESIGN.md** (injected above). Colors, typography, spacing,
   component styling all come from it. Do not invent new tokens.
2. **Classify** what the dashboard monitors (sales, traffic, usage, incidents,
   ops, etc.) from the brief. Generate specific, plausible metric names and
   values — no "Metric A / Metric B" placeholders.
3. **Lay out** the required regions:
   - **Left sidebar** (220–260px): brand mark at top, 6–8 nav links with
     icons, active state uses the DS accent.
   - **Top bar**: page title on the left, search input + user avatar / status
     on the right.
   - **Main**:
     - Row 1: 3–4 KPI cards (label + big number + delta vs. prior period).
     - Row 2: one primary chart (full width or 2/3) — render as an inline SVG
       line / bar / area chart drawn from real-looking numbers.
     - Row 3: one secondary chart or table (recent events, top items, etc.).
4. **Write** one self-contained HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS in one inline \`<style>\` block.
   - CSS Grid for the overall layout; Flexbox inside cards.
   - Semantic HTML: \`<aside>\`, \`<header>\`, \`<main>\`, \`<section>\`.
   - Tag each logical region with \`data-od-id="slug"\` for comment mode.
5. **Charts**: inline SVG only, no JS libraries. A line chart is ~10 lines of
   \`<polyline>\` with a subtle area fill. A bar chart is N \`<rect>\`s with
   DS-accent fill. Label axes lightly (muted text, smaller scale).
6. **Self-check**:
   - Every color comes from DESIGN.md tokens.
   - Accent used at most twice (sidebar active + one chart highlight).
   - Sidebar + top bar are sticky; main scrolls independently.
   - Density matches the DS mood — airy DSes get more padding, dense DSes
     (trading, crypto) tighten rows.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="dashboard-slug" type="text/html" title="Dashboard Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pulse — analytics overview</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1b1a; --muted: #6b6964; --border: #e6e4e0;
      --accent: #c96442; --surface: #ffffff; --good: #2f7d4a; --bad: #b53a2a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 16px; }
    .brand { font-weight: 600; padding: 8px 10px 18px; }
    .nav { display: flex; flex-direction: column; gap: 2px; }
    .nav a { padding: 7px 10px; border-radius: 6px; color: var(--fg); text-decoration: none; }
    .nav a.active { background: var(--bg); font-weight: 500; }
    .nav a:hover { background: var(--bg); }
    .nav .group-label { font-size: 11px; color: var(--muted); padding: 14px 10px 6px; text-transform: uppercase; letter-spacing: 0.06em; }
    main { padding: 0 28px 56px; }
    .topbar { padding: 16px 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); margin-bottom: 24px; }
    .topbar h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
    .topbar .right { display: flex; align-items: center; gap: 12px; color: var(--muted); }
    button { font: inherit; cursor: pointer; padding: 7px 13px; border-radius: 6px; }
    .btn-primary { background: var(--accent); color: white; border: 1px solid var(--accent); }
    .btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    @media (max-width: 900px) { .kpis { grid-template-columns: repeat(2, 1fr); } }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }
    .kpi .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .kpi .value { font-size: 28px; letter-spacing: -0.02em; }
    .kpi .delta { font-size: 12px; margin-top: 4px; }
    .kpi .delta.up { color: var(--good); }
    .kpi .delta.down { color: var(--bad); }
    .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
    .panel h3 { margin: 0 0 16px; font-size: 14px; font-weight: 500; }
    .chart { height: 240px; background: linear-gradient(180deg, rgba(201,100,66,0.06), transparent); border-bottom: 1px solid var(--border); position: relative; overflow: hidden; }
    .chart svg { width: 100%; height: 100%; display: block; }
    .panels-row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .panels-row { grid-template-columns: 1fr; } }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 6px; border-top: 1px solid var(--border); }
    th { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
    .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); }
    .pill.good { color: var(--good); border-color: rgba(47,125,74,0.3); }
    .pill.bad { color: var(--bad); border-color: rgba(181,58,42,0.3); }
  </style>
</head>
<body>
  <aside class="sidebar" data-od-id="sidebar">
    <div class="brand">◐ Pulse</div>
    <nav class="nav">
      <a href="#" class="active">Overview</a>
      <a href="#">Funnels</a>
      <a href="#">Cohorts</a>
      <a href="#">Sessions</a>
      <span class="group-label">Workspace</span>
      <a href="#">Sources</a>
      <a href="#">Members</a>
      <a href="#">Billing</a>
      <a href="#">Settings</a>
    </nav>
  </aside>
  <main>
    <div class="topbar" data-od-id="topbar">
      <h1>Overview · April 2026</h1>
      <div class="right">
        <button class="btn-secondary">Last 30 days ▾</button>
        <button class="btn-primary">+ New report</button>
      </div>
    </div>

    <div class="kpis" data-od-id="kpis">
      <div class="kpi"><div class="label">MRR</div><div class="value">$48.2K</div><div class="delta up">+12.4% MoM</div></div>
      <div class="kpi"><div class="label">Active accounts</div><div class="value">3,184</div><div class="delta up">+204 this month</div></div>
      <div class="kpi"><div class="label">Churn (30d)</div><div class="value">2.1%</div><div class="delta down">+0.4 pp</div></div>
      <div class="kpi"><div class="label">P95 latency</div><div class="value">182 ms</div><div class="delta up">-23 ms</div></div>
    </div>

    <div class="panels-row">
      <div class="panel" data-od-id="chart-panel">
        <h3>Revenue · 30 days</h3>
        <div class="chart">
          <svg viewBox="0 0 600 240" preserveAspectRatio="none">
            <polyline fill="none" stroke="#c96442" stroke-width="2" points="0,180 30,170 60,150 90,160 120,140 150,120 180,130 210,110 240,90 270,100 300,80 330,70 360,80 390,60 420,50 450,60 480,40 510,30 540,40 570,20 600,10" />
          </svg>
        </div>
      </div>
      <div class="panel" data-od-id="signups-panel">
        <h3>New accounts</h3>
        <table>
          <thead><tr><th>Account</th><th>Plan</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>Linear</td><td>Team</td><td><span class="pill good">active</span></td></tr>
            <tr><td>Cursor</td><td>Pro</td><td><span class="pill good">active</span></td></tr>
            <tr><td>Notion</td><td>Team</td><td><span class="pill bad">trial</span></td></tr>
            <tr><td>Vercel</td><td>Enterprise</td><td><span class="pill good">active</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel" data-od-id="recent-events">
      <h3>Recent events</h3>
      <table>
        <thead><tr><th>Time</th><th>Account</th><th>Event</th><th>Plan</th></tr></thead>
        <tbody>
          <tr><td>2:14 pm</td><td>Acme Co</td><td>Upgraded to Team</td><td>Team</td></tr>
          <tr><td>1:48 pm</td><td>Northwind</td><td>Connected GitHub</td><td>Pro</td></tr>
          <tr><td>1:32 pm</td><td>Globex</td><td>Cancelled subscription</td><td>Solo</td></tr>
          <tr><td>12:51 pm</td><td>Initech</td><td>New seat invited</td><td>Team</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>

\`\`\``},{name:`dating-web`,description:`A consumer-feeling dating / matchmaking dashboard — left rail navigation, ticker bar of community signals, headline KPIs, a 30-day mutual-matches bar chart, and a match-rate trend block. Editorial typography, restrained accent. Use when the brief asks for a "dating site", "matchmaking", "community dashboard", "social network dashboard", or any consumer product where the data is the story.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/dating-web`,body:`# Dating Web Skill

Produce a single-screen consumer dashboard that feels like a Sunday-paper
dating column rendered as software. Editorial type, single restrained
accent, lots of negative space, *no* swipe deck or hookup tropes.

## Workflow

1. **Read the active DESIGN.md** (injected above). Lean into a serif display
   token for the metric numerals — these screens live or die on numerals.
2. **Pick a brand voice** — wry, observational, slightly literary. Generate
   real, specific copy. Examples: "the people who'd text back within a day",
   "manageable. two are now friends.", "your single greatest compatibility
   asset."
3. **Layout**, in order:
   - **Top ticker** — single-row horizontal strip across the top in a
     sans-serif eyebrow style: tagline left, "NEXT TIER AT 2,080 MUTUALS"
     right, both in mono caps with letter-spacing. Thin rule below.
   - **Left rail** — 220–260px sidebar. Brand wordmark in serif italic at
     top. User card (avatar / handle / ratio / tier). Three groups of nav:
     "TODAY" (specimen, inbox, queue, notifications), "YOU" (your stats,
     mutuals & communities, blocked, settings), "ARCHIVE" (past issues,
     expired matches). Active item gets accent text + accent dot.
   - **Main content**:
     - **KPI grid** — 3 columns × 3 rows (or 9 cells). Each cell: small
       caps mono label, an oversized serif numeral (use accent or muted
       green for positive, muted red for caution), one-line italic
       footnote. Plausible specifics — "1,842 ↑ 41 this wk · healthy
       growth.", "14% above median for your cohort.", "4 / exes in your
       circle · manageable. two are now friends."
     - **Bar chart panel** — "mutuals — last 30 days". Tall thin black
       bars, last two days highlighted in accent. Caption above with
       "↑ TRENDING UP · +3 CLOSE MUTUALS THIS MONTH · TWO VIA THE SAME
       OFFSITE" in mono.
     - **Trend panel** — "match rate — last 12 weeks". One line of body
       copy below ("STEADY CLIMB FROM 8% → 14%. ATTRIBUTABLE TO ONE
       COMMUNITY JOIN…"). Footer rule.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Background creamy off-white, body serif, mono labels everywhere.
   - Use \`font-feature-settings: 'tnum'\` on the metric numerals.
   - SVG bar chart with ~30 bars, varied heights.
   - \`data-od-id\` on ticker, sidebar, kpi grid, chart, trend.
5. **Self-check**:
   - Reads as restrained, editorial, slightly funny — not horny.
   - Single accent token used in 3–4 places max (one KPI, two highlight
     bars, one nav active state).
   - No swipe deck, no hearts, no fire emoji.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="dating-slug" type="text/html" title="Dating Dashboard — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mutuals · your dating life, measured by the company you keep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Serif+Text:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --paper: #f4ede0;
      --panel: #f9f3e7;
      --ink: #1f1c14;
      --muted: #7a7264;
      --rule: #d6cdb6;
      --accent: #c14a2b;
      --good: #406b3a;
      --bad: #b6422f;
      --serif-display: 'DM Serif Display', 'Iowan Old Style', Georgia, serif;
      --serif-body: 'DM Serif Text', 'Iowan Old Style', Georgia, serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.55 var(--serif-body); }

    .ticker {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 28px;
      border-bottom: 1px solid var(--ink);
      font: 11px/1 var(--mono);
      color: var(--muted);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .ticker .left { display: flex; align-items: center; gap: 18px; }
    .ticker b { color: var(--ink); font-weight: 500; }

    .layout { display: grid; grid-template-columns: 232px 1fr; min-height: calc(100vh - 44px); }
    aside.rail {
      border-right: 1px solid var(--ink);
      padding: 22px 22px 22px 28px;
      display: flex; flex-direction: column; gap: 22px;
    }
    aside .brand { font: italic 800 30px/1 var(--serif-display); letter-spacing: -0.005em; }
    aside .brand .dot { color: var(--accent); }
    aside .user { display: flex; align-items: center; gap: 10px; }
    aside .avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--ink); color: var(--paper); display: grid; place-items: center; font: 700 12px/1 var(--mono); letter-spacing: 0.06em; }
    aside .user .meta { font: 13px/1.2 var(--mono); }
    aside .user .meta b { display: block; color: var(--ink); font-weight: 500; }
    aside .user .meta span { color: var(--muted); font-size: 11px; letter-spacing: 0.06em; }

    aside h4 { font: 11px/1 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 10px; }
    aside ul { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-direction: column; gap: 4px; }
    aside li { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 4px; font: 15.5px/1.2 var(--serif-body); color: var(--ink); cursor: default; }
    aside li.active { background: rgba(193,74,43,0.10); color: var(--accent); font-weight: 600; }
    aside li.active::before { content: '●'; color: var(--accent); margin-right: 6px; font-size: 9px; }
    aside li .badge { background: var(--accent); color: var(--paper); font: 10px/1 var(--mono); padding: 3px 6px; border-radius: 999px; letter-spacing: 0.06em; }
    aside li .badge.gray { background: var(--ink); }

    aside .status {
      margin-top: auto;
      padding-top: 18px;
      border-top: 1px solid var(--rule);
      font: 11px/1.4 var(--mono);
      color: var(--muted);
      letter-spacing: 0.06em;
    }
    aside .status .live::before { content: '●'; color: #2f7d4a; margin-right: 6px; }

    main { padding: 30px 36px 44px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-auto-rows: minmax(120px, auto);
      gap: 22px 36px;
      margin-bottom: 36px;
    }
    .stat { padding: 4px 0 14px; border-bottom: 1px solid var(--rule); }
    .stat .label { font: 11px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 6px; }
    .stat .value {
      font: 800 56px/1.05 var(--serif-display);
      letter-spacing: -0.01em;
      font-feature-settings: 'tnum';
      margin-bottom: 6px;
    }
    .stat .value.good { color: var(--good); }
    .stat .value.bad { color: var(--bad); }
    .stat .value em { font-style: italic; font-weight: 400; }
    .stat .note { font: italic 13.5px/1.4 var(--serif-body); color: var(--muted); max-width: 32ch; }
    .stat .arrow { font-style: normal; color: var(--good); font-size: 14px; }

    .panel { padding: 18px 0 24px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
    .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 14px; }
    .panel-head h3 { margin: 0; font: italic 24px/1 var(--serif-display); letter-spacing: -0.005em; }
    .panel-head .meta { font: 11px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.16em; text-transform: uppercase; max-width: 56ch; text-align: right; }
    .panel svg { width: 100%; height: 220px; display: block; }
    .panel .axis { display: flex; justify-content: space-between; font: 10px/1 var(--mono); color: var(--muted); letter-spacing: 0.1em; padding: 8px 4px 0; text-transform: uppercase; }

    .lower-panel .lede { font: italic 15px/1.55 var(--serif-body); color: var(--muted); margin: 0; max-width: 70ch; }
    .lower-panel .lede b { color: var(--ink); font-style: normal; font-weight: 600; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      aside.rail { border-right: none; border-bottom: 1px solid var(--ink); }
      .grid { grid-template-columns: repeat(2, 1fr); gap: 18px 28px; }
    }
  </style>
</head>
<body>
  <div class="ticker" data-od-id="ticker">
    <div class="left">
      <span>YOUR DATING LIFE, MEASURED BY THE COMPANY YOU KEEP</span>
      <span style="opacity:0.6;">·</span>
      <span>REVIEWED WEEKLY</span>
    </div>
    <div>NEXT TIER AT <b>2,080 MUTUALS</b></div>
  </div>

  <div class="layout">
    <aside class="rail" data-od-id="rail">
      <div class="brand">mutuals<span class="dot">.</span></div>
      <div class="user">
        <div class="avatar">si</div>
        <div class="meta"><b>@signals</b><span>RATIO 22.9 · TIER III</span></div>
      </div>

      <div>
        <h4>Today</h4>
        <ul>
          <li>specimen <span class="badge">3</span></li>
          <li>inbox <span class="badge">3</span></li>
          <li>queue <span style="font:11px/1 var(--mono);color:var(--muted);">6</span></li>
          <li>notifications <span class="badge gray">12</span></li>
        </ul>
      </div>
      <div>
        <h4>You</h4>
        <ul>
          <li class="active">your stats</li>
          <li>mutuals &amp; communities</li>
          <li>blocked <span style="font:11px/1 var(--mono);color:var(--muted);">14</span></li>
          <li>settings</li>
        </ul>
      </div>
      <div>
        <h4>Archive</h4>
        <ul>
          <li>past issues</li>
          <li>expired matches <span style="font:11px/1 var(--mono);color:var(--muted);">7</span></li>
        </ul>
      </div>

      <div class="status">
        <div class="live">online · last match 11m ago</div>
        <div style="opacity:0.7;margin-top:2px;">mutuals.v0.6.1</div>
      </div>
    </aside>

    <main data-od-id="main">
      <section class="grid" data-od-id="kpis">
        <div class="stat">
          <div class="label">Mutuals on file</div>
          <div class="value"><em>1,842</em></div>
          <p class="note"><span class="arrow">↑</span> 41 this wk · healthy growth.</p>
        </div>
        <div class="stat">
          <div class="label">Replies in 24h</div>
          <div class="value good">47</div>
          <p class="note">the people who'd text back within a day.</p>
        </div>
        <div class="stat">
          <div class="label">Communities</div>
          <div class="value"><em>14</em></div>
          <p class="note">4 active · 7 lurking · 3 inferred.</p>
        </div>

        <div class="stat">
          <div class="label">Match rate</div>
          <div class="value good">14%</div>
          <p class="note">above median for your cohort.</p>
        </div>
        <div class="stat">
          <div class="label">2nd dates</div>
          <div class="value"><em>3</em></div>
          <p class="note">of 7 first dates this year. you commit.</p>
        </div>
        <div class="stat">
          <div class="label">Exes in your circle</div>
          <div class="value bad">4</div>
          <p class="note">manageable. two are now friends.</p>
        </div>

        <div class="stat">
          <div class="label">Shared blocks</div>
          <div class="value"><em>214</em></div>
          <p class="note">your single greatest compatibility asset.</p>
        </div>
        <div class="stat">
          <div class="label">Avg response</div>
          <div class="value"><em>2.1<span style="font-size:32px;">h</span></em></div>
          <p class="note">too fast. wait 4–6h. they notice.</p>
        </div>
        <div class="stat">
          <div class="label">Logged-off hrs</div>
          <div class="value bad">4</div>
          <p class="note">/ 168 this wk. we beg.</p>
        </div>
      </section>

      <section class="panel" data-od-id="bars">
        <div class="panel-head">
          <h3>mutuals — <em>last 30 days</em></h3>
          <div class="meta">↑ TRENDING UP · +3 CLOSE MUTUALS THIS MONTH · TWO VIA THE SAME OFFSITE</div>
        </div>
        <svg viewBox="0 0 720 220" preserveAspectRatio="none" aria-hidden="true">
          <g fill="#1f1c14">
            <rect x="6"   y="170" width="14" height="50"></rect>
            <rect x="30"  y="158" width="14" height="62"></rect>
            <rect x="54"  y="146" width="14" height="74"></rect>
            <rect x="78"  y="172" width="14" height="48"></rect>
            <rect x="102" y="162" width="14" height="58"></rect>
            <rect x="126" y="138" width="14" height="82"></rect>
            <rect x="150" y="120" width="14" height="100"></rect>
            <rect x="174" y="148" width="14" height="72"></rect>
            <rect x="198" y="132" width="14" height="88"></rect>
            <rect x="222" y="108" width="14" height="112"></rect>
            <rect x="246" y="118" width="14" height="102"></rect>
            <rect x="270" y="154" width="14" height="66"></rect>
            <rect x="294" y="130" width="14" height="90"></rect>
            <rect x="318" y="100" width="14" height="120"></rect>
            <rect x="342" y="86"  width="14" height="134"></rect>
            <rect x="366" y="116" width="14" height="104"></rect>
            <rect x="390" y="138" width="14" height="82"></rect>
            <rect x="414" y="92"  width="14" height="128"></rect>
            <rect x="438" y="74"  width="14" height="146"></rect>
            <rect x="462" y="106" width="14" height="114"></rect>
            <rect x="486" y="84"  width="14" height="136"></rect>
            <rect x="510" y="124" width="14" height="96"></rect>
            <rect x="534" y="98"  width="14" height="122"></rect>
            <rect x="558" y="68"  width="14" height="152"></rect>
            <rect x="582" y="80"  width="14" height="140"></rect>
            <rect x="606" y="46"  width="14" height="174" fill="#c14a2b"></rect>
            <rect x="630" y="60"  width="14" height="160" fill="#c14a2b"></rect>
            <rect x="654" y="92"  width="14" height="128"></rect>
            <rect x="678" y="76"  width="14" height="144"></rect>
            <rect x="702" y="90"  width="14" height="130"></rect>
          </g>
        </svg>
        <div class="axis"><span>MAR 18</span><span>MAR 25</span><span>APR 1</span><span>APR 8</span><span>APR 15</span><span>TODAY</span></div>
      </section>

      <section class="panel lower-panel" data-od-id="trend">
        <div class="panel-head">
          <h3>match rate — <em>last 12 weeks</em></h3>
          <div class="meta">STEADY CLIMB FROM 8% → 14%. ATTRIBUTABLE TO ONE COMMUNITY JOIN (FOUNDERS WHO POST, WK 4).</div>
        </div>
        <p class="lede">A real climb, not a vibe. <b>One community join</b> moved your match rate more than four months of profile edits — keep posting from that circle, ship more, tweet less.</p>
      </section>
    </main>
  </div>
</body>
</html>

\`\`\``},{name:`digital-eguide`,description:`A two-spread digital e-guide preview — page 1 is a cover (display title, author, "What's inside" stats, table of contents teaser); page 2 is a spread (lesson body with pull-quote and a step list). Lifestyle / creator brand tone. Use when the brief asks for an "e-guide", "digital guide", "lookbook", "lead magnet", "creator guide", "playbook", "PDF guide", or "电子指南".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/digital-eguide`,body:`# Digital E-Guide Skill

Produce a two-page digital guide preview side-by-side. Cover on the left,
inside spread on the right. Lifestyle creator tone, lots of negative space,
serif display headings, careful column rhythm.

## Workflow

1. **Read the active DESIGN.md** (injected above). Pick a serif display
   token for the title (italic ligatures encouraged), a body serif for
   long-form, and a mono token for stats / labels.
2. **Pick the topic + author** from the brief. Generate a real title (e.g.
   "The Creator's Style & Format Guide"), a real subtitle, and a one-line
   author byline.
3. **Layout** — center two pages on a tinted backdrop:
   - **Page 1 — cover**:
     - Eyebrow ("STYLE & FORMAT GUIDE FOR CREATORS").
     - Display title with mixed weights and one italic flourish word
       ("The Creator's Style & Format guide" — \`&\` and \`guide\` italic).
     - 3-cell stat row ("16 PRINCIPLES OF STYLE", "38 DOS & DON'TS",
       "1 BLOCK, ZERO TEMPLATES") in mono, separated by \`·\`.
     - "What's inside" header with a 2-column TOC (chapters + page numbers
       in mono, leader dots).
     - Footer: "FIND YOUR VOICE" + page 01 mono.
     - Subtle decorative dot or sticker (CSS) in a corner.
   - **Page 2 — spread**:
     - Eyebrow with chapter number + name ("CHAPTER 02 · TONE").
     - Display sub-title ("Write like you talk — only sharper.").
     - 2-column body: opening paragraph + a numbered 4-step list ("01 Pick
       the rule", "02 Drop the filler"…).
     - Pull-quote pinned right-side: large italic display, accent color, with
       attribution.
     - Bottom strip with "EXERCISE" callout (mono label + 1 sentence prompt
       in italic).
     - Footer: chapter title + page 18 mono.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Pages are 600×860 paper-tone cards with 6px shadow, slight rotation
     opposing each other (±0.6deg) for a magazine-on-desk feel.
   - \`data-od-id\` on cover, spread, toc, pull-quote, exercise.
5. **Self-check**:
   - Type hierarchy is editorial — title owns page 1, sub-title owns page 2.
   - Italic accent appears once per page.
   - Mono used only for labels, stats, and TOC numbers.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="eguide-slug" type="text/html" title="E-Guide — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Creator's Style &amp; Format Guide — Auny</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,700;1,500;1,700&family=DM+Serif+Text:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --backdrop: #d8c8c0;
      --paper: #faf3ea;
      --paper-2: #f4ecdf;
      --ink: #1f1c14;
      --muted: #837964;
      --rule: #d3c9b3;
      --accent: #c44a47;
      --accent-2: #e07d52;
      --serif: 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif;
      --serif-body: 'DM Serif Text', Georgia, serif;
      --sans: -apple-system, system-ui, 'Inter', sans-serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background:
        radial-gradient(ellipse 80% 60% at 50% 20%, #e8d4cc, transparent 70%),
        radial-gradient(ellipse 60% 60% at 80% 90%, #c79a8e, transparent 70%),
        var(--backdrop);
      font: 14px/1.55 var(--serif-body);
      padding: 60px 40px;
      display: flex; gap: 36px; justify-content: center; align-items: flex-start;
      flex-wrap: wrap;
    }

    .page {
      width: 540px; min-height: 740px;
      background: var(--paper);
      border-radius: 4px;
      padding: 44px 44px 36px;
      box-shadow: 0 30px 60px rgba(31,28,20,0.18), 0 4px 8px rgba(31,28,20,0.06);
      position: relative;
    }
    .page.left { transform: rotate(-0.6deg); }
    .page.right { transform: rotate(0.6deg); background: var(--paper-2); }

    .eyebrow {
      font: 10.5px/1 var(--mono);
      letter-spacing: 0.22em;
      color: var(--muted);
      text-transform: uppercase;
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--rule);
    }
    .eyebrow .left, .eyebrow .right { display: flex; align-items: center; gap: 10px; }
    .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

    /* Cover */
    .cover h1.title {
      font-family: var(--serif);
      font-weight: 700;
      font-size: clamp(60px, 7.5vw, 92px);
      line-height: 0.96;
      letter-spacing: -0.01em;
      margin: 32px 0 8px;
      color: var(--ink);
    }
    .cover h1.title .creator { color: var(--accent); font-style: italic; }
    .cover h1.title .amp { color: var(--accent-2); font-style: italic; font-weight: 500; padding: 0 6px; }
    .cover h1.title .guide { font-style: italic; font-weight: 500; }
    .cover h1.title .format { font-style: italic; font-weight: 500; padding-right: 4px; }

    .cover .author { font: 12px/1 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; margin: 16px 0 18px; display: flex; align-items: center; gap: 10px; }
    .cover .author b { color: var(--ink); font-weight: 500; }

    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 18px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin: 22px 0 28px; }
    .stat .num { font: 700 36px/1 var(--serif); letter-spacing: -0.005em; }
    .stat .lbl { font: 10px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.16em; text-transform: uppercase; margin-top: 6px; max-width: 16ch; }

    .cover h2.inside { font: italic 700 36px/1 var(--serif); margin: 14px 0 14px; letter-spacing: -0.005em; }
    .cover h2.inside em { font-style: italic; color: var(--accent); }

    .toc { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 36px; }
    .toc .item { display: flex; align-items: baseline; gap: 6px; font: 14.5px/1.4 var(--serif-body); }
    .toc .item .name { font-style: italic; color: var(--ink); }
    .toc .item .leader { flex: 1; border-bottom: 1px dotted var(--muted); transform: translateY(-2px); margin: 0 4px; }
    .toc .item .pn { font: 11px/1 var(--mono); color: var(--muted); letter-spacing: 0.06em; }

    .cover-footer { position: absolute; left: 44px; right: 44px; bottom: 28px; display: flex; justify-content: space-between; align-items: center; font: 10.5px/1 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; padding-top: 14px; border-top: 1px solid var(--rule); }
    .sticker { position: absolute; top: 280px; right: 44px; width: 92px; height: 92px; border-radius: 50%; background: var(--accent-2); transform: rotate(8deg); display: grid; place-items: center; color: #fff; font: italic 700 14px/1.1 var(--serif); text-align: center; padding: 10px; }
    .sticker::after { content: ''; position: absolute; inset: 6px; border: 1px dashed rgba(255,255,255,0.5); border-radius: 50%; }

    /* Spread */
    .spread h2.head { font: italic 700 44px/1 var(--serif); letter-spacing: -0.005em; margin: 32px 0 6px; max-width: 18ch; }
    .spread h2.head .accent { color: var(--accent); }
    .spread .deck { font: italic 16px/1.5 var(--serif-body); color: var(--muted); margin: 0 0 22px; max-width: 50ch; }

    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding-top: 14px; border-top: 1px solid var(--rule); }
    .columns p { margin: 0 0 14px; font: 14.5px/1.6 var(--serif-body); color: var(--ink); }
    .columns p:first-letter { font-family: var(--serif); font-size: 38px; line-height: 0.85; padding: 4px 6px 0 0; float: left; font-weight: 700; color: var(--accent); font-style: italic; }
    .steps { display: flex; flex-direction: column; gap: 10px; }
    .steps .row { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px dashed var(--rule); }
    .steps .row .n { font: 700 12px/1 var(--mono); color: var(--accent); letter-spacing: 0.08em; }
    .steps .row .body { font: 14px/1.45 var(--serif-body); }
    .steps .row .body b { color: var(--ink); font-weight: 700; font-style: italic; }

    .pullquote {
      position: absolute; right: -16px; top: 280px;
      width: 250px;
      padding: 18px 22px;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 4px;
      box-shadow: 0 8px 18px rgba(31,28,20,0.10);
      font: italic 700 22px/1.2 var(--serif);
      color: var(--ink);
      transform: rotate(2.4deg);
    }
    .pullquote .open { font-size: 56px; line-height: 0.4; color: var(--accent); display: block; height: 24px; }
    .pullquote .by { font: 11px/1 var(--mono); color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 400; font-style: normal; margin-top: 14px; display: block; }

    .exercise { margin-top: 18px; padding: 14px 16px; border: 1px solid var(--accent); border-radius: 4px; background: rgba(196,74,71,0.05); display: flex; gap: 14px; align-items: center; }
    .exercise .label { font: 10.5px/1 var(--mono); color: var(--accent); letter-spacing: 0.2em; text-transform: uppercase; padding: 6px 8px; border: 1px solid var(--accent); }
    .exercise .text { font: italic 14px/1.4 var(--serif-body); color: var(--ink); }

    .spread-footer { position: absolute; left: 44px; right: 44px; bottom: 28px; display: flex; justify-content: space-between; align-items: center; font: 10.5px/1 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; padding-top: 14px; border-top: 1px solid var(--rule); }

    @media (max-width: 1180px) {
      .pullquote { right: 16px; }
      .page { width: 92vw; max-width: 540px; }
    }
  </style>
</head>
<body>
  <article class="page left cover" data-od-id="cover">
    <div class="eyebrow">
      <div class="left"><span class="dot"></span>STYLE &amp; FORMAT GUIDE FOR CREATORS</div>
      <div class="right">2026 EDITION</div>
    </div>

    <h1 class="title">The <span class="creator">Creator's</span> Style <span class="amp">&amp;</span> <span class="format">Format</span> <span class="guide">guide</span></h1>

    <div class="author">— BY <b>AUNY</b> · CREATOR EDUCATOR · 18 / 04 / 2026</div>

    <div class="stats">
      <div class="stat"><div class="num">16</div><div class="lbl">Principles of style</div></div>
      <div class="stat"><div class="num">38</div><div class="lbl">Do's &amp; Don'ts</div></div>
      <div class="stat"><div class="num">1</div><div class="lbl">Block, zero templates</div></div>
    </div>

    <h2 class="inside">What's <em>inside.</em></h2>

    <div class="toc" data-od-id="toc">
      <div class="item"><span class="name">Find your voice</span><span class="leader"></span><span class="pn">04</span></div>
      <div class="item"><span class="name">Pick a format</span><span class="leader"></span><span class="pn">12</span></div>
      <div class="item"><span class="name">Tone &amp; tension</span><span class="leader"></span><span class="pn">18</span></div>
      <div class="item"><span class="name">Visual rhythm</span><span class="leader"></span><span class="pn">24</span></div>
      <div class="item"><span class="name">Headlines that hold</span><span class="leader"></span><span class="pn">32</span></div>
      <div class="item"><span class="name">Editing the cut</span><span class="leader"></span><span class="pn">40</span></div>
    </div>

    <div class="sticker">FOR THE FIRST DRAFT</div>
    <div class="cover-footer"><span>FIND YOUR VOICE</span><span>01 / 64</span></div>
  </article>

  <article class="page right spread" data-od-id="spread">
    <div class="eyebrow">
      <div class="left"><span class="dot"></span>CHAPTER 02 · TONE</div>
      <div class="right">3 — RULES, 1 — EXERCISE</div>
    </div>

    <h2 class="head">Write like you talk —<br/><span class="accent">only sharper.</span></h2>
    <p class="deck">Your voice already exists. The work is to remove the parts that aren't you, then put what's left in the order people remember. Three small rules and one Sunday-morning exercise.</p>

    <div class="columns">
      <p>Strong writing has the cadence of speech and the precision of editing. Most beginners pick one and stop. Read your draft aloud. The sentences that catch in your throat are the ones to cut.</p>
      <div class="steps">
        <div class="row"><span class="n">01</span><span class="body"><b>Pick the rule.</b> One idea per paragraph. If two appear, split the paragraph.</span></div>
        <div class="row"><span class="n">02</span><span class="body"><b>Drop the filler.</b> "I think", "kind of", "in my opinion" — they soften, then they erase.</span></div>
        <div class="row"><span class="n">03</span><span class="body"><b>End with a verb.</b> The last beat lands harder when it asks for an action, not an adjective.</span></div>
        <div class="row"><span class="n">04</span><span class="body"><b>Read aloud once.</b> Always. The microphone is the editor.</span></div>
      </div>
    </div>

    <div class="pullquote" data-od-id="pullquote">
      <span class="open">"</span>
      Specificity is the unlock — write what only you saw.
      <span class="by">— AUNY · CHAPTER 02</span>
    </div>

    <div class="exercise" data-od-id="exercise">
      <span class="label">EXERCISE</span>
      <span class="text">Rewrite your last three captions without the words <em>just</em>, <em>really</em>, or <em>very</em>. Keep what survives.</span>
    </div>

    <div class="spread-footer"><span>TONE &amp; TENSION</span><span>18 / 64</span></div>
  </article>
</body>
</html>

\`\`\``},{name:`docs-page`,description:`A documentation page — left nav, scrollable article body, right-rail table of contents. Use when the brief mentions "docs", "documentation", "guide", "API reference", or "tutorial".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/docs-page`,body:`# Docs Page Skill

Produce a single, three-column documentation page in one HTML file.

## Workflow

1. **Read the active DESIGN.md** (injected above). Use the body type token for
   prose; the mono token for code; respect line-height and max-width rules.
2. **Pick a topic** from the brief — the page should look like real docs, not
   a generic wireframe. Concrete API names, command examples, plausible
   parameters.
3. **Lay out** three regions:
   - **Left nav** (240–280px, sticky): grouped link list, current page bolded
     with a left-edge accent stripe. 3–5 groups of 4–8 links.
   - **Article body** (max-width ~720px, centered in the middle column):
     H1, lede paragraph, H2 sections, code blocks, callout boxes (note /
     warning), inline links, lists.
   - **Right TOC** (200–240px, sticky): "On this page" with the H2/H3
     anchors, current section highlighted as the user scrolls.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, all CSS inline.
   - CSS Grid for the three columns; sticky positioning for the rails.
   - Code blocks: monospace token, soft surface fill, copy-button affordance
     (visual only — no JS needed).
   - Anchor IDs on every H2/H3 so the TOC links work.
   - \`data-od-id\` on the nav, article, and TOC.
5. **Prose**: write at least 350 words of believable docs. Include at least
   one shell command, one code snippet (5–15 lines), one callout, one table.
6. **Self-check**:
   - Body text wraps at the DS line-length sweet spot (60–75 chars).
   - Code uses the DS mono token, not generic \`monospace\`.
   - Accent is restrained — used for active nav item, links, one callout
     border. Not on body text.
   - Page is readable at 1280w and collapses gracefully below 900w (TOC drops
     out, nav becomes a top drawer).

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="docs-slug" type="text/html" title="Docs — Page Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Filebase docs — Quickstart</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1b1a; --muted: #6b6964; --border: #e6e4e0;
      --accent: #c96442; --surface: #ffffff; --code-bg: #f4f4f2;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.6 -apple-system, system-ui, sans-serif; }
    .topbar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 28px; display: flex; justify-content: space-between; align-items: center; }
    .topbar .brand { font-weight: 600; }
    .topbar input { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); width: 280px; font: inherit; background: var(--bg); }
    .layout { display: grid; grid-template-columns: 240px minmax(0, 1fr) 220px; gap: 0; min-height: calc(100vh - 50px); }
    @media (max-width: 1024px) { .layout { grid-template-columns: 220px 1fr; } .toc { display: none; } }
    @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } .sidebar { display: none; } }
    .sidebar { padding: 24px 16px; border-right: 1px solid var(--border); overflow-y: auto; font-size: 14px; }
    .sidebar .group { margin-bottom: 22px; }
    .sidebar .group-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; padding: 0 8px 8px; }
    .sidebar a { display: block; color: var(--fg); text-decoration: none; padding: 5px 8px; border-radius: 6px; }
    .sidebar a:hover { background: var(--surface); }
    .sidebar a.active { background: var(--accent); color: white; }
    article { padding: 40px 56px 80px; max-width: 760px; }
    .crumbs { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    h1 { font-size: 36px; letter-spacing: -0.02em; margin: 0 0 12px; }
    .lede { color: var(--muted); font-size: 17px; margin: 0 0 32px; }
    h2 { font-size: 22px; letter-spacing: -0.01em; margin: 40px 0 12px; }
    h3 { font-size: 16px; margin: 24px 0 8px; }
    p { margin: 12px 0; }
    code { font-family: ui-monospace, monospace; background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
    pre { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-size: 13px; line-height: 1.55; }
    pre code { background: transparent; padding: 0; }
    .callout { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .callout .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent); margin-bottom: 4px; }
    .toc { padding: 40px 24px 24px; font-size: 13px; border-left: 1px solid var(--border); }
    .toc .toc-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 10px; }
    .toc a { display: block; color: var(--muted); text-decoration: none; padding: 4px 0; }
    .toc a.active { color: var(--accent); font-weight: 500; }
    .pager { display: flex; justify-content: space-between; gap: 12px; margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--border); }
    .pager a { flex: 1; text-decoration: none; color: var(--fg); padding: 12px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
    .pager a small { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
  </style>
</head>
<body>
  <header class="topbar" data-od-id="topbar">
    <span class="brand">◰ Filebase docs</span>
    <input placeholder="Search · ⌘K" />
  </header>
  <div class="layout">
    <nav class="sidebar" data-od-id="sidebar">
      <div class="group">
        <div class="group-label">Getting started</div>
        <a href="#" class="active">Quickstart</a>
        <a href="#">Concepts</a>
        <a href="#">Authentication</a>
      </div>
      <div class="group">
        <div class="group-label">Sync engine</div>
        <a href="#">Block-level deltas</a>
        <a href="#">Conflict resolution</a>
        <a href="#">Resumable uploads</a>
      </div>
      <div class="group">
        <div class="group-label">CLI</div>
        <a href="#">Install</a>
        <a href="#">Configuration</a>
        <a href="#">Subcommands</a>
      </div>
    </nav>
    <article data-od-id="article">
      <div class="crumbs">Docs › Getting started › Quickstart</div>
      <h1>Quickstart</h1>
      <p class="lede">Sync your first folder in under five minutes. The CLI is the fastest path; the desktop app and the API client all wrap the same engine.</p>
      <h2 id="install">1. Install the CLI</h2>
      <p>The CLI is distributed as a single binary for macOS, Linux, and Windows.</p>
<pre><code># macOS · Homebrew
brew install filebase

# Linux · curl
curl -fsSL https://get.filebase.dev | sh</code></pre>
      <p>Verify the install:</p>
<pre><code>filebase --version
# filebase 0.6.4</code></pre>
      <h2 id="auth">2. Authenticate</h2>
      <p>Sign in with your Filebase account. The token is stored in <code>~/.config/filebase/credentials</code>.</p>
<pre><code>filebase auth login
# → opens your browser
# ✓ Logged in as you@example.com</code></pre>
      <div class="callout">
        <div class="label">Note</div>
        On servers without a browser, use <code>filebase auth login --device</code> for a device-code flow.
      </div>
      <h2 id="sync">3. Sync a folder</h2>
      <p>Pick a local directory and link it to a remote root. Filebase watches it for changes and pushes block-level diffs in the background.</p>
<pre><code>cd ~/projects
filebase init my-team
filebase sync</code></pre>
      <h3>Excluding files</h3>
      <p>Add a <code>.filebaseignore</code> at the root of the synced folder. Same syntax as <code>.gitignore</code>:</p>
<pre><code>node_modules/
*.log
build/</code></pre>
      <h2 id="next">4. Where to go next</h2>
      <p>Read <a href="#">Conflict resolution</a> to understand how Filebase merges concurrent edits, or skip to the <a href="#">CLI reference</a> for the full subcommand list.</p>
      <div class="pager">
        <a href="#"><small>← Previous</small>Concepts</a>
        <a href="#" style="text-align: right;"><small>Next →</small>Conflict resolution</a>
      </div>
    </article>
    <aside class="toc" data-od-id="toc">
      <div class="toc-label">On this page</div>
      <a href="#install" class="active">1. Install the CLI</a>
      <a href="#auth">2. Authenticate</a>
      <a href="#sync">3. Sync a folder</a>
      <a href="#next">4. Where to go next</a>
    </aside>
  </div>
</body>
</html>

\`\`\``},{name:`email-marketing`,description:`A brand product-launch email — masthead with wordmark, hero image block, headline lockup with skewed-italic accent, body copy, primary CTA, and a specifications grid. Pure HTML email layout (centered single column, table fallback). Use when the brief asks for an "email", "newsletter blast", "MJML", "product launch email", or "email template".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/email-marketing`,body:`# Email Marketing Skill

Produce a single HTML email — centered, single column, no chrome around the
email body. Treat it like a marketing artifact: one big idea, one CTA.

## Workflow

1. **Read the active DESIGN.md** (injected above). Email leans on the display
   font more than any other surface — pick the loudest type token in the DS
   for the headline lockup.
2. **Pick the brand + product** from the brief. Generate a real wordmark, a
   real product name, and one real benefit sentence — no placeholders.
3. **Layout**, in order, all centered inside a 600–680px column on a tinted
   page background (so the email body looks like an email, not the page):
   - **Masthead** — wordmark on the left + 3 short nav links (SHOP, JOURNAL,
     MEMBERS) on the right. Thin underline.
   - **Hero block** — a 16:9 product image placeholder. Use a DS-tinted
     gradient or a stylized SVG silhouette of the product (shoe, bottle,
     headphones, whatever the brief implies). Add a tiny brand stamp on the
     top-left and a colorway tag on the bottom-left.
   - **Eyebrow** — small caps, accent color, separated by \`·\` characters
     (e.g. "NEW · MAX-CUSHION TRAINER · EMBER FLARE").
   - **Headline lockup** — 2–3 line headline using the display font, all caps,
     extra-tight tracking. Apply a slight skew (\`transform: skew(-6deg)\`) on
     one accent word to give it a sporty parallelogram feel.
   - **Body** — 2–3 sentence paragraph, left-aligned, body font.
   - **Primary CTA** — solid pill or block button. One only.
   - **Specs grid** — 2×2 grid of (big number + unit + label) callouts using
     the display font for the numbers.
   - **Footer** — wordmark, address line, unsubscribe + view-in-browser links.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Center the column with \`margin: 0 auto\`. Set \`body { background: <tint> }\`
     so the email-on-page metaphor reads.
   - No external images — use inline SVG or DS-tinted gradient blocks for the
     product photo.
   - \`data-od-id\` on the masthead, hero, headline, CTA, specs.
5. **Self-check**:
   - Email reads top to bottom in 8–10 seconds.
   - One CTA. Accent appears at most twice (eyebrow + CTA, or headline word).
   - Looks legible on a 480px window (column reflows, type drops one step).

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="email-slug" type="text/html" title="Email — Subject Line">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SPORT TEST — Meet the Axis Pro</title>
  <style>
    :root {
      --page: #d9d6d0;
      --paper: #f4efe7;
      --ink: #1a1816;
      --muted: #6b6964;
      --border: #d8d3c8;
      --accent: #d8482b;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.55 'Inter', -apple-system, system-ui, sans-serif; }
    .frame { max-width: 680px; margin: 0 auto; background: var(--paper); padding: 0; }
    .masthead { display: flex; justify-content: space-between; align-items: center; padding: 22px 32px; border-bottom: 1px solid var(--border); }
    .wordmark { display: flex; align-items: center; gap: 10px; font-family: 'Anton', 'Bebas Neue', Impact, sans-serif; font-size: 22px; letter-spacing: 0.04em; }
    .wordmark .lockup { display: flex; align-items: center; gap: 8px; }
    .wordmark .mark { width: 22px; height: 22px; background: var(--accent); transform: skew(-12deg); display: inline-block; }
    .wordmark .est { font: 11px/1 ui-monospace, monospace; color: var(--muted); padding: 4px 6px; border: 1px solid var(--border); border-radius: 3px; letter-spacing: 0.08em; }
    .nav { display: flex; gap: 28px; font-size: 12px; letter-spacing: 0.18em; color: var(--ink); }
    .nav a { color: inherit; text-decoration: none; }

    .hero { position: relative; aspect-ratio: 4 / 3; background:
      radial-gradient(circle at 30% 20%, #ffd6b8 0%, transparent 55%),
      radial-gradient(circle at 75% 70%, #f59a6c 0%, transparent 60%),
      linear-gradient(135deg, #c9c4b8 0%, #aaa39a 100%); overflow: hidden; }
    .hero .stamp-tl { position: absolute; top: 18px; left: 22px; font: 11px/1 ui-monospace, monospace; color: rgba(26,24,22,0.78); letter-spacing: 0.18em; }
    .hero .stamp-bl { position: absolute; bottom: 18px; left: 22px; font: 11px/1 ui-monospace, monospace; color: rgba(26,24,22,0.78); letter-spacing: 0.18em; }
    .hero .stamp-br { position: absolute; bottom: 18px; right: 22px; font: 11px/1 ui-monospace, monospace; color: rgba(26,24,22,0.6); letter-spacing: 0.18em; }
    .hero svg.shoe { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 78%; height: auto; filter: drop-shadow(0 18px 26px rgba(26,24,22,0.18)); }

    .article { padding: 44px 44px 12px; }
    .eyebrow { font: 11px/1 ui-monospace, monospace; color: var(--accent); letter-spacing: 0.22em; margin-bottom: 28px; display: flex; gap: 12px; align-items: center; }
    .eyebrow span.bar { display: inline-block; width: 22px; height: 2px; background: var(--accent); }
    h1.lockup { font-family: 'Anton', 'Bebas Neue', Impact, sans-serif; font-weight: 400; font-size: clamp(56px, 9vw, 96px); line-height: 0.95; letter-spacing: -0.005em; margin: 0 0 28px; text-transform: uppercase; }
    h1.lockup .axis { color: var(--accent); display: inline-block; transform: skew(-8deg); }
    p.body { font-size: 16px; line-height: 1.55; color: var(--ink); margin: 0 0 30px; max-width: 56ch; }
    p.body em { font-style: italic; color: var(--accent); }

    .cta { display: inline-flex; align-items: center; gap: 14px; background: var(--ink); color: var(--paper); padding: 14px 22px; font: 12px/1 'Inter', sans-serif; letter-spacing: 0.2em; text-transform: uppercase; text-decoration: none; }
    .cta .arrow { display: inline-block; width: 22px; height: 1px; background: var(--paper); position: relative; }
    .cta .arrow::after { content: ''; position: absolute; right: 0; top: -3px; border: 4px solid transparent; border-left-color: var(--paper); }

    .specs { padding: 56px 44px 12px; border-top: 1px solid var(--border); margin-top: 44px; }
    .specs .head { font: 11px/1 ui-monospace, monospace; color: var(--accent); letter-spacing: 0.22em; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }
    .specs .head span.bar { display: inline-block; width: 22px; height: 2px; background: var(--accent); }
    .specs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px 48px; }
    .spec .num { font-family: 'Anton', 'Bebas Neue', Impact, sans-serif; font-size: 56px; line-height: 0.9; letter-spacing: -0.005em; }
    .spec .num sup { font-size: 18px; vertical-align: top; margin-left: 4px; color: var(--muted); font-family: ui-monospace, monospace; letter-spacing: 0.04em; }
    .spec .label { font: 11px/1.45 ui-monospace, monospace; color: var(--muted); letter-spacing: 0.16em; text-transform: uppercase; margin-top: 8px; max-width: 22ch; }

    .footer { padding: 56px 44px 40px; margin-top: 32px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
    .footer .left { display: flex; flex-direction: column; gap: 12px; font-size: 12px; color: var(--muted); }
    .footer .marks { display: flex; align-items: center; gap: 10px; }
    .footer .right { font: 11px/1.6 ui-monospace, monospace; color: var(--muted); letter-spacing: 0.06em; text-align: right; }
    .footer a { color: var(--muted); }

    @media (max-width: 540px) {
      .article, .specs, .footer { padding-left: 24px; padding-right: 24px; }
      h1.lockup { font-size: 48px; }
      .nav { display: none; }
      .specs-grid { grid-template-columns: 1fr 1fr; gap: 24px; }
    }
  </style>
</head>
<body>
  <div class="frame" data-od-id="email">
    <header class="masthead" data-od-id="masthead">
      <div class="wordmark">
        <span class="mark"></span>
        <span class="lockup">SPORT TEST</span>
        <span class="est">EST · 2024</span>
      </div>
      <nav class="nav"><a href="#">SHOP</a><a href="#">JOURNAL</a><a href="#">MEMBERS</a></nav>
    </header>

    <div class="hero" data-od-id="hero">
      <div class="stamp-tl">— SPORT TEST</div>
      <svg class="shoe" viewBox="0 0 600 280" aria-hidden="true">
        <defs>
          <linearGradient id="upper" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffe0c4"/>
            <stop offset="55%" stop-color="#f78c4c"/>
            <stop offset="100%" stop-color="#c8442d"/>
          </linearGradient>
          <linearGradient id="midsole" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fff8ee"/>
            <stop offset="100%" stop-color="#e7dccd"/>
          </linearGradient>
        </defs>
        <path d="M 60 180 C 80 130, 160 90, 230 92 C 290 94, 330 110, 380 115 C 430 120, 470 125, 500 145 C 530 165, 540 195, 520 210 L 100 210 C 80 210, 55 200, 60 180 Z" fill="url(#upper)" stroke="#7c2615" stroke-width="2"/>
        <path d="M 60 180 L 100 210 L 520 210 L 540 200 C 550 190, 545 175, 530 175 L 90 175 C 75 175, 60 175, 60 180 Z" fill="url(#midsole)" stroke="#7c2615" stroke-width="2"/>
        <path d="M 100 210 L 100 230 L 540 230 L 540 220" fill="none" stroke="#7c2615" stroke-width="3" stroke-linecap="round"/>
        <g stroke="#7c2615" stroke-width="2" fill="none" opacity="0.85">
          <path d="M 200 110 C 220 130, 230 145, 240 165"/>
          <path d="M 250 105 C 270 125, 280 140, 290 160"/>
          <path d="M 300 105 C 320 125, 330 140, 340 160"/>
          <path d="M 350 110 C 370 130, 380 145, 390 165"/>
        </g>
        <g fill="#7c2615">
          <circle cx="220" cy="160" r="3"/>
          <circle cx="270" cy="158" r="3"/>
          <circle cx="320" cy="158" r="3"/>
          <circle cx="370" cy="160" r="3"/>
        </g>
        <path d="M 405 145 Q 470 130, 500 150 Q 470 165, 410 162 Z" fill="#fffbf5" stroke="#7c2615" stroke-width="2"/>
      </svg>
      <div class="stamp-bl">— EMBER FLARE</div>
      <div class="stamp-br">DROP 04 · 04—2026</div>
    </div>

    <section class="article" data-od-id="article">
      <div class="eyebrow"><span class="bar"></span>NEW · MAX-CUSHION TRAINER · EMBER FLARE</div>
      <h1 class="lockup" data-od-id="headline">
        Meet the<br/>
        <span class="axis">Axis Pro.</span><br/>
        A sneaker that runs.
      </h1>
      <p class="body">A plush, gel-cushioned trainer wrapped in a painterly flame-knit upper. Built for long days on the road, café runs, and everything between — softer underfoot, louder on the outside. Limited first drop in <em>Ember Flare</em>.</p>
      <a class="cta" href="#" data-od-id="cta">Shop the Axis Pro <span class="arrow"></span></a>
    </section>

    <section class="specs" data-od-id="specs">
      <div class="head"><span class="bar"></span>SPECIFICATIONS · WOMEN'S</div>
      <div class="specs-grid">
        <div class="spec">
          <div class="num">7.4<sup>OZ</sup></div>
          <div class="label">Weight (women's US 8)</div>
        </div>
        <div class="spec">
          <div class="num">34<sup>MM</sup></div>
          <div class="label">Max-cushion stack at the heel</div>
        </div>
        <div class="spec">
          <div class="num">8<sup>MM</sup></div>
          <div class="label">Heel-to-toe drop for low-impact landing</div>
        </div>
        <div class="spec">
          <div class="num" style="font-size:42px;">Gel-02</div>
          <div class="label">Heel &amp; forefoot gel shock pods</div>
        </div>
      </div>
    </section>

    <footer class="footer" data-od-id="footer">
      <div class="left">
        <div class="marks"><span style="display:inline-block;width:18px;height:18px;background:var(--accent);transform:skew(-12deg);"></span><span class="lockup" style="font-family:'Anton',sans-serif;font-size:18px;letter-spacing:0.04em;">SPORT TEST</span></div>
        <div>118 Stillman St · Brooklyn NY 11211</div>
        <div><a href="#">Unsubscribe</a> · <a href="#">View in browser</a></div>
      </div>
      <div class="right">© 2026 SPORT TEST<br/>ALL RIGHTS RESERVED</div>
    </footer>
  </div>
</body>
</html>

\`\`\``},{name:`eng-runbook`,description:`An engineering runbook — service overview, alerts table, dashboards links, common procedures with copy-pasteable commands, on-call rotation, and an incident-response checklist. Use when the brief mentions "runbook", "ops doc", "on-call guide", "SRE doc", or "运维手册".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/eng-runbook`,body:`# Engineering Runbook Skill

Produce a single-page engineering runbook.

## Workflow

1. Read DESIGN.md.
2. Identify the service from the brief.
3. Layout:
   - Header: service name, owner team, severity tier, version.
   - Service summary paragraph + dependency list.
   - Alerts table: alert name / severity / what it means / first response.
   - Dashboards & links list.
   - Common procedures block (3–4) with code blocks (deploy, rollback, rotate keys).
   - On-call rotation table (week / primary / secondary / backup).
   - Incident response checklist (5 numbered steps).
4. One inline \`<style>\`, semantic HTML, monospace for code blocks.

## Output contract

\`\`\`
<artifact identifier="runbook-name" type="text/html" title="Service Runbook">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Auth Service · Runbook</title>
<style>
  :root {
    --bg: #0c0e14;
    --paper: #14171f;
    --paper-2: #1c2030;
    --ink: #eaecf3;
    --muted: #8b94ad;
    --line: #262b3b;
    --accent: #6ee7b7;
    --accent-soft: rgba(110,231,183,0.1);
    --warn: #fbbf24;
    --danger: #f87171;
    --display: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14px; line-height: 1.6; }
  .page { max-width: 1100px; margin: 0 auto; padding: 32px 28px 64px; }

  /* Header */
  .head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 24px; border-bottom: 1px solid var(--line); margin-bottom: 28px; }
  .head-left { display: flex; flex-direction: column; gap: 6px; }
  .crumb { font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  h1 { font-family: var(--display); font-size: 36px; margin: 4px 0; font-weight: 700; letter-spacing: -0.02em; }
  .head-meta { font-family: var(--mono); font-size: 11.5px; color: var(--muted); }
  .head-meta span { color: var(--accent); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
    font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
  }
  .pill.tier { background: var(--accent-soft); color: var(--accent); border: 1px solid rgba(110,231,183,0.3); }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }

  section { margin-top: 40px; }
  h2 { font-family: var(--display); font-size: 22px; margin: 0 0 14px; letter-spacing: -0.005em; font-weight: 700; }
  h2 .index { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-right: 12px; vertical-align: middle; }

  /* Summary */
  .summary { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
  .panel { padding: 22px 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
  .panel p { margin: 0 0 12px; }
  .panel p:last-child { margin: 0; }
  .deps h3 { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; font-weight: 500; }
  .deps ul { padding: 0; margin: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-family: var(--mono); font-size: 12.5px; }
  .deps li { display: flex; justify-content: space-between; padding: 8px 12px; background: var(--paper-2); border-radius: 6px; }
  .deps li .ok { color: var(--accent); }
  .deps li .warn { color: var(--warn); }

  /* Tables */
  table { width: 100%; border-collapse: collapse; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: top; }
  th { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); background: var(--paper-2); }
  tr:last-child td { border-bottom: none; }
  td.code, .panel code { font-family: var(--mono); }
  .sev { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 4px; font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .sev-1 { background: rgba(248,113,113,0.15); color: var(--danger); }
  .sev-2 { background: rgba(251,191,36,0.15); color: var(--warn); }
  .sev-3 { background: rgba(110,231,183,0.15); color: var(--accent); }

  /* Procedure cards */
  .procs { display: flex; flex-direction: column; gap: 14px; }
  .proc { padding: 18px 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
  .proc-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .proc-head h3 { margin: 0; font-family: var(--display); font-size: 17px; }
  .proc-head .when { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  pre { background: var(--paper-2); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-family: var(--mono); font-size: 12.5px; line-height: 1.6; color: #cdd6f4; margin: 8px 0 0; }
  pre .cmt { color: var(--muted); }
  pre .var { color: var(--warn); }
  pre .ok { color: var(--accent); }

  /* On-call */
  .rota { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }

  /* Checklist */
  .checklist { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .step { padding: 18px 20px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; display: flex; gap: 16px; align-items: flex-start; }
  .step-num { flex: 0 0 36px; width: 36px; height: 36px; border-radius: 50%; background: var(--accent); color: var(--bg); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-family: var(--display); font-size: 16px; }
  .step h4 { margin: 0 0 6px; font-family: var(--display); font-size: 15px; }
  .step p { margin: 0; color: var(--muted); font-size: 13px; }
  .step code { font-family: var(--mono); background: var(--paper-2); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--accent); }

  footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11.5px; color: var(--muted); }

  @media (max-width: 880px) {
    .summary, .checklist { grid-template-columns: 1fr; }
    h1 { font-size: 26px; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="head">
    <div class="head-left">
      <div class="crumb">Northwind / Identity / Auth</div>
      <h1>auth-service</h1>
      <div class="head-meta">Owned by <span>@identity-platform</span> · v4.7.2 · Last reviewed 14 Oct 2025</div>
    </div>
    <span class="pill tier"><span class="dot"></span>Tier 0 · production-critical</span>
  </header>

  <section>
    <h2><span class="index">01</span>Service summary</h2>
    <div class="summary">
      <div class="panel">
        <p><strong>auth-service</strong> issues, validates, and revokes session tokens for every Northwind product surface — web, mobile, and the public API. It owns the password store, the TOTP/WebAuthn enrollments, and the audit-log writer for all auth events.</p>
        <p>If <code>auth-service</code> is down, customers cannot log in or refresh sessions. Existing valid sessions continue to work for their TTL (15 minutes) but no new auth happens.</p>
      </div>
      <div class="panel deps">
        <h3>Dependencies</h3>
        <ul>
          <li><span>Postgres · auth-db</span><span class="ok">healthy</span></li>
          <li><span>Redis · session-cache</span><span class="ok">healthy</span></li>
          <li><span>KMS · auth-keyring</span><span class="ok">healthy</span></li>
          <li><span>SES · transactional</span><span class="warn">degraded</span></li>
          <li><span>Pager · oncall.northwind</span><span class="ok">healthy</span></li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <h2><span class="index">02</span>Alerts you might wake up to</h2>
    <table>
      <thead><tr><th>Alert</th><th>Severity</th><th>What it means</th><th>First response</th></tr></thead>
      <tbody>
        <tr>
          <td class="code">auth.login_5xx_rate &gt; 1%</td>
          <td><span class="sev sev-1">SEV-1</span></td>
          <td>Login endpoint returning errors. Customers are locked out.</td>
          <td>Check Postgres + Redis dashboards. Roll back last deploy if &lt; 30 min old.</td>
        </tr>
        <tr>
          <td class="code">auth.token_refresh_lag_p95 &gt; 800ms</td>
          <td><span class="sev sev-2">SEV-2</span></td>
          <td>Refresh path is slow. Web app starts to feel sluggish.</td>
          <td>Inspect Redis CPU + connection count. Scale read replicas if needed.</td>
        </tr>
        <tr>
          <td class="code">auth.signup_failure &gt; 10/min</td>
          <td><span class="sev sev-2">SEV-2</span></td>
          <td>New signups are failing. Often SES bounces or SMTP auth.</td>
          <td>Check SES bounce rate. Failover transactional queue to backup region.</td>
        </tr>
        <tr>
          <td class="code">auth.kms_signing_errors &gt; 0</td>
          <td><span class="sev sev-1">SEV-1</span></td>
          <td>KMS can't sign session tokens. New logins fail; existing sessions OK.</td>
          <td>Page the security team. Do not roll keys without a security engineer.</td>
        </tr>
        <tr>
          <td class="code">auth.audit_writer_backlog &gt; 5k</td>
          <td><span class="sev sev-3">SEV-3</span></td>
          <td>Audit log writer is falling behind. Compliance impact.</td>
          <td>Drain manually. Open a ticket; not a wake-up.</td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2><span class="index">03</span>Common procedures</h2>
    <div class="procs">
      <div class="proc">
        <div class="proc-head"><h3>Deploy a new version</h3><span class="when">Use during business hours</span></div>
        <p>Deploys are blue/green. The script waits for two consecutive healthchecks before promoting traffic.</p>
<pre><span class="cmt"># Deploy auth-service v4.7.3 to production</span>
$ nw deploy auth-service --tag <span class="var">v4.7.3</span> --env production

<span class="cmt"># Wait for two consecutive healthchecks (~90 s), then promote.</span>
$ nw deploy promote auth-service --env production
<span class="ok">→ traffic shifted: 10% / 50% / 100%</span></pre>
      </div>
      <div class="proc">
        <div class="proc-head"><h3>Roll back to last known good</h3><span class="when">Use when error rate &gt; 1% post-deploy</span></div>
<pre><span class="cmt"># Rolls back to the previously promoted version, no rebuild.</span>
$ nw deploy rollback auth-service --env production
<span class="ok">→ rolled back to v4.7.2 in 38 s</span></pre>
      </div>
      <div class="proc">
        <div class="proc-head"><h3>Rotate signing keys</h3><span class="when">Schedule with security; never solo</span></div>
<pre><span class="cmt"># 1. Generate the new signing key in KMS</span>
$ nw kms create-key --alias auth-signing-<span class="var">$(date +%Y%m%d)</span>

<span class="cmt"># 2. Mark the new key as the primary; old key remains valid for 24h</span>
$ nw kms set-primary auth-signing --key <span class="var">&lt;arn&gt;</span>

<span class="cmt"># 3. After 24h, schedule deletion of the previous key</span>
$ nw kms schedule-deletion auth-signing --key <span class="var">&lt;old-arn&gt;</span> --days 30</pre>
      </div>
      <div class="proc">
        <div class="proc-head"><h3>Drain audit-log backlog</h3><span class="when">Use when audit_writer_backlog alert fires</span></div>
<pre>$ nw exec auth-service -- bin/audit-drain --batch <span class="var">5000</span>
<span class="ok">→ drained 4,812 entries in 12 s; backlog now 0</span></pre>
      </div>
    </div>
  </section>

  <section>
    <h2><span class="index">04</span>On-call rotation · this month</h2>
    <table class="rota">
      <thead><tr><th>Week</th><th>Primary</th><th>Secondary</th><th>Backup (escalation)</th></tr></thead>
      <tbody>
        <tr><td>Oct 27 – Nov 02</td><td>Devon Park</td><td>Priya Banerjee</td><td>Sasha Lin</td></tr>
        <tr><td>Nov 03 – Nov 09</td><td>Caleb Renner</td><td>Devon Park</td><td>Sasha Lin</td></tr>
        <tr><td>Nov 10 – Nov 16</td><td>Priya Banerjee</td><td>Caleb Renner</td><td>Mira Reddy</td></tr>
        <tr><td>Nov 17 – Nov 23</td><td>Sasha Lin</td><td>Priya Banerjee</td><td>Mira Reddy</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2><span class="index">05</span>Incident response — first 30 minutes</h2>
    <div class="checklist">
      <div class="step">
        <div class="step-num">1</div>
        <div><h4>Acknowledge the page within 5 min.</h4><p>Type <code>/ack</code> in <code>#incidents-auth</code>. The bot stops re-paging and tags the on-call.</p></div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div><h4>Open the incident channel.</h4><p>Run <code>/incident open auth-service "&lt;short title&gt;"</code>. Slack bot creates a dedicated channel and pages the secondary.</p></div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div><h4>Post a status snapshot.</h4><p>Customer-impact in one line, what you know, what you're checking next. Re-post every 10 minutes.</p></div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div><h4>Mitigate before you diagnose.</h4><p>If a recent deploy is suspect, roll back. If KMS is degraded, fail open is <em>never</em> the answer for auth — escalate to security.</p></div>
      </div>
      <div class="step">
        <div class="step-num">5</div>
        <div><h4>Hand off or stand down.</h4><p>If you can't resolve in 30 min, hand to the secondary. When healthy, close with <code>/incident close</code>; postmortem is owed within 5 business days.</p></div>
      </div>
    </div>
  </section>

  <footer>
    <span>Northwind Identity Platform · runbook v3.2</span>
    <span>Source: ops-docs/auth-service.md</span>
  </footer>
</div>
</body>
</html>

\`\`\``},{name:`finance-report`,description:`Quarterly / monthly financial report — masthead with KPIs, revenue and burn charts, P&L summary table, top-line highlights, and an outlook paragraph. Use when the brief mentions "financial report", "Q3 report", "MRR review", "P&L", or "财报".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/finance-report`,body:`# Finance Report Skill

Produce a single-screen financial report in one self-contained HTML file.

## Workflow

1. **Read the active DESIGN.md.** Tables, KPI cards, and chart strokes use
   palette tokens — never invent new ones.
2. **Classify** the period (monthly / quarterly / yearly) and entity
   (startup, division, project) from the brief. If unspecified, assume a
   quarterly SaaS report and pick believable numbers.
3. **Layout** the page in this order:
   - Masthead: company / period / "Confidential — Finance" badge.
   - Headline KPI strip (4 cards): Revenue, Net new MRR, Gross margin, Cash runway.
   - Revenue trend chart (inline SVG line + area).
   - Cost breakdown chart (inline SVG bar) with a 2–3 bullet caption.
   - P&L summary table (Revenue / Gross profit / Opex / Net) with current vs prior period.
   - Top accounts table with logo placeholders, plan, ARR, status badge.
   - Outlook paragraph + footer with author + signature line.
4. **Write** one self-contained HTML doc (CSS in one inline \`<style>\` block).
5. **Self-check**: every number ties to a labelled chart or table; deltas
   show direction and percentage; accent colour used at most twice.

## Output contract

\`\`\`
<artifact identifier="finance-report-q3" type="text/html" title="Q3 Finance Report">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Northwind — Q3 Financial Report</title>
<style>
  :root {
    --bg: #f7f6f2;
    --paper: #ffffff;
    --ink: #11141a;
    --muted: #5f6573;
    --line: #e6e3dd;
    --line-strong: #c8c2b6;
    --accent: #1f6e8c;
    --accent-soft: #e7f0f4;
    --positive: #1f8c5c;
    --negative: #b13b3b;
    --display: 'Iowan Old Style', 'Charter', 'Iowan', Georgia, serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--body);
    font-size: 14px;
    line-height: 1.55;
  }
  .page {
    max-width: 980px;
    margin: 32px auto;
    padding: 56px 64px;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(28,27,26,0.06);
  }
  header.masthead { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 18px; border-bottom: 2px solid var(--ink); margin-bottom: 28px; }
  .mast-left { display: flex; flex-direction: column; gap: 6px; }
  .mast-co { font-family: var(--display); font-size: 32px; letter-spacing: -0.01em; font-weight: 700; }
  .mast-meta { font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .mast-badge {
    font-family: var(--mono); font-size: 11px; padding: 5px 10px; border-radius: 4px;
    border: 1px solid var(--ink); color: var(--ink); text-transform: uppercase; letter-spacing: 0.08em;
  }

  h2 { font-family: var(--display); font-size: 19px; margin: 36px 0 14px; letter-spacing: -0.005em; font-weight: 700; }
  h2 .accent { color: var(--accent); }
  .lede { color: var(--muted); max-width: 64ch; }

  /* KPI strip */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 8px 0 28px; }
  .kpi { padding: 16px 18px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .kpi .label { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .kpi .value { font-family: var(--display); font-size: 28px; font-weight: 700; margin-top: 6px; line-height: 1; letter-spacing: -0.01em; }
  .kpi .delta { font-family: var(--mono); font-size: 11.5px; margin-top: 6px; }
  .delta.up { color: var(--positive); }
  .delta.down { color: var(--negative); }
  .delta.flat { color: var(--muted); }

  /* Charts */
  .chart-row { display: grid; grid-template-columns: 1.6fr 1fr; gap: 14px; }
  .card { padding: 18px 20px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .card h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
  .card .sub { font-size: 12px; color: var(--muted); }
  .chart svg { width: 100%; height: 200px; display: block; margin-top: 8px; }
  .legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--muted); margin-top: 6px; }
  .legend .swatch { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
  .legend .a { background: var(--accent); }
  .legend .b { background: var(--ink); opacity: 0.6; }

  /* Bars */
  .bars { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 60px; gap: 10px; align-items: center; font-size: 12.5px; }
  .bar-row .label { color: var(--muted); }
  .bar-track { background: var(--accent-soft); border-radius: 4px; height: 10px; position: relative; overflow: hidden; }
  .bar-fill { background: var(--accent); height: 100%; border-radius: 4px; }
  .bar-value { font-family: var(--mono); font-size: 11.5px; text-align: right; color: var(--ink); }

  /* Tables */
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; vertical-align: middle; }
  th { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); border-bottom: 1px solid var(--line-strong); }
  td.num, th.num { text-align: right; font-family: var(--mono); }
  tr.total td { font-weight: 700; border-top: 2px solid var(--ink); border-bottom: none; padding-top: 14px; }
  .badge { display: inline-block; padding: 2px 8px; font-size: 11px; border-radius: 999px; font-weight: 500; }
  .badge.green { background: #e7f4ee; color: var(--positive); }
  .badge.amber { background: #fbf0d6; color: #8a6912; }
  .badge.red { background: #f7e1e1; color: var(--negative); }
  .logo { display: inline-flex; width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), #2c98c5); margin-right: 10px; vertical-align: middle; }

  /* Outlook */
  .outlook { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 12px; }
  .outlook .quote { padding: 18px; background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: 6px; font-family: var(--display); font-size: 16px; line-height: 1.5; }
  .outlook .signoff { font-size: 13px; color: var(--muted); }
  .outlook .signoff strong { color: var(--ink); display: block; font-family: var(--display); font-size: 16px; margin-bottom: 2px; }
  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

  @media (max-width: 760px) {
    .page { padding: 32px 24px; margin: 0; border-radius: 0; }
    .kpis { grid-template-columns: 1fr 1fr; }
    .chart-row { grid-template-columns: 1fr; }
    .outlook { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div class="mast-left">
      <div class="mast-meta">Northwind Trading · Q3 FY25</div>
      <div class="mast-co">Quarterly Financial Report</div>
      <div class="mast-meta">Prepared by Finance · Issued 14 October 2025</div>
    </div>
    <div class="mast-badge">Confidential</div>
  </header>

  <p class="lede">Q3 closed ahead of plan on revenue and gross margin, with cash runway extending to 27 months on the back of a leaner cost base. Mid-market and enterprise both expanded; SMB churn remains the watch item heading into Q4.</p>

  <h2>Headline KPIs</h2>
  <div class="kpis">
    <div class="kpi">
      <div class="label">Revenue</div>
      <div class="value">$8.42M</div>
      <div class="delta up">▲ 14.6% QoQ</div>
    </div>
    <div class="kpi">
      <div class="label">Net new MRR</div>
      <div class="value">$184k</div>
      <div class="delta up">▲ 22.0% QoQ</div>
    </div>
    <div class="kpi">
      <div class="label">Gross margin</div>
      <div class="value">82%</div>
      <div class="delta up">▲ 3 pp YoY</div>
    </div>
    <div class="kpi">
      <div class="label">Cash runway</div>
      <div class="value">27 mo</div>
      <div class="delta up">▲ 4 mo QoQ</div>
    </div>
  </div>

  <h2>Revenue & costs</h2>
  <div class="chart-row">
    <div class="card">
      <h3>Revenue · trailing 12 months</h3>
      <div class="sub">USD millions, monthly</div>
      <div class="chart">
        <svg viewBox="0 0 720 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.32"/>
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <polygon fill="url(#lg)" points="20,180 20,150 80,140 140,128 200,118 260,110 320,98 380,92 440,80 500,72 560,60 620,52 680,40 700,40 700,180" />
          <polyline fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"
            points="20,150 80,140 140,128 200,118 260,110 320,98 380,92 440,80 500,72 560,60 620,52 680,40" />
          <polyline fill="none" stroke="#11141a" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="3 3"
            points="20,165 80,158 140,150 200,142 260,134 320,128 380,122 440,116 500,108 560,102 620,96 680,90" />
          <circle cx="680" cy="40" r="3.5" fill="var(--accent)"/>
        </svg>
        <div class="legend">
          <span><span class="swatch a"></span>Revenue</span>
          <span><span class="swatch b"></span>Plan</span>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Operating costs</h3>
      <div class="sub">USD thousands, Q3</div>
      <div class="bars">
        <div class="bar-row"><span class="label">R&amp;D</span><div class="bar-track"><div class="bar-fill" style="width: 78%"></div></div><span class="bar-value">$1.42M</span></div>
        <div class="bar-row"><span class="label">Sales & GTM</span><div class="bar-track"><div class="bar-fill" style="width: 60%"></div></div><span class="bar-value">$1.10M</span></div>
        <div class="bar-row"><span class="label">G&amp;A</span><div class="bar-track"><div class="bar-fill" style="width: 36%"></div></div><span class="bar-value">$660k</span></div>
        <div class="bar-row"><span class="label">Marketing</span><div class="bar-track"><div class="bar-fill" style="width: 28%"></div></div><span class="bar-value">$510k</span></div>
        <div class="bar-row"><span class="label">Infrastructure</span><div class="bar-track"><div class="bar-fill" style="width: 18%"></div></div><span class="bar-value">$330k</span></div>
      </div>
    </div>
  </div>

  <h2>P&amp;L summary</h2>
  <table>
    <thead>
      <tr>
        <th>Line item</th>
        <th class="num">Q3 FY25</th>
        <th class="num">Q2 FY25</th>
        <th class="num">Δ QoQ</th>
        <th class="num">Q3 FY24</th>
        <th class="num">Δ YoY</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Revenue</td><td class="num">$8.42M</td><td class="num">$7.34M</td><td class="num" style="color: var(--positive);">+14.6%</td><td class="num">$5.92M</td><td class="num" style="color: var(--positive);">+42.2%</td></tr>
      <tr><td>Cost of revenue</td><td class="num">($1.51M)</td><td class="num">($1.46M)</td><td class="num" style="color: var(--negative);">+3.4%</td><td class="num">($1.18M)</td><td class="num" style="color: var(--negative);">+28.0%</td></tr>
      <tr><td>Gross profit</td><td class="num">$6.91M</td><td class="num">$5.88M</td><td class="num" style="color: var(--positive);">+17.5%</td><td class="num">$4.74M</td><td class="num" style="color: var(--positive);">+45.8%</td></tr>
      <tr><td>Operating expenses</td><td class="num">($4.02M)</td><td class="num">($4.18M)</td><td class="num" style="color: var(--positive);">−3.8%</td><td class="num">($3.66M)</td><td class="num" style="color: var(--negative);">+9.8%</td></tr>
      <tr class="total"><td>Operating income</td><td class="num">$2.89M</td><td class="num">$1.70M</td><td class="num" style="color: var(--positive);">+70.0%</td><td class="num">$1.08M</td><td class="num" style="color: var(--positive);">+167.5%</td></tr>
    </tbody>
  </table>

  <h2>Top accounts</h2>
  <table>
    <thead>
      <tr>
        <th>Customer</th>
        <th>Plan</th>
        <th>Region</th>
        <th class="num">ARR</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr><td><span class="logo"></span>Pioneer Robotics</td><td>Enterprise</td><td>EMEA</td><td class="num">$612k</td><td><span class="badge green">Renewed</span></td></tr>
      <tr><td><span class="logo"></span>Atlas Cooperative</td><td>Enterprise</td><td>APAC</td><td class="num">$486k</td><td><span class="badge green">Expanded</span></td></tr>
      <tr><td><span class="logo"></span>Foundry Group</td><td>Team Plus</td><td>NA</td><td class="num">$320k</td><td><span class="badge amber">In renewal</span></td></tr>
      <tr><td><span class="logo"></span>Voltage Co.</td><td>Enterprise</td><td>NA</td><td class="num">$298k</td><td><span class="badge green">Renewed</span></td></tr>
      <tr><td><span class="logo"></span>Lattice Health</td><td>Team Plus</td><td>EMEA</td><td class="num">$214k</td><td><span class="badge red">At risk</span></td></tr>
    </tbody>
  </table>

  <h2>Outlook · Q4</h2>
  <div class="outlook">
    <div class="quote">"We're entering Q4 with the strongest pipeline coverage of the year — 3.4× plan — and the operating leverage to convert it without expanding the cost base."</div>
    <div class="signoff">
      <strong>Mira Okafor, CFO</strong>
      We expect revenue of $9.1–9.4M, net new MRR of $200–220k, and gross margin holding above 80%. The two open items are SMB churn (we'll publish a recovery plan with the November update) and the EMEA infra migration, which moves to GA in mid-November.
    </div>
  </div>

  <footer>
    <span>Northwind Trading · Q3 FY25 · Internal use only</span>
    <span>Page 1 of 1</span>
  </footer>
</div>
</body>
</html>

\`\`\``},{name:`gamified-app`,description:`A multi-frame gamified mobile-app prototype — three phone frames on a dark showcase stage. Frame 1: cover / poster, Frame 2: today's quests with XP ribbons and a level bar, Frame 3: quest detail. Vivid quest tiles, level ribbon, bottom tab bar. Use when the brief asks for a "gamified app", "habit tracker", "RPG-style life app", "level-up app", "daily quests", "XP / streak app", or "ELI5-style explainer app".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/gamified-app`,body:`# Gamified App Skill

Produce a multi-screen mobile prototype on a single dark showcase page.
Three phone frames side-by-side, each one its own moment in the journey.

## Workflow

1. **Read the active DESIGN.md** (injected above). For gamified apps, lean
   on bold display type for headlines and a brighter, broader palette than
   most products — quests look like quests because the colors do.
2. **Pick the brand + value prop** from the brief. Generate real quest
   names (e.g. "Body — 20-min strength: pushups & planks", "Read — Four
   Thousand Weeks", "Listen — Huberman Lab · Sleep Architecture",
   "Nourish — Cook a high-protein lunch", "Mind — 10-min focus
   meditation", "Watch — The Bear · S3 E4").
3. **Stage** — full-bleed dark page (near-black \`#0e0d0c\` or DS dark token)
   with a soft top spotlight gradient. Above the phones, a small caption
   row: "HI-FI PROTOTYPE · IPHONE" left, brand wordmark right, both in mono.
4. **Phones** — three 360×780 phone frames in a horizontal row (wraps to
   stack on narrow viewports). Each phone:
   - 12px black bezel, 44px corner radius, dynamic-island notch.
   - Status bar (time / signal / battery).
   - Phone-specific content (below).
   - Bottom tab bar with 5 icons (Today, Library, Stats, ⊕ central CTA,
     Profile). Active tab in accent.
5. **Phone 1 — cover poster (sales/value prop)**:
   - Status bar.
   - HI-FI PROTOTYPE · IPHONE eyebrow.
   - Big display headline ("Daily quests for becoming a better human."),
     accent on "becoming".
   - 1–2 sentence body in muted serif/sans.
   - Mono tip line ("Tap quests to open detail. Toggle [theme] in the
     toolbar to switch theme & layout.")
   - Subtle scrolling teaser of the next screen at the bottom edge.
6. **Phone 2 — today's quests dashboard** (the hero screen):
   - Greeting "Good morning, Sam" + small XP-bell ringing.
   - Level ribbon — "LV 14 · Level 14 · 1648 / 2480 XP" with a progress
     bar inside a glassmorphic ribbon.
   - Sub-line: "8 quests waiting · earn 430 XP today".
   - 3×2 grid of quest tiles. Each tile: rounded corner, pastel accent
     color, glyph chip in top-left, title, mini-meta line, "+NN XP" pill
     in bottom-right.
   - Bottom tab bar.
7. **Phone 3 — quest detail**:
   - Back arrow + screen title ("Quest").
   - Hero block with the quest's accent color, big serif quest title
     ("Body — strength"), short narrative body, "REWARD +90 XP" stamp.
   - Steps checklist (3–4 micro-tasks, one done, two pending).
   - Big primary CTA "Start quest" pill at the bottom in accent.
8. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - All in CSS — no images. Use \`linear-gradient\` and inline SVG glyphs
     for tile chips and tab icons.
   - \`data-od-id\` on stage, each phone, each frame's regions.
9. **Self-check**:
   - Three frames, each with a distinct purpose. Not three copies of the
     same screen.
   - Tile colors don't overpower — each quest tile uses a different pastel
     against the same neutral surface.
   - Reads as gamified and adult — playful, not childish.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="game-slug" type="text/html" title="Mobile — App Name">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Level — daily quests for becoming a better human</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --stage: #0e0d0c;
      --stage-2: #1a1714;
      --paper: #ffffff;
      --ink: #1a1714;
      --muted: #6c6660;
      --line: #ebe6dd;
      --accent: #e98425;
      --accent-2: #ff6b3d;
      --tile-1: #ffe9bf;
      --tile-2: #ffe1d9;
      --tile-3: #f3e6ff;
      --tile-4: #d2eecb;
      --tile-5: #d6e7ff;
      --tile-6: #ffd6f1;
      --serif: 'Instrument Serif', 'Iowan Old Style', Georgia, serif;
      --sans: 'Inter', -apple-system, system-ui, sans-serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(233,132,37,0.18), transparent 70%),
        radial-gradient(ellipse 70% 50% at 50% 110%, rgba(255,255,255,0.04), transparent 70%),
        var(--stage);
      color: #f5efe4;
      font: 14px/1.5 var(--sans);
    }

    .stage-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 24px 36px;
      font: 11px/1 var(--mono);
      color: rgba(245,239,228,0.5);
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }
    .stage-bar .word { font-family: var(--serif); font-style: italic; font-size: 22px; color: #f5efe4; letter-spacing: 0; text-transform: none; }

    .phones {
      display: flex; gap: 28px; justify-content: center; padding: 12px 32px 56px;
      flex-wrap: wrap;
    }
    .phone {
      width: 360px; height: 760px;
      background: #050403;
      border-radius: 56px;
      padding: 12px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.04);
      flex-shrink: 0;
      position: relative;
    }
    .phone::before {
      content: '';
      position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
      width: 116px; height: 30px; background: #050403; border-radius: 999px; z-index: 5;
    }
    .screen { width: 100%; height: 100%; background: var(--paper); border-radius: 44px; overflow: hidden; display: flex; flex-direction: column; color: var(--ink); }
    .status { display: flex; justify-content: space-between; align-items: center; padding: 14px 26px 6px; font: 600 14px/1 var(--sans); }
    .status .right { display: flex; gap: 6px; align-items: center; font-size: 12px; }

    /* Phone 1 — cover */
    .cover { background: var(--ink); color: #fef9ee; height: 100%; display: flex; flex-direction: column; }
    .cover .status { color: #fef9ee; }
    .cover .body { flex: 1; padding: 40px 28px 0; display: flex; flex-direction: column; }
    .cover .eyebrow { display: inline-flex; align-items: center; gap: 6px; font: 10.5px/1 var(--mono); letter-spacing: 0.18em; color: rgba(254,249,238,0.6); padding: 6px 9px; border: 1px solid rgba(254,249,238,0.22); border-radius: 999px; align-self: flex-start; margin-bottom: 26px; }
    .cover .eyebrow .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; }
    .cover h1 { font: italic 800 56px/1 var(--serif); margin: 0 0 16px; letter-spacing: -0.005em; max-width: 12ch; }
    .cover h1 .accent { color: var(--accent); font-style: italic; }
    .cover p.lede { color: rgba(254,249,238,0.62); font-size: 14.5px; line-height: 1.55; margin: 0 0 18px; }
    .cover .tip { font: 11px/1.5 var(--mono); color: rgba(254,249,238,0.4); border-top: 1px dashed rgba(254,249,238,0.2); padding-top: 12px; }
    .cover .tip b { color: rgba(254,249,238,0.7); font-weight: 500; }
    .cover .next-peek { margin-top: auto; height: 92px; background: #211d18; border-top-left-radius: 26px; border-top-right-radius: 26px; padding: 14px 22px; display: flex; align-items: center; gap: 10px; color: rgba(254,249,238,0.6); font: 11px/1.4 var(--mono); letter-spacing: 0.16em; text-transform: uppercase; }
    .cover .next-peek .swatch { width: 36px; height: 36px; border-radius: 8px; background: var(--accent); flex-shrink: 0; }

    /* Phone 2 — quests dashboard */
    .home { display: flex; flex-direction: column; height: 100%; padding: 0; }
    .home .head { padding: 14px 22px 6px; display: flex; justify-content: space-between; align-items: center; }
    .home .head h2 { margin: 0; font: 700 18px/1.2 var(--sans); letter-spacing: -0.005em; }
    .home .head .bell { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,107,61,0.10); color: var(--accent-2); display: grid; place-items: center; font: 700 11px/1 var(--sans); }
    .level-ribbon {
      margin: 8px 14px 12px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #1a1714 0%, #2b251f 100%);
      color: #f5efe4; border-radius: 16px;
      display: grid; grid-template-columns: 38px 1fr auto; gap: 12px; align-items: center;
    }
    .level-ribbon .lv { width: 38px; height: 38px; border-radius: 12px; background: var(--accent); display: grid; place-items: center; font: 700 14px/1 var(--mono); color: #1a1714; }
    .level-ribbon .meta .label { font: 10px/1 var(--mono); letter-spacing: 0.16em; color: rgba(245,239,228,0.5); text-transform: uppercase; }
    .level-ribbon .meta .name { font: 700 14px/1.2 var(--sans); margin-top: 4px; }
    .level-ribbon .xp { font: 600 12px/1 var(--mono); color: rgba(245,239,228,0.7); }
    .level-ribbon .bar { grid-column: 1 / -1; height: 6px; background: rgba(245,239,228,0.10); border-radius: 999px; overflow: hidden; margin-top: 8px; }
    .level-ribbon .bar > span { display: block; width: 66%; height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }

    .home .sub { padding: 0 22px 10px; font: 12.5px/1.4 var(--sans); color: var(--muted); display: flex; align-items: center; gap: 8px; }
    .home .sub .pill { font: 10.5px/1 var(--mono); padding: 4px 8px; border-radius: 999px; background: var(--ink); color: #f5efe4; letter-spacing: 0.06em; }

    .quests { padding: 4px 14px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; overflow: hidden; }
    .q { border-radius: 18px; padding: 12px; min-height: 110px; position: relative; display: flex; flex-direction: column; gap: 6px; }
    .q .glyph { width: 28px; height: 28px; border-radius: 8px; background: rgba(0,0,0,0.10); color: var(--ink); display: grid; place-items: center; font: 700 13px/1 var(--sans); }
    .q .title { font: 700 13.5px/1.3 var(--sans); color: var(--ink); margin: 0; }
    .q .meta { font: 11px/1.4 var(--sans); color: var(--ink); opacity: 0.7; }
    .q .xp { position: absolute; bottom: 10px; right: 10px; font: 700 11px/1 var(--mono); padding: 4px 7px; border-radius: 999px; background: var(--ink); color: #f5efe4; letter-spacing: 0.06em; }
    .q.q1 { background: var(--tile-2); }
    .q.q1 .glyph { background: #ff7a52; color: white; }
    .q.q2 { background: var(--tile-1); }
    .q.q2 .glyph { background: #f0b54a; color: white; }
    .q.q3 { background: var(--tile-3); }
    .q.q3 .glyph { background: #b08bf2; color: white; }
    .q.q4 { background: var(--tile-4); }
    .q.q4 .glyph { background: #6cba5b; color: white; }
    .q.q5 { background: var(--tile-6); }
    .q.q5 .glyph { background: #e76aae; color: white; }
    .q.q6 { background: var(--tile-5); }
    .q.q6 .glyph { background: #4a86e9; color: white; }

    /* Phone 3 — quest detail */
    .detail { display: flex; flex-direction: column; height: 100%; }
    .detail .topbar { display: flex; align-items: center; gap: 10px; padding: 8px 22px 6px; font: 13px/1 var(--sans); color: var(--muted); }
    .detail .topbar .back { width: 28px; height: 28px; border-radius: 50%; background: var(--line); display: grid; place-items: center; }
    .hero { margin: 8px 14px 14px; padding: 22px 20px 24px; border-radius: 24px; background: linear-gradient(160deg, #ffd2bb 0%, #ff7a52 100%); color: var(--ink); position: relative; overflow: hidden; }
    .hero .badge { display: inline-flex; align-items: center; gap: 6px; font: 10.5px/1 var(--mono); padding: 5px 8px; border-radius: 999px; background: rgba(0,0,0,0.10); letter-spacing: 0.16em; text-transform: uppercase; }
    .hero h2 { font: italic 700 30px/1.05 var(--serif); margin: 12px 0 6px; max-width: 12ch; }
    .hero p { font: 14px/1.5 var(--sans); color: rgba(26,23,20,0.75); margin: 0; max-width: 30ch; }
    .hero .stamp { position: absolute; right: 18px; top: 18px; font: 700 11px/1 var(--mono); padding: 6px 8px; background: rgba(255,255,255,0.7); border-radius: 999px; color: var(--ink); letter-spacing: 0.08em; }

    .steps { padding: 4px 22px 12px; }
    .steps h3 { font: 700 11px/1 var(--mono); letter-spacing: 0.18em; color: var(--muted); margin: 12px 0 8px; text-transform: uppercase; }
    .step { display: flex; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line); }
    .step .check { width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--line); flex-shrink: 0; display: grid; place-items: center; font: 700 11px/1 var(--sans); color: white; }
    .step.done .check { background: var(--accent); border-color: var(--accent); }
    .step.done .check::after { content: '✓'; }
    .step.done .name { color: var(--muted); text-decoration: line-through; }
    .step .name { font: 14px/1.3 var(--sans); }
    .step .meta { font: 11px/1 var(--mono); color: var(--muted); margin-left: auto; letter-spacing: 0.06em; }

    .detail .start {
      margin: auto 18px 12px; padding: 14px; border-radius: 999px;
      background: var(--ink); color: #f5efe4; text-align: center;
      font: 600 14px/1 var(--sans); letter-spacing: 0.06em;
    }

    /* Tab bar shared */
    .tabbar {
      margin-top: auto; display: grid; grid-template-columns: repeat(5, 1fr);
      padding: 10px 14px 26px; border-top: 1px solid var(--line); background: var(--paper);
    }
    .tab { display: flex; flex-direction: column; align-items: center; gap: 4px; font: 9.5px/1 var(--mono); color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
    .tab .icon { width: 22px; height: 22px; border-radius: 6px; background: var(--line); }
    .tab.active { color: var(--accent); }
    .tab.active .icon { background: var(--accent); }
    .tab.center .icon { background: var(--ink); color: #f5efe4; display: grid; place-items: center; font: 700 16px/1 var(--sans); border-radius: 50%; }

    @media (max-width: 1180px) {
      .phones { gap: 18px; }
      .phone { width: 320px; height: 700px; }
      .cover h1 { font-size: 46px; }
    }
  </style>
</head>
<body>
  <div class="stage-bar" data-od-id="stage-bar">
    <span>HI-FI PROTOTYPE · IPHONE</span>
    <span class="word">level<span style="color:var(--accent);">.</span></span>
    <span>3 SCREENS · LIGHT MODE</span>
  </div>

  <div class="phones" data-od-id="phones">

    <!-- Phone 1 — cover -->
    <div class="phone" data-od-id="phone-cover">
      <div class="screen cover">
        <div class="status"><span>9:41</span><span class="right">·· 5G · 100%</span></div>
        <div class="body">
          <span class="eyebrow"><span class="dot"></span>HI-FI PROTOTYPE · IPHONE</span>
          <h1>Daily quests for <span class="accent">becoming</span> a better human.</h1>
          <p class="lede">Level turns the things you already know you should do — exercise, read, reflect, call a friend — into a daily quest log. Finish them, earn XP, watch your classes level up.</p>
          <p class="tip">Tap quests to open detail. Complete the 6th quest to trigger the level-up moment. Toggle <b>[theme]</b> in the toolbar to switch theme &amp; layout.</p>
          <div class="next-peek"><div class="swatch"></div>NEXT — TODAY'S QUESTS</div>
        </div>
      </div>
    </div>

    <!-- Phone 2 — quests dashboard -->
    <div class="phone" data-od-id="phone-home">
      <div class="screen home">
        <div class="status"><span>9:41</span><span class="right">·· 5G · 100%</span></div>
        <div class="head">
          <h2>Good morning, Sam</h2>
          <div class="bell">×3</div>
        </div>
        <div class="level-ribbon" data-od-id="level-ribbon">
          <div class="lv">14</div>
          <div class="meta"><div class="label">LEVEL</div><div class="name">Level 14</div></div>
          <div class="xp">1648 / 2480</div>
          <div class="bar"><span></span></div>
        </div>
        <div class="sub">8 quests waiting · earn <span class="pill">430 XP</span> today</div>

        <div class="quests" data-od-id="quests">
          <div class="q q1">
            <div class="glyph">B</div>
            <p class="title">Body</p>
            <div class="meta">20-min strength: pushups &amp; planks</div>
            <span class="xp">+90</span>
          </div>
          <div class="q q2">
            <div class="glyph">R</div>
            <p class="title">Read</p>
            <div class="meta">Four Thousand Weeks</div>
            <span class="xp">+60</span>
          </div>
          <div class="q q3">
            <div class="glyph">L</div>
            <p class="title">Listen</p>
            <div class="meta">Huberman Lab — Sleep Architecture</div>
            <span class="xp">+50</span>
          </div>
          <div class="q q4">
            <div class="glyph">N</div>
            <p class="title">Nourish</p>
            <div class="meta">Cook a high-protein lunch</div>
            <span class="xp">+70</span>
          </div>
          <div class="q q5">
            <div class="glyph">M</div>
            <p class="title">Mind</p>
            <div class="meta">10-min focus meditation</div>
            <span class="xp">+40</span>
          </div>
          <div class="q q6">
            <div class="glyph">W</div>
            <p class="title">Watch</p>
            <div class="meta">The Bear · S3 E4</div>
            <span class="xp">+30</span>
          </div>
        </div>

        <div class="tabbar" data-od-id="tabbar-home">
          <div class="tab active"><div class="icon"></div>Today</div>
          <div class="tab"><div class="icon"></div>Library</div>
          <div class="tab center"><div class="icon">+</div>&nbsp;</div>
          <div class="tab"><div class="icon"></div>Stats</div>
          <div class="tab"><div class="icon"></div>Profile</div>
        </div>
      </div>
    </div>

    <!-- Phone 3 — detail -->
    <div class="phone" data-od-id="phone-detail">
      <div class="screen detail">
        <div class="status"><span>9:41</span><span class="right">·· 5G · 100%</span></div>
        <div class="topbar"><div class="back">←</div>QUEST · 03 / 08</div>
        <div class="hero">
          <span class="stamp">+90 XP</span>
          <span class="badge">— BODY · STRENGTH</span>
          <h2>20 minutes that change Wednesday.</h2>
          <p>A short, repeatable strength block — pushups, planks, and one wildcard. No equipment. Sam, you've finished this 11 times this month.</p>
        </div>
        <div class="steps" data-od-id="steps">
          <h3>Today's micro-tasks</h3>
          <div class="step done"><div class="check"></div><div class="name">Roll out the mat</div><div class="meta">+5 XP</div></div>
          <div class="step"><div class="check"></div><div class="name">3 × 12 pushups</div><div class="meta">+30 XP</div></div>
          <div class="step"><div class="check"></div><div class="name">3 × 45s plank</div><div class="meta">+30 XP</div></div>
          <div class="step"><div class="check"></div><div class="name">Wildcard: lunges</div><div class="meta">+25 XP</div></div>
        </div>
        <div class="start">Start quest</div>
        <div class="tabbar" data-od-id="tabbar-detail">
          <div class="tab active"><div class="icon"></div>Today</div>
          <div class="tab"><div class="icon"></div>Library</div>
          <div class="tab center"><div class="icon">+</div>&nbsp;</div>
          <div class="tab"><div class="icon"></div>Stats</div>
          <div class="tab"><div class="icon"></div>Profile</div>
        </div>
      </div>
    </div>

  </div>
</body>
</html>

\`\`\``},{name:`hr-onboarding`,description:`A new-hire onboarding plan as a single page — first week schedule, buddy + manager intro, learning track, equipment checklist, and "you're set when…" outcomes. Use when the brief mentions "onboarding", "new hire", "first week plan", or "入职".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/hr-onboarding`,body:`# HR Onboarding Skill

Produce a single-screen onboarding plan in HTML.

## Workflow

1. Read the active DESIGN.md.
2. Identify the role + tenure expectations from the brief. Default to a
   30/60/90-day shape if unspecified.
3. Layout:
   - Cover banner: name placeholder, role, start date, manager + buddy.
   - "Day 1" panel with the literal schedule (kickoff time, lunch, 1:1 slot).
   - First-week timeline (Mon → Fri, two activities per day).
   - 30 / 60 / 90 day milestone cards with three concrete outcomes each.
   - Resource list: handbook, Slack channels, key dashboards, payroll setup.
   - "You're set when…" checklist — five outcomes with checkboxes.
4. Single inline \`<style>\`, semantic HTML.

## Output contract

\`\`\`
<artifact identifier="onboarding-plan" type="text/html" title="Onboarding Plan">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Welcome to Northwind — Maya's Onboarding Plan</title>
<style>
  :root {
    --bg: #fbf9f4;
    --paper: #ffffff;
    --ink: #14110e;
    --muted: #6b6760;
    --line: #ece6d8;
    --accent: #c2521a;
    --accent-soft: #fbe6d6;
    --positive: #2c8a4f;
    --display: 'Georgia', 'Times New Roman', serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14.5px; line-height: 1.55; }
  .wrap { max-width: 1080px; margin: 28px auto; padding: 0 32px 64px; }

  /* Cover */
  .cover { padding: 36px 40px; background: var(--ink); color: var(--paper); border-radius: 16px; display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; }
  .cover .eyebrow { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-soft); }
  .cover h1 { font-family: var(--display); font-size: 38px; line-height: 1.05; letter-spacing: -0.01em; margin: 8px 0 12px; }
  .cover .meta { display: flex; gap: 28px; font-size: 13px; color: rgba(255,255,255,0.74); }
  .cover .meta strong { color: var(--paper); display: block; font-weight: 600; font-size: 14px; }
  .cover-art { width: 130px; height: 130px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), #ec8b5b); display: flex; align-items: center; justify-content: center; font-family: var(--display); font-size: 56px; color: var(--paper); }

  section { margin-top: 44px; }
  h2 { font-family: var(--display); font-size: 22px; margin: 0 0 6px; letter-spacing: -0.005em; }
  .section-sub { color: var(--muted); margin: 0 0 18px; font-size: 13.5px; }

  /* Day 1 */
  .day-one { padding: 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
  .schedule { display: grid; grid-template-columns: 110px 1fr; gap: 0; }
  .schedule-row { display: contents; }
  .schedule-row .time { padding: 12px 0; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .schedule-row .item { padding: 12px 0; border-top: 1px solid var(--line); }
  .schedule-row:first-child .time, .schedule-row:first-child .item { border-top: none; }
  .schedule-row .item strong { display: block; font-weight: 600; }
  .schedule-row .item span { color: var(--muted); font-size: 13px; }

  /* Week timeline */
  .week { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
  .day { padding: 16px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; gap: 12px; min-height: 200px; }
  .day-head { display: flex; justify-content: space-between; align-items: baseline; }
  .day-name { font-family: var(--display); font-size: 16px; font-weight: 700; }
  .day-date { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .activity { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; }
  .activity .dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; }
  .activity small { display: block; color: var(--muted); margin-top: 2px; font-size: 11.5px; }

  /* 30/60/90 */
  .milestones { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .milestone { padding: 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
  .milestone .badge { display: inline-block; font-family: var(--mono); font-size: 11px; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); letter-spacing: 0.06em; margin-bottom: 10px; }
  .milestone h3 { font-family: var(--display); font-size: 18px; margin: 0 0 12px; }
  .milestone ul { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
  .milestone li::marker { color: var(--accent); }

  /* Resources & checklist */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .panel { padding: 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }
  .panel h3 { font-family: var(--display); font-size: 17px; margin: 0 0 12px; }
  .resource { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); align-items: center; font-size: 13.5px; }
  .resource:first-of-type { border-top: none; padding-top: 0; }
  .resource .icon { width: 28px; height: 28px; background: var(--accent-soft); border-radius: 7px; color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
  .resource .meta { color: var(--muted); font-family: var(--mono); font-size: 11px; }
  .check { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-top: 1px dashed var(--line); }
  .check:first-of-type { border-top: none; padding-top: 0; }
  .check .box { flex: 0 0 18px; width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--ink); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; color: transparent; }
  .check.done .box { background: var(--positive); border-color: var(--positive); color: var(--paper); }
  .check strong { display: block; font-weight: 600; }
  .check span { color: var(--muted); font-size: 12.5px; }

  footer { margin-top: 56px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }

  @media (max-width: 900px) {
    .cover { grid-template-columns: 1fr; text-align: center; }
    .cover-art { margin: 0 auto; }
    .week { grid-template-columns: 1fr 1fr; }
    .milestones { grid-template-columns: 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="cover">
    <div>
      <div class="eyebrow">Onboarding plan · 30/60/90</div>
      <h1>Welcome, Maya. Let's make your first 90 days feel deliberate.</h1>
      <div class="meta">
        <div><strong>Role</strong>Product Designer · Growth squad</div>
        <div><strong>Start date</strong>Mon, 4 November 2025</div>
        <div><strong>Manager</strong>Alvaro Méndez</div>
        <div><strong>Onboarding buddy</strong>Sasha Lin</div>
      </div>
    </div>
    <div class="cover-art">M</div>
  </div>

  <section>
    <h2>Day 1 · Monday</h2>
    <p class="section-sub">A grounded day. Coffee with the team, a working laptop, and one shipped commit on the docs site by 5pm.</p>
    <div class="day-one">
      <div class="schedule">
        <div class="schedule-row"><div class="time">09:00</div><div class="item"><strong>Kickoff with Alvaro</strong><span>Welcome, week-one walkthrough, expectations chat. Office Room 3 (or Zoom).</span></div></div>
        <div class="schedule-row"><div class="time">10:00</div><div class="item"><strong>IT setup with Devon</strong><span>Laptop, badge, SSO, Slack, Figma, Linear, GitHub. Bring two photo IDs.</span></div></div>
        <div class="schedule-row"><div class="time">11:30</div><div class="item"><strong>Coffee with Sasha (buddy)</strong><span>The unwritten rules, who-to-ask map, where the good lunch spots are.</span></div></div>
        <div class="schedule-row"><div class="time">12:30</div><div class="item"><strong>Team lunch · Northwind cafeteria</strong><span>Whole Growth squad joins. No agenda.</span></div></div>
        <div class="schedule-row"><div class="time">14:00</div><div class="item"><strong>Read &amp; explore</strong><span>Handbook, last quarter's design crit recordings, Figma library.</span></div></div>
        <div class="schedule-row"><div class="time">16:00</div><div class="item"><strong>Ship "I exist" PR</strong><span>Add yourself to the team page on the docs site. Counts as your first commit.</span></div></div>
        <div class="schedule-row"><div class="time">17:00</div><div class="item"><strong>End-of-day check-in with Alvaro</strong><span>15 min. What was confusing, what wasn't. Repeat tomorrow if useful.</span></div></div>
      </div>
    </div>
  </section>

  <section>
    <h2>First week timeline</h2>
    <p class="section-sub">Two activities per day. Anything else is bonus.</p>
    <div class="week">
      <div class="day">
        <div class="day-head"><div class="day-name">Mon</div><div class="day-date">Nov 4</div></div>
        <div class="activity"><span class="dot"></span><div><strong>Kickoff + setup</strong><small>Alvaro · 09:00</small></div></div>
        <div class="activity"><span class="dot"></span><div><strong>Ship team-page PR</strong><small>Sasha can review</small></div></div>
      </div>
      <div class="day">
        <div class="day-head"><div class="day-name">Tue</div><div class="day-date">Nov 5</div></div>
        <div class="activity"><span class="dot"></span><div><strong>Design system tour</strong><small>Yuko · 10:00</small></div></div>
        <div class="activity"><span class="dot"></span><div><strong>Shadow user research call</strong><small>11:00 with Sam</small></div></div>
      </div>
      <div class="day">
        <div class="day-head"><div class="day-name">Wed</div><div class="day-date">Nov 6</div></div>
        <div class="activity"><span class="dot"></span><div><strong>Squad weekly</strong><small>09:30</small></div></div>
        <div class="activity"><span class="dot"></span><div><strong>Pick a starter ticket</strong><small>From the "good first issues" lane</small></div></div>
      </div>
      <div class="day">
        <div class="day-head"><div class="day-name">Thu</div><div class="day-date">Nov 7</div></div>
        <div class="activity"><span class="dot"></span><div><strong>Design crit attendance</strong><small>14:00. Just listen.</small></div></div>
        <div class="activity"><span class="dot"></span><div><strong>1:1 with skip-level</strong><small>Avi · 16:00</small></div></div>
      </div>
      <div class="day">
        <div class="day-head"><div class="day-name">Fri</div><div class="day-date">Nov 8</div></div>
        <div class="activity"><span class="dot"></span><div><strong>End-of-week retro</strong><small>15-min note to Alvaro</small></div></div>
        <div class="activity"><span class="dot"></span><div><strong>Optional: All-hands demo</strong><small>17:00 · drinks after</small></div></div>
      </div>
    </div>
  </section>

  <section>
    <h2>30 · 60 · 90 day milestones</h2>
    <p class="section-sub">Three outcomes per checkpoint. We'll review each at the matching 1:1 with Alvaro.</p>
    <div class="milestones">
      <div class="milestone">
        <span class="badge">Day 30</span>
        <h3>Find your footing</h3>
        <ul>
          <li>Shipped one small, end-to-end design change to production.</li>
          <li>Mapped every recurring meeting and why it exists.</li>
          <li>Met with each cross-functional partner (eng, PM, research, marketing).</li>
        </ul>
      </div>
      <div class="milestone">
        <span class="badge">Day 60</span>
        <h3>Own a feature</h3>
        <ul>
          <li>Driving design on the new onboarding redesign — own the spec.</li>
          <li>Ran your first design crit as the presenter.</li>
          <li>Drafted one process improvement and posted it for the team.</li>
        </ul>
      </div>
      <div class="milestone">
        <span class="badge">Day 90</span>
        <h3>Move the team forward</h3>
        <ul>
          <li>Shipped a feature you led from research → launch.</li>
          <li>Mentored someone — even informally.</li>
          <li>Shared one hot take in all-hands and lived to tell.</li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <h2>Things to bookmark</h2>
    <p class="section-sub">Open these, save them in your browser, then forget about this page.</p>
    <div class="grid-2">
      <div class="panel">
        <h3>Resources</h3>
        <div class="resource"><div class="icon">📘</div><div><strong>Northwind Handbook</strong></div><div class="meta">handbook.nw</div></div>
        <div class="resource"><div class="icon">💬</div><div><strong>#growth-squad</strong></div><div class="meta">Slack</div></div>
        <div class="resource"><div class="icon">🎨</div><div><strong>Design Library v3.4</strong></div><div class="meta">Figma</div></div>
        <div class="resource"><div class="icon">📊</div><div><strong>Growth dashboard</strong></div><div class="meta">grafana.nw</div></div>
        <div class="resource"><div class="icon">💸</div><div><strong>Payroll & benefits</strong></div><div class="meta">Rippling</div></div>
        <div class="resource"><div class="icon">📅</div><div><strong>Onboarding calendar</strong></div><div class="meta">cal.nw/onboard</div></div>
      </div>
      <div class="panel">
        <h3>You're set when…</h3>
        <div class="check done"><div class="box">✓</div><div><strong>Laptop, SSO, and badge work end-to-end.</strong><span>Includes Slack, Figma, Linear, GitHub, 1Password.</span></div></div>
        <div class="check done"><div class="box">✓</div><div><strong>You've met everyone on the squad.</strong><span>Coffee, walk, or 15-min Zoom — your call.</span></div></div>
        <div class="check"><div class="box"></div><div><strong>You've shipped your first PR.</strong><span>Even tiny ones count. Sasha will help.</span></div></div>
        <div class="check"><div class="box"></div><div><strong>You can find any meeting on the calendar.</strong><span>And know which ones you can decline.</span></div></div>
        <div class="check"><div class="box"></div><div><strong>You feel comfortable asking dumb questions.</strong><span>This is the most important one. We mean it.</span></div></div>
      </div>
    </div>
  </section>

  <footer>
    <span>Northwind People Ops · Onboarding plan template v3.1</span>
    <span>Updated October 2025</span>
  </footer>
</div>
</body>
</html>

\`\`\``},{name:`image-poster`,description:`Single-image generation skill for posters, key art, and editorial illustrations. Defaults to gpt-image-2 but is provider-agnostic — the same workflow drives Flux, Imagen, or Midjourney via the active upstream tooling. Output is one or more PNG/JPEG files saved to the project folder.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/image-poster`,body:`# Image Poster Skill

Produce **one** finished image asset per turn unless the user asks for
variations. Image generation rewards a tight, structured prompt — your
job is to assemble that prompt from the user's brief, then dispatch.

## Resource map

\`\`\`
image-poster/
├── SKILL.md         ← you're reading this
└── example.html     ← what the resulting card looks like in Examples
\`\`\`

## Workflow

### Step 0 — Read the project metadata

The active project carries \`imageModel\`, \`imageAspect\`, and (optional)
\`imageStyle\` notes. Use them as the upstream model + canvas + style
anchor; only ask the user to fill them in if they're marked \`(unknown
— ask)\`.

### Step 1 — Compose the prompt

Plan in this exact order before calling any tool:

1. **Subject + composition** — what is in the frame, where, at what
   scale; eye-line and crop.
2. **Lighting + mood** — natural / studio / moody; warm / cool; key
   plus rim plus fill; time of day if outdoor.
3. **Palette + textures** — hex anchors when the user gave a brand
   palette; otherwise a 3-word mood tag (e.g. "muted ochre + ink").
4. **Camera / lens** — only if the user wants photographic realism
   ("85mm portrait, shallow DOF") or a specific film stock.
5. **What to avoid** — common AI-slop patterns ("no extra fingers, no
   warped text, no logo placeholders").

### Step 2 — Dispatch via the media contract

Use the unified dispatcher — do **not** call upstream provider APIs by
hand. Run from your shell tool:

\`\`\`bash
node "$OD_BIN" media generate \\
  --project "$OD_PROJECT_ID" \\
  --surface image \\
  --model "<imageModel from metadata>" \\
  --aspect "<imageAspect from metadata>" \\
  --output "<short-descriptive-name>.png" \\
  --prompt "<the full assembled prompt from Step 1>"
\`\`\`

The command prints one line of JSON: \`{"file": {"name": "...", ...}}\`.
The daemon writes the bytes into the project folder; the FileViewer
picks it up automatically.

### Step 3 — Hand off

Reply with a one-paragraph summary of the prompt you used and the
filename returned by the dispatcher (e.g. *I generated \`hero-poster.png\`
with \`gpt-image-2\` at 1:1.*). Do **not** emit an \`<artifact>\` tag.

## Hard rules

- One image per turn unless asked for variations.
- Honor \`imageAspect\` exactly — the upstream cost is the same; matching
  the aspect avoids a re-render.
- No filler typography in the image itself unless the user asked for
  in-frame text. Real copy beats lorem.
- Save every render — never describe an image without producing the
  file. The user expects something to open in the file viewer.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Image poster — example</title>
    <style>
      :root {
        --bg: #f5efe5;
        --ink: #1c1b1a;
        --accent: #c96442;
        --muted: #8b8579;
        --paper: #efe7d7;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
        font-family: 'Iowan Old Style', 'Charter', Georgia, serif; }
      body { min-height: 100dvh; display: grid; place-items: center; padding: 32px; }
      .poster {
        width: min(640px, 92vw);
        aspect-ratio: 3 / 4;
        background: var(--paper);
        border: 1px solid rgba(28, 27, 26, 0.08);
        border-radius: 6px;
        box-shadow: 0 16px 48px rgba(28, 27, 26, 0.12), 0 1px 2px rgba(28, 27, 26, 0.06);
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: 38px 32px;
        position: relative;
        overflow: hidden;
      }
      .poster::after {
        content: '';
        position: absolute; inset: 0;
        pointer-events: none;
        background:
          radial-gradient(circle at 30% 18%, rgba(255,255,255,0.7), transparent 60%),
          repeating-linear-gradient(0deg, rgba(28,27,26,0.025) 0 1px, transparent 1px 2px);
      }
      .eyebrow {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .accent-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: var(--accent);
      }
      .silhouette {
        align-self: center;
        justify-self: center;
        width: 70%;
        aspect-ratio: 1 / 1;
        position: relative;
      }
      .silhouette svg { width: 100%; height: 100%; display: block; }
      .meta {
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 10.5px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        gap: 12px;
        align-items: end;
      }
      .meta strong { color: var(--ink); font-weight: 600; }
      .title {
        font-size: 44px;
        line-height: 0.95;
        margin: 18px 0 0;
        letter-spacing: -0.01em;
      }
      .title em { font-style: italic; color: var(--accent); }
      .footer {
        margin-top: 12px;
        font-size: 13px;
        color: var(--muted);
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      }
    </style>
  </head>
  <body>
    <div class="poster">
      <div class="eyebrow">
        <span>Open Design · Image</span>
        <span class="accent-dot" aria-hidden></span>
      </div>
      <div class="silhouette" aria-hidden>
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="38" r="18" fill="#1c1b1a" />
          <path d="M22 100 C 22 70, 78 70, 78 100 Z" fill="#1c1b1a" />
          <circle cx="68" cy="22" r="6" fill="#c96442" />
        </svg>
      </div>
      <div>
        <h1 class="title">An <em>image</em> project<br />produced by the agent.</h1>
        <div class="meta">
          <span><strong>gpt-image-2</strong></span>
          <span>·</span>
          <span style="text-align:right">3:4 · poster</span>
        </div>
        <p class="footer">Saved as PNG into the project folder.</p>
      </div>
    </div>
  </body>
</html>

\`\`\``},{name:`invoice`,description:`A printable invoice page — sender + recipient block, line items table, tax breakdown, totals, and payment instructions. Use when the brief mentions "invoice", "bill", "billing statement", or "发票".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/invoice`,body:`# Invoice Skill

Produce a single-page printable invoice.

## Workflow

1. Read DESIGN.md.
2. Layout:
   - Top band: studio brand on the left, "INVOICE" + number + date + due date on the right.
   - Two columns: From (sender) / Bill to (recipient) with addresses.
   - Project ref + payment-terms strip.
   - Line items table: description / qty / unit / amount.
   - Right-aligned totals block: subtotal, retainer, tax, total due.
   - Payment instructions (bank, wire, ACH).
   - Thank-you note + signature line.
3. Print stylesheet @media print to remove backgrounds.

## Output contract

\`\`\`
<artifact identifier="invoice-name" type="text/html" title="Invoice">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice · Sable Studio · INV-2025-0142</title>
<style>
  :root {
    --bg: #f3f1ec;
    --paper: #ffffff;
    --ink: #15140f;
    --muted: #6e6a5d;
    --line: #ddd6c4;
    --accent: #1f4d3a;
    --accent-soft: #e3ece8;
    --display: 'Iowan Old Style', 'Charter', Georgia, serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14px; line-height: 1.55; }
  .sheet { max-width: 820px; margin: 32px auto; background: var(--paper); padding: 64px 72px; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 24px 60px rgba(28,27,26,0.06); }

  header.brandbar { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: flex-start; padding-bottom: 28px; border-bottom: 2px solid var(--ink); }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark { width: 44px; height: 44px; border-radius: 50%; background: var(--ink); color: var(--paper); display: inline-flex; align-items: center; justify-content: center; font-family: var(--display); font-size: 22px; font-weight: 700; }
  .brand-name { font-family: var(--display); font-size: 22px; font-weight: 700; letter-spacing: -0.005em; }
  .brand-meta { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .invoice-block { text-align: right; }
  .invoice-label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
  .invoice-num { font-family: var(--display); font-size: 32px; letter-spacing: -0.01em; font-weight: 700; margin: 6px 0 4px; }
  .invoice-dates { font-size: 13px; color: var(--muted); }
  .invoice-dates strong { color: var(--ink); }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding: 28px 0; }
  .party h4 { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 8px; font-weight: 500; }
  .party .name { font-family: var(--display); font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .party .lines { font-size: 13.5px; color: var(--muted); line-height: 1.6; }
  .party .lines a { color: var(--accent); text-decoration: none; }

  .ref-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 16px 22px; background: var(--accent-soft); border-radius: 6px; margin-bottom: 32px; }
  .ref-strip .label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); margin-bottom: 4px; font-weight: 500; }
  .ref-strip .value { font-size: 14px; }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; padding: 10px 12px; border-bottom: 2px solid var(--ink); font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 500; }
  tbody td { padding: 14px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  td.desc strong { display: block; font-weight: 600; margin-bottom: 4px; }
  td.desc small { display: block; color: var(--muted); font-size: 12.5px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--mono); font-size: 13.5px; }
  th.num { text-align: right; }

  .totals { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; margin-top: 28px; align-items: flex-start; }
  .terms { font-size: 12.5px; color: var(--muted); padding: 18px 20px; background: var(--bg); border-radius: 6px; }
  .terms h5 { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink); margin: 0 0 6px; font-weight: 500; }
  .totals-block { display: flex; flex-direction: column; gap: 8px; }
  .total-row { display: flex; justify-content: space-between; font-size: 14px; padding: 6px 0; }
  .total-row.subtotal { border-top: 1px solid var(--line); padding-top: 14px; }
  .total-row.discount { color: var(--accent); }
  .total-row.tax { color: var(--muted); }
  .total-row.grand { padding: 14px 18px; background: var(--ink); color: var(--paper); border-radius: 6px; margin-top: 6px; font-family: var(--display); font-size: 20px; font-weight: 700; align-items: center; }

  .pay { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 36px; padding: 22px; border: 1px solid var(--line); border-radius: 8px; }
  .pay h4 { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; font-weight: 500; }
  .pay .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .pay .row span { font-family: var(--mono); }

  .signoff { margin-top: 40px; display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: end; }
  .signoff p { margin: 0; font-family: var(--display); font-size: 16px; font-style: italic; color: var(--muted); }
  .signature { text-align: right; }
  .signature .scribble { font-family: 'Brush Script MT', 'Snell Roundhand', cursive; font-size: 28px; color: var(--accent); }
  .signature .name { font-size: 12.5px; color: var(--muted); padding-top: 6px; border-top: 1px solid var(--line); margin-top: 4px; }

  @media print {
    body { background: white; }
    .sheet { box-shadow: none; border: none; margin: 0; padding: 32px 36px; }
  }
  @media (max-width: 720px) {
    .sheet { padding: 32px 24px; margin: 0; border-radius: 0; }
    .parties, .pay, .signoff { grid-template-columns: 1fr; }
    .totals { grid-template-columns: 1fr; }
    .ref-strip { grid-template-columns: 1fr; }
    header.brandbar { grid-template-columns: 1fr; }
    .invoice-block { text-align: left; }
  }
</style>
</head>
<body>
<div class="sheet">
  <header class="brandbar">
    <div>
      <div class="brand">
        <div class="brand-mark">S</div>
        <div>
          <div class="brand-name">Sable Studio</div>
          <div class="brand-meta">Brand &amp; product design · est. 2018</div>
        </div>
      </div>
    </div>
    <div class="invoice-block">
      <div class="invoice-label">Invoice</div>
      <div class="invoice-num">INV-2025-0142</div>
      <div class="invoice-dates"><strong>Issued</strong> 14 October 2025 · <strong>Due</strong> 13 November 2025</div>
    </div>
  </header>

  <section class="parties">
    <div class="party">
      <h4>From</h4>
      <div class="name">Sable Studio LLC</div>
      <div class="lines">
        221 Cooper Street, 4F<br>
        Brooklyn, NY 11211 · USA<br>
        EIN 87-1234567<br>
        <a href="mailto:billing@sable.studio">billing@sable.studio</a>
      </div>
    </div>
    <div class="party">
      <h4>Bill to</h4>
      <div class="name">Northwind Trading Co.</div>
      <div class="lines">
        Attn: Mira Okafor, CFO<br>
        500 Howard Street, Floor 9<br>
        San Francisco, CA 94103 · USA<br>
        AP: <a href="mailto:ap@northwind.com">ap@northwind.com</a>
      </div>
    </div>
  </section>

  <div class="ref-strip">
    <div><div class="label">Project</div><div class="value">Northwind brand identity refresh</div></div>
    <div><div class="label">PO Number</div><div class="value">NW-PO-2025-3387</div></div>
    <div><div class="label">Terms</div><div class="value">Net 30 · USD</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="desc"><strong>Discovery & strategy</strong><small>Stakeholder interviews, competitive audit, brand audit, written strategy doc.</small></td>
        <td class="num">1</td>
        <td class="num">$8,500.00</td>
        <td class="num">$8,500.00</td>
      </tr>
      <tr>
        <td class="desc"><strong>Identity system design</strong><small>Wordmark, monogram, palette, typography, motion principles, two production rounds.</small></td>
        <td class="num">1</td>
        <td class="num">$22,000.00</td>
        <td class="num">$22,000.00</td>
      </tr>
      <tr>
        <td class="desc"><strong>Brand guidelines & handoff</strong><small>Brand book PDF, Figma library, asset pack, two team handoff sessions.</small></td>
        <td class="num">1</td>
        <td class="num">$6,500.00</td>
        <td class="num">$6,500.00</td>
      </tr>
      <tr>
        <td class="desc"><strong>Senior design hours · overage</strong><small>Additional rounds requested between 12 Sep and 28 Sep beyond the original SOW.</small></td>
        <td class="num">14</td>
        <td class="num">$220.00</td>
        <td class="num">$3,080.00</td>
      </tr>
    </tbody>
  </table>

  <div class="totals">
    <div class="terms">
      <h5>Payment terms</h5>
      Payment is due within 30 days of issue. Late payments incur a 1.5% monthly service charge per the master services agreement signed 14 February 2025. The 10% retainer paid 12 August 2025 has been applied below.
    </div>
    <div class="totals-block">
      <div class="total-row"><span>Subtotal</span><span>$40,080.00</span></div>
      <div class="total-row discount"><span>Retainer applied (10%)</span><span>−$4,008.00</span></div>
      <div class="total-row tax"><span>Sales tax · NY (9%)</span><span>$3,246.48</span></div>
      <div class="total-row subtotal"><span>Net before tax</span><span>$36,072.00</span></div>
      <div class="total-row grand"><span>Total due</span><span>$39,318.48</span></div>
    </div>
  </div>

  <div class="pay">
    <div>
      <h4>Wire / ACH (USD)</h4>
      <div class="row"><span>Bank</span><span>Mercury Bank</span></div>
      <div class="row"><span>Routing (ACH)</span><span>084-001-122</span></div>
      <div class="row"><span>Routing (Wire)</span><span>026-073-150</span></div>
      <div class="row"><span>Account</span><span>9847-2210-3318</span></div>
      <div class="row"><span>Memo</span><span>INV-2025-0142</span></div>
    </div>
    <div>
      <h4>Online payment</h4>
      <div class="row"><span>Pay link</span><span>sable.studio/p/inv-0142</span></div>
      <div class="row"><span>Stripe / card / ACH</span><span>Yes</span></div>
      <div class="row"><span>Wise / SEPA / FX</span><span>On request</span></div>
      <div class="row"><span>Receipt</span><span>Auto-emailed</span></div>
    </div>
  </div>

  <div class="signoff">
    <p>Thank you, Northwind. It's been a privilege to work on this rebrand.</p>
    <div class="signature">
      <div class="scribble">Lila Vega</div>
      <div class="name">Lila Vega · Founder, Sable Studio</div>
    </div>
  </div>
</div>
</body>
</html>

\`\`\``},{name:`kanban-board`,description:`Kanban / task board with columns (To do / In progress / In review / Done), draggable-looking cards, assignee avatars, swimlanes, and a top filter bar. Use when the brief mentions "kanban", "task board", "sprint board", "trello", "看板".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/kanban-board`,body:`# Kanban Board Skill

Produce a single-screen kanban board.

## Workflow

1. Read the active DESIGN.md.
2. Identify squad name, sprint number, columns, and member roster from the brief.
3. Layout:
   - Top bar: project crumb, sprint chip, filter row (members, labels, status), search.
   - 4 columns: Backlog, In progress, In review, Done. Each column has a count chip and an "+ add" affordance.
   - 3–6 cards per column. Each card: tag chip, title, assignee avatar, point estimate, progress (if applicable).
   - Sidebar (collapsible feel): "Sprint pulse" with progress bar, top assignees, blocked-tickets callout.
4. One inline \`<style>\`, semantic HTML.

## Output contract

\`\`\`
<artifact identifier="kanban-board" type="text/html" title="Sprint Board">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Growth Squad · Sprint 38 Board</title>
<style>
  :root {
    --bg: #f7f7f9;
    --paper: #ffffff;
    --ink: #1a1d29;
    --muted: #5e6478;
    --line: #e5e7ee;
    --line-strong: #c8cdd9;
    --accent: #5b3df0;
    --accent-soft: #ece8ff;
    --pink: #d6336c;
    --teal: #1a8e8e;
    --amber: #b58522;
    --green: #2c8a4f;
    --display: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 13.5px; line-height: 1.5; }
  .app { display: grid; grid-template-columns: 1fr 280px; min-height: 100vh; }
  main { padding: 18px 22px 32px; min-width: 0; }
  aside.sidebar { padding: 22px 24px; border-left: 1px solid var(--line); background: var(--paper); }

  /* Topbar */
  .topbar { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; }
  .crumb { font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .sprint-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; font-size: 11.5px; }
  .sprint-chip .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; }
  .topbar-spacer { flex: 1; }
  .topbar input.search { padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; max-width: 220px; background: var(--paper); }
  .icon-btn { padding: 6px 10px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; cursor: pointer; color: var(--muted); }

  .filterbar { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; }
  .filter-label { font-family: var(--mono); font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-right: 6px; }
  .chip-row { display: flex; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 12px; color: var(--muted); cursor: pointer; }
  .chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .chip .av { width: 14px; height: 14px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), #a991ff); display: inline-block; }
  .filterbar .spacer { flex: 1; }
  .members { display: flex; }
  .members .av { width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--paper); margin-left: -8px; font-size: 10.5px; font-weight: 700; color: white; display: inline-flex; align-items: center; justify-content: center; }
  .members .av:first-child { margin-left: 0; }

  /* Board */
  .board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-items: flex-start; }
  .col { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 12px; min-height: 460px; display: flex; flex-direction: column; gap: 10px; }
  .col-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 4px 8px; border-bottom: 1px dashed var(--line); }
  .col-name { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .col-name .swatch { width: 8px; height: 8px; border-radius: 50%; }
  .swatch.gray { background: var(--line-strong); }
  .swatch.violet { background: var(--accent); }
  .swatch.amber { background: var(--amber); }
  .swatch.green { background: var(--green); }
  .col-count { font-family: var(--mono); font-size: 10.5px; color: var(--muted); padding: 2px 6px; background: var(--bg); border-radius: 999px; }

  /* Cards */
  .card { padding: 12px 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column; gap: 10px; cursor: grab; transition: border-color 0.15s, box-shadow 0.15s; }
  .card:hover { border-color: var(--accent); box-shadow: 0 4px 12px rgba(91,61,240,0.06); }
  .card-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .tag-bug { background: rgba(214,51,108,0.12); color: var(--pink); }
  .tag-feat { background: rgba(91,61,240,0.12); color: var(--accent); }
  .tag-design { background: rgba(26,142,142,0.12); color: var(--teal); }
  .tag-chore { background: rgba(94,100,120,0.12); color: var(--muted); }
  .tag-research { background: rgba(181,133,34,0.12); color: var(--amber); }
  .card-title { font-size: 13.5px; font-weight: 500; line-height: 1.4; }
  .card-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--muted); }
  .card-meta .left { display: flex; gap: 8px; align-items: center; }
  .av-sm { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), #a991ff); color: white; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .av-mira { background: linear-gradient(135deg, #d6336c, #ff7a9b); }
  .av-cale { background: linear-gradient(135deg, #1a8e8e, #56c1c1); }
  .av-pri { background: linear-gradient(135deg, #b58522, #f1b13a); }
  .av-dev { background: linear-gradient(135deg, #2c8a4f, #66c285); }
  .pts { font-family: var(--mono); padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; font-size: 10.5px; color: var(--muted); }
  .progress { height: 4px; background: var(--bg); border-radius: 999px; overflow: hidden; }
  .progress > span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
  .add-card { padding: 10px; border: 1px dashed var(--line-strong); border-radius: 8px; text-align: center; color: var(--muted); font-size: 12px; cursor: pointer; }
  .add-card:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

  /* Sidebar */
  aside h4 { font-family: var(--display); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  .pulse { display: flex; flex-direction: column; gap: 14px; }
  .pulse-stat { display: flex; justify-content: space-between; font-size: 13px; }
  .pulse-stat strong { font-family: var(--mono); }
  .pulse-bar { height: 6px; background: var(--bg); border-radius: 999px; overflow: hidden; }
  .pulse-bar > span { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #a991ff); border-radius: 999px; }
  .top-list { display: flex; flex-direction: column; gap: 10px; }
  .top-row { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; font-size: 12.5px; }
  .pill-block { padding: 16px; border-radius: 10px; background: rgba(214,51,108,0.07); border: 1px solid rgba(214,51,108,0.2); }
  .pill-block strong { color: var(--pink); }

  @media (max-width: 1180px) {
    .app { grid-template-columns: 1fr; }
    aside.sidebar { border-left: none; border-top: 1px solid var(--line); }
    .board { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 720px) { .board { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="app">
  <main>
    <div class="topbar">
      <span class="crumb">Northwind / Growth squad</span>
      <span class="sprint-chip"><span class="dot"></span>Sprint 38 · Day 6 of 10</span>
      <div class="topbar-spacer"></div>
      <input class="search" placeholder="Search tickets…" />
      <button class="icon-btn">⌘ Filter</button>
      <button class="icon-btn">+ New</button>
    </div>

    <div class="filterbar">
      <span class="filter-label">Members</span>
      <div class="members">
        <span class="av av-mira">MR</span>
        <span class="av av-cale">CA</span>
        <span class="av av-pri">PB</span>
        <span class="av av-dev">DP</span>
        <span class="av" style="background: #c8cdd9; color: #5e6478;">+1</span>
      </div>
      <span class="filter-label" style="margin-left: 18px;">Labels</span>
      <div class="chip-row">
        <span class="chip active">Active sprint</span>
        <span class="chip">Bug</span>
        <span class="chip">Feature</span>
        <span class="chip">Research</span>
      </div>
      <div class="spacer"></div>
      <span class="chip">Group · Status</span>
      <span class="chip">Sort · Priority</span>
    </div>

    <div class="board">
      <div class="col">
        <div class="col-head"><div class="col-name"><span class="swatch gray"></span>Backlog</div><span class="col-count">5</span></div>
        <div class="card">
          <span class="card-tag tag-feat">Feature</span>
          <div class="card-title">Add empty-state illustration to onboarding step 2</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-dev">DP</span><span class="pts">3 pts</span></div><span>NW-241</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-design">Design</span>
          <div class="card-title">Refresh notification settings page tokens</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-mira">MR</span><span class="pts">2 pts</span></div><span>NW-237</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-research">Research</span>
          <div class="card-title">Interview 5 new Enterprise admins about 2FA enforcement</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-pri">PB</span><span class="pts">5 pts</span></div><span>NW-225</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-chore">Chore</span>
          <div class="card-title">Migrate legacy auth logs to new schema</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-cale">CA</span><span class="pts">3 pts</span></div><span>NW-219</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-bug">Bug</span>
          <div class="card-title">CSV export drops emoji from project names</div>
          <div class="card-meta"><div class="left"><span class="av-sm">+</span><span class="pts">1 pt</span></div><span>NW-244</span></div>
        </div>
        <div class="add-card">+ New card</div>
      </div>

      <div class="col">
        <div class="col-head"><div class="col-name"><span class="swatch violet"></span>In progress</div><span class="col-count">4</span></div>
        <div class="card">
          <span class="card-tag tag-feat">Feature</span>
          <div class="card-title">TOTP enrollment UI in member settings</div>
          <div class="progress"><span style="width: 70%"></span></div>
          <div class="card-meta"><div class="left"><span class="av-sm av-dev">DP</span><span class="pts">5 pts</span></div><span>NW-201</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-feat">Feature</span>
          <div class="card-title">Recovery codes — generate, download, regenerate</div>
          <div class="progress"><span style="width: 45%"></span></div>
          <div class="card-meta"><div class="left"><span class="av-sm av-pri">PB</span><span class="pts">3 pts</span></div><span>NW-202</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-bug">Bug</span>
          <div class="card-title">Fix focus-trap regression in command bar</div>
          <div class="progress"><span style="width: 80%"></span></div>
          <div class="card-meta"><div class="left"><span class="av-sm av-cale">CA</span><span class="pts">2 pts</span></div><span>NW-238</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-design">Design</span>
          <div class="card-title">2FA challenge step — visual + microcopy</div>
          <div class="progress"><span style="width: 30%"></span></div>
          <div class="card-meta"><div class="left"><span class="av-sm av-mira">MR</span><span class="pts">3 pts</span></div><span>NW-205</span></div>
        </div>
      </div>

      <div class="col">
        <div class="col-head"><div class="col-name"><span class="swatch amber"></span>In review</div><span class="col-count">3</span></div>
        <div class="card">
          <span class="card-tag tag-feat">Feature</span>
          <div class="card-title">Audit-log entries for 2FA setup events</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-pri">PB</span><span class="pts">2 pts</span></div><span>NW-198</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-design">Design</span>
          <div class="card-title">Settings nav restructure (left rail)</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-mira">MR</span><span class="pts">3 pts</span></div><span>NW-189</span></div>
        </div>
        <div class="card">
          <span class="card-tag tag-bug">Bug</span>
          <div class="card-title">Workspace switcher resets scroll on close</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-cale">CA</span><span class="pts">1 pt</span></div><span>NW-233</span></div>
        </div>
      </div>

      <div class="col">
        <div class="col-head"><div class="col-name"><span class="swatch green"></span>Done</div><span class="col-count">6</span></div>
        <div class="card" style="opacity: 0.85;">
          <span class="card-tag tag-feat">Feature</span>
          <div class="card-title">Workspace 2FA enforcement policy (admin)</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-dev">DP</span><span class="pts">5 pts</span></div><span>NW-181</span></div>
        </div>
        <div class="card" style="opacity: 0.85;">
          <span class="card-tag tag-chore">Chore</span>
          <div class="card-title">Bump auth library to 4.2.0</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-cale">CA</span><span class="pts">1 pt</span></div><span>NW-176</span></div>
        </div>
        <div class="card" style="opacity: 0.85;">
          <span class="card-tag tag-research">Research</span>
          <div class="card-title">2FA usability sessions (n=8)</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-pri">PB</span><span class="pts">3 pts</span></div><span>NW-172</span></div>
        </div>
        <div class="card" style="opacity: 0.85;">
          <span class="card-tag tag-design">Design</span>
          <div class="card-title">Settings tokens audit</div>
          <div class="card-meta"><div class="left"><span class="av-sm av-mira">MR</span><span class="pts">2 pts</span></div><span>NW-168</span></div>
        </div>
      </div>
    </div>
  </main>

  <aside class="sidebar">
    <div class="pulse">
      <div>
        <h4>Sprint pulse</h4>
        <div class="pulse-stat"><span>Completed</span><strong>22 of 38 pts</strong></div>
        <div class="pulse-bar" style="margin-top: 6px;"><span style="width: 58%"></span></div>
      </div>
      <div>
        <h4>Top contributors</h4>
        <div class="top-list">
          <div class="top-row"><span class="av-sm av-dev">DP</span><span>Devon Park</span><strong>9 pts</strong></div>
          <div class="top-row"><span class="av-sm av-mira">MR</span><span>Mira Reddy</span><strong>5 pts</strong></div>
          <div class="top-row"><span class="av-sm av-pri">PB</span><span>Priya Banerjee</span><strong>5 pts</strong></div>
          <div class="top-row"><span class="av-sm av-cale">CA</span><span>Caleb Renner</span><strong>3 pts</strong></div>
        </div>
      </div>
      <div>
        <h4>Blocked</h4>
        <div class="pill-block">
          <strong>1 ticket needs unblock.</strong>
          <p style="margin: 6px 0 0; color: var(--muted); font-size: 12.5px;">NW-205 (2FA challenge design) is waiting on a copy review from Brand. Mention @Sasha or move it back to backlog.</p>
        </div>
      </div>
    </div>
  </aside>
</div>
</body>
</html>

\`\`\``},{name:`magazine-poster`,description:`An editorial-style poster — newsprint paper, dateline, oversized serif headline with a struck-through word and italic accent, a 2-column body block, and 6 numbered sections with annotated pull-quote captions. Reads like a Sunday-paper full-page essay or a thoughtful launch poster. Use when the brief asks for "magazine poster", "editorial poster", "newsprint", "essay layout", or "manifesto".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/magazine-poster`,body:`# Magazine Poster Skill

Produce a single-page editorial poster — looks like a tear-out from a
Sunday paper. Long-form, deliberate, type-driven.

## Workflow

1. **Read the active DESIGN.md** (injected above). Pick the heaviest serif
   token in the DS for the headline, the body serif for the columns, and
   a typewriter / mono token for the section eyebrows and annotations.
2. **Pick the topic** from the brief. Write a real, opinionated headline —
   one with a struck-through word ("a designer", "the template hunt") and
   an italic accent on a key noun ("first draft", "mood", "specifics").
3. **Layout**, in order:
   - **Top rule** — thin black hairline + a dateline ("01 · A · YOUR LAB"
     left, "DD · MMM · YYYY" right). Light typewriter font.
   - **Top eyebrow** — a single mono tag like "POSTED TODAY".
   - **Headline** — 2–3 lines, oversized serif. One word struck through
     with \`text-decoration: line-through; text-decoration-thickness: 2px\`.
     One word italic, in accent color.
   - **Deck** — a 1–2 sentence subhead in italic serif at ~60% size of
     the headline, with a dash separator and a \`— what works\` callout
     fragment in accent.
   - **Accent rule** — short horizontal accent-colored bar (~80px).
   - **Body grid** — six numbered cells in a 2×3 (or 3×2) grid. Each cell:
     - eyebrow (\`01 · SHIP FAST\`) in mono, accent color.
     - bold serif sub-headline.
     - 2–3 sentence body in body serif.
     - one annotated callout — a quoted "use this prompt" line on a tinted
       background block, set in mono.
   - **Footer band** — rule above, three cells: handle / role / date, with a
     small "PRO TIP" plate on the left containing one closing line.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Background uses a creamy paper tint (\`#f3eee2\` or DS canvas) plus a
     subtle paper noise (\`radial-gradient\` dots at low opacity).
   - 2-column body grid via CSS Grid; min-width 1100px page.
   - \`data-od-id\` on header, headline, deck, each cell, footer.
5. **Self-check**:
   - Type hierarchy is unmistakable — headline owns the page.
   - Strikethrough + italic accent both appear, exactly once each.
   - Body reads like real opinion, not lorem ipsum.
   - Looks intentional at 1280–1440px wide.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="poster-slug" type="text/html" title="Poster Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>You don't need a designer to ship your first draft anymore — AI Enthusiast</title>
  <style>
    :root {
      --paper: #f3eee2;
      --ink: #1f1c17;
      --muted: #6e6a5d;
      --rule: #d3cdbe;
      --accent: #b85a3a;
      --tint: #ece5d3;
      --serif-display: 'Playfair Display', 'Iowan Old Style', Georgia, serif;
      --serif-body: 'Iowan Old Style', 'Charter', Georgia, serif;
      --mono: 'IBM Plex Mono', ui-monospace, 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; color: var(--ink);
      background:
        radial-gradient(circle, rgba(31,28,23,0.05) 1px, transparent 1.4px) 0 0 / 16px 16px,
        var(--paper);
      font: 14px/1.55 var(--serif-body);
    }
    .page {
      max-width: 1180px;
      margin: 0 auto;
      padding: 36px 56px 48px;
    }

    .top-rule {
      display: flex; justify-content: space-between; align-items: center;
      font: 10.5px/1.4 var(--mono);
      color: var(--muted);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--ink);
    }
    .eyebrow-row {
      padding: 14px 0 28px;
      font: 10.5px/1.4 var(--mono);
      color: var(--muted);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    h1.headline {
      font-family: var(--serif-display);
      font-weight: 800;
      font-size: clamp(56px, 7vw, 96px);
      line-height: 0.98;
      letter-spacing: -0.012em;
      margin: 0 0 16px;
      max-width: 18ch;
    }
    h1.headline .strike { text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--ink); color: var(--ink); }
    h1.headline .accent { font-style: italic; color: var(--accent); font-weight: 700; }

    .deck {
      max-width: 78ch;
      font: italic 18px/1.45 var(--serif-body);
      color: var(--ink);
      margin: 0 0 22px;
    }
    .deck b { font-style: normal; color: var(--accent); font-weight: 600; padding: 0 4px; background: var(--tint); border-radius: 2px; }

    .accent-rule { width: 80px; height: 3px; background: var(--accent); margin: 6px 0 32px; }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px 56px;
      padding-top: 4px;
      border-top: 1px solid var(--rule);
    }
    .cell { padding: 28px 0 4px; border-bottom: 1px solid var(--rule); }
    .cell:nth-last-child(-n+2) { border-bottom: none; }
    .cell .num {
      font: 10.5px/1.4 var(--mono);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 6px;
      display: flex; align-items: center; gap: 10px;
    }
    .cell .num span.bar { display: inline-block; width: 20px; height: 1px; background: var(--accent); opacity: 0.6; }
    .cell h3 {
      font: 700 22px/1.2 var(--serif-display);
      letter-spacing: -0.005em;
      margin: 0 0 10px;
    }
    .cell p { margin: 0 0 14px; font-size: 15px; line-height: 1.55; max-width: 46ch; color: var(--ink); }
    .cell .quote {
      background: var(--tint);
      border-left: 2px solid var(--accent);
      padding: 10px 12px;
      font: 12px/1.55 var(--mono);
      color: var(--ink);
      max-width: 50ch;
    }
    .cell .quote::before { content: '"'; }
    .cell .quote::after { content: '"'; }

    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid var(--ink);
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 24px;
      align-items: center;
      font: 10.5px/1.4 var(--mono);
      color: var(--muted);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .pro-tip {
      display: flex; gap: 12px; align-items: center;
      padding: 10px 14px;
      border: 1px solid var(--rule);
      background: var(--paper);
      max-width: 78%;
    }
    .pro-tip .badge { font: 9.5px/1 var(--mono); letter-spacing: 0.2em; padding: 6px 8px; border: 1px solid var(--ink); color: var(--ink); }
    .pro-tip .text { font: italic 13px/1.4 var(--serif-body); color: var(--ink); text-transform: none; letter-spacing: 0; }
    .pro-tip .text b { color: var(--accent); font-style: normal; font-weight: 600; }

    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .cell { border-bottom: 1px solid var(--rule); }
      .cell:last-child { border-bottom: none; }
      .page { padding: 24px 24px 32px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top-rule" data-od-id="top-rule">
      <span>01 · AI ENTHUSIAST</span>
      <span>17 · APR · 2026</span>
    </div>
    <div class="eyebrow-row" data-od-id="eyebrow">— POSTED TODAY</div>

    <h1 class="headline" data-od-id="headline">
      You don't need <span class="strike">a designer</span><br />
      to ship your <span class="accent">first draft</span><br />
      anymore.
    </h1>

    <p class="deck" data-od-id="deck">
      Six honest ways I'm using AI to move faster from idea → artifact this week — <b>what works</b>, what I'd still hand to a human, and the exact prompts that got me there.
    </p>
    <div class="accent-rule"></div>

    <div class="grid" data-od-id="grid">
      <section class="cell" data-od-id="cell-1">
        <div class="num"><span class="bar"></span>01 · SHIP FAST</div>
        <h3>Clickable prototype in 90 seconds</h3>
        <p>Describe the flow in plain English. Get a real, tappable prototype — not static screens. Export to HTML and share the link.</p>
        <div class="quote">Onboarding flow for a fintech app — 5 screens, dark mode, rounded cards, haptic-style transitions.</div>
      </section>
      <section class="cell" data-od-id="cell-2">
        <div class="num"><span class="bar"></span>02 · PITCH</div>
        <h3>Investor deck from a napkin idea</h3>
        <p>Skip the template hunt. Draft the deck, refine it section-by-section, then export straight to PPTX or PDF — notes included.</p>
        <div class="quote">10-slide seed pitch for a RAG tool for lawyers. Keep it minimal, data-first, one chart per slide.</div>
      </section>
      <section class="cell" data-od-id="cell-3">
        <div class="num"><span class="bar"></span>03 · BRAND LOCK</div>
        <h3>Your design system, auto-applied</h3>
        <p>Point the model at your tokens, components, or a codebase. Every new asset respects your type, color, and spacing scale.</p>
        <div class="quote">Use our /design-system tokens. Build a pricing page variant. Match the radius + shadow of the marketing site.</div>
      </section>
      <section class="cell" data-od-id="cell-4">
        <div class="num"><span class="bar"></span>04 · MARKETING</div>
        <h3>Landing pages &amp; launch collateral</h3>
        <p>One-pagers, email headers, feature comparison grids — editable, on-brand, and ready to hand off in minutes, not days.</p>
        <div class="quote">One-pager for a Series A launch. Headline, three proof points, CTA. Editorial feel, no stock photos.</div>
      </section>
      <section class="cell" data-od-id="cell-5">
        <div class="num"><span class="bar"></span>05 · HANDOFF</div>
        <h3>Design → engineering bundle</h3>
        <p>Finished the mock? Ship the whole handoff to your dev environment. Specs, tokens, components — no translation layer.</p>
        <div class="quote">Export this mock to code. Wire the auth screen to Supabase. Add a loading state and empty state.</div>
      </section>
      <section class="cell" data-od-id="cell-6">
        <div class="num"><span class="bar"></span>06 · EXPLORE</div>
        <h3>Ten directions in ten minutes</h3>
        <p>Generate N visual directions side-by-side. Use sliders to dial tone: playful, brutalist, editorial, corporate — same copy.</p>
        <div class="quote">Show six hero section variants. Same copy, different aesthetics. Label each with a mood word.</div>
      </section>
    </div>

    <div class="footer" data-od-id="footer">
      <div class="pro-tip">
        <span class="badge">PRO TIP</span>
        <span class="text">Don't prompt for <b>"a good design."</b> Prompt for a mood — <b>"serene", "brutalist", "Bloomberg terminal," "Sunday newspaper."</b> Aesthetic specificity is the unlock.</span>
      </div>
      <div></div>
      <div>SAVE · REPOST · TRY ONE THIS WEEKEND</div>
    </div>
  </div>
</body>
</html>

\`\`\``},{name:`meeting-notes`,description:`Meeting notes page — title bar with attendees, agenda checklist, decisions block, action items table with owners + dates, and a "next meeting" footer. Use when the brief mentions "meeting notes", "minutes", "1:1 notes", "all-hands recap", or "会议纪要".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/meeting-notes`,body:`# Meeting Notes Skill

Produce a single-screen meeting notes page.

## Workflow

1. Read DESIGN.md.
2. Layout:
   - Header: meeting title, date, time, location/Zoom, attendees row.
   - Agenda checklist (4–6 items).
   - Decisions panel — bulleted list with strong styling.
   - Action items table with owner, due date, status.
   - "Open questions" + "next meeting" footer.
3. Subdued colour palette, clear hierarchy.

## Output contract

\`\`\`
<artifact identifier="notes-name" type="text/html" title="Meeting Notes">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Growth squad weekly · 14 Oct notes</title>
<style>
  :root {
    --bg: #fafaf8;
    --paper: #ffffff;
    --ink: #1a1d24;
    --muted: #5d6371;
    --line: #e8e9ed;
    --accent: #2c5fae;
    --accent-soft: #e8efff;
    --positive: #2c8a4f;
    --warn: #b58522;
    --danger: #b13b3b;
    --display: 'Charter', Georgia, serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14.5px; line-height: 1.6; }
  .page { max-width: 920px; margin: 24px auto; padding: 48px 56px 64px; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; }

  header.head { border-bottom: 1px solid var(--line); padding-bottom: 22px; margin-bottom: 28px; }
  .crumb { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  h1 { font-family: var(--display); font-size: 32px; margin: 6px 0 14px; letter-spacing: -0.005em; font-weight: 700; }
  .meta-row { display: flex; gap: 28px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .meta-row strong { color: var(--ink); display: block; font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; font-weight: 500; }

  .attendees { display: flex; align-items: center; gap: 14px; margin-top: 18px; padding: 14px 16px; background: var(--bg); border-radius: 8px; }
  .attendees-label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .av-row { display: flex; }
  .av { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--paper); margin-left: -8px; font-size: 11px; font-weight: 700; color: white; display: inline-flex; align-items: center; justify-content: center; }
  .av:first-child { margin-left: 0; }
  .a-dp { background: linear-gradient(135deg, #2c5fae, #6e9bf0); }
  .a-mr { background: linear-gradient(135deg, #d6336c, #ff7a9b); }
  .a-pb { background: linear-gradient(135deg, #b58522, #f1b13a); }
  .a-ca { background: linear-gradient(135deg, #1a8e8e, #56c1c1); }
  .a-sl { background: linear-gradient(135deg, #5b3df0, #a991ff); }
  .away { color: var(--muted); font-size: 12.5px; }

  section { margin-top: 36px; }
  h2 { font-family: var(--display); font-size: 21px; margin: 0 0 14px; letter-spacing: -0.005em; }

  /* Agenda */
  .agenda { display: flex; flex-direction: column; gap: 8px; }
  .agenda-item { display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px; border-radius: 6px; background: var(--bg); }
  .agenda-item .check { flex: 0 0 18px; width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--ink); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: transparent; margin-top: 2px; }
  .agenda-item.done .check { background: var(--positive); border-color: var(--positive); color: white; }
  .agenda-item .body { flex: 1; }
  .agenda-item .body strong { font-weight: 600; }
  .agenda-item .body small { color: var(--muted); display: block; margin-top: 2px; font-size: 12.5px; }
  .agenda-item .time { font-family: var(--mono); font-size: 11px; color: var(--muted); padding-top: 3px; }

  /* Decisions */
  .decisions { padding: 22px 24px; background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: 6px; }
  .decisions h3 { font-family: var(--display); font-size: 15px; margin: 0 0 12px; color: var(--accent); }
  .decisions ul { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
  .decisions li::marker { color: var(--accent); }

  /* Action items */
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  th { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; }
  tr:last-child td { border-bottom: none; }
  td.owner { display: flex; align-items: center; gap: 8px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-family: var(--mono); font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .pill-todo { background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
  .pill-progress { background: rgba(44,95,174,0.12); color: var(--accent); }
  .pill-blocked { background: rgba(177,59,59,0.12); color: var(--danger); }
  .pill-done { background: rgba(44,138,79,0.12); color: var(--positive); }

  /* Open + next */
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .panel { padding: 20px 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .panel h3 { font-family: var(--display); font-size: 16px; margin: 0 0 8px; }
  .panel p { color: var(--muted); margin: 0; font-size: 13.5px; line-height: 1.55; }
  .next-meeting { display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; margin-top: 10px; }
  .next-meeting strong { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); display: block; font-weight: 500; }

  footer { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11.5px; color: var(--muted); }

  @media (max-width: 700px) {
    .page { padding: 28px 24px; margin: 0; border-radius: 0; }
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="head">
    <div class="crumb">Northwind / Growth squad / Weeklies</div>
    <h1>Growth squad weekly · W42</h1>
    <div class="meta-row">
      <span><strong>Date</strong>Tuesday, 14 October 2025</span>
      <span><strong>Time</strong>10:00 – 11:00 PT</span>
      <span><strong>Where</strong>Zoom · meet.northwind/growth-weekly</span>
      <span><strong>Notes by</strong>Devon Park</span>
    </div>
    <div class="attendees">
      <span class="attendees-label">Present</span>
      <div class="av-row">
        <span class="av a-dp" title="Devon Park">DP</span>
        <span class="av a-mr" title="Mira Reddy">MR</span>
        <span class="av a-pb" title="Priya Banerjee">PB</span>
        <span class="av a-ca" title="Caleb Renner">CA</span>
        <span class="av a-sl" title="Sasha Lin">SL</span>
      </div>
      <span class="away">Apologies — Alvaro M. (PTO)</span>
    </div>
  </header>

  <section>
    <h2>Agenda</h2>
    <div class="agenda">
      <div class="agenda-item done">
        <div class="check">✓</div>
        <div class="body"><strong>Sprint 38 mid-sprint check</strong><small>Walk the board column by column. Reset what's stuck.</small></div>
        <div class="time">10:00 · 15m</div>
      </div>
      <div class="agenda-item done">
        <div class="check">✓</div>
        <div class="body"><strong>2FA workstream — M2 risk</strong><small>Brand microcopy review is the open dependency.</small></div>
        <div class="time">10:15 · 10m</div>
      </div>
      <div class="agenda-item done">
        <div class="check">✓</div>
        <div class="body"><strong>Onboarding metrics review</strong><small>Activation up 9 pp WoW; debrief the empty-state work.</small></div>
        <div class="time">10:25 · 10m</div>
      </div>
      <div class="agenda-item done">
        <div class="check">✓</div>
        <div class="body"><strong>Pioneer security review prep</strong><small>Sales loop-in for Thursday's call.</small></div>
        <div class="time">10:35 · 10m</div>
      </div>
      <div class="agenda-item done">
        <div class="check">✓</div>
        <div class="body"><strong>Q4 roadmap sneak peek</strong><small>Devon shares the proposed shape; we vote on top-3 themes.</small></div>
        <div class="time">10:45 · 12m</div>
      </div>
      <div class="agenda-item">
        <div class="check"></div>
        <div class="body"><strong>Open thread — anything else</strong><small>Pushed to async — see #growth-squad.</small></div>
        <div class="time">10:57 · 3m</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Decisions</h2>
    <div class="decisions">
      <h3>What we agreed to, on the record</h3>
      <ul>
        <li><strong>M2 (2FA challenge step)</strong> stays at Nov 18 unless brand review slips past Wednesday EOD; Devon owns the escalation.</li>
        <li><strong>Empty-state experiment</strong> rolls to 100% on Thursday after one more 24h hold; no follow-up control needed.</li>
        <li><strong>Q4 themes</strong>: (1) Enterprise-readiness (auth + audit), (2) Onboarding 2.0, (3) Mobile-first settings. Sasha to write up the one-pagers.</li>
        <li><strong>Weekly format</strong>: starting next week, demos move to Friday async-video; Tuesday is decisions + board only.</li>
      </ul>
    </div>
  </section>

  <section>
    <h2>Action items</h2>
    <table>
      <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
      <tbody>
        <tr>
          <td>Escalate brand microcopy review to Sasha + Brand lead</td>
          <td class="owner"><span class="av a-dp">DP</span>Devon</td>
          <td>Wed Oct 15</td>
          <td><span class="pill pill-progress">In progress</span></td>
        </tr>
        <tr>
          <td>Roll empty-state to 100% (with monitoring window)</td>
          <td class="owner"><span class="av a-mr">MR</span>Mira</td>
          <td>Thu Oct 16</td>
          <td><span class="pill pill-todo">To do</span></td>
        </tr>
        <tr>
          <td>Pair with Sales on Pioneer call prep</td>
          <td class="owner"><span class="av a-pb">PB</span>Priya</td>
          <td>Thu Oct 16</td>
          <td><span class="pill pill-todo">To do</span></td>
        </tr>
        <tr>
          <td>Draft Q4 theme one-pagers (3)</td>
          <td class="owner"><span class="av a-sl">SL</span>Sasha</td>
          <td>Mon Oct 20</td>
          <td><span class="pill pill-todo">To do</span></td>
        </tr>
        <tr>
          <td>Audit-writer backlog dashboard</td>
          <td class="owner"><span class="av a-ca">CA</span>Caleb</td>
          <td>Tue Oct 21</td>
          <td><span class="pill pill-blocked">Blocked · awaiting Grafana ACL</span></td>
        </tr>
        <tr>
          <td>Switch weekly format to demos-on-Friday</td>
          <td class="owner"><span class="av a-dp">DP</span>Devon</td>
          <td>Mon Oct 20</td>
          <td><span class="pill pill-done">Done</span></td>
        </tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>Open questions &amp; next meeting</h2>
    <div class="grid">
      <div class="panel">
        <h3>Open questions</h3>
        <p>Do we want a customer in the Q4 mobile-first kickoff (Pioneer would say yes), or do we keep the first session internal?</p>
        <p style="margin-top: 8px;">Should the Friday demo video be capped at 5 min, or open-ended?</p>
      </div>
      <div class="panel">
        <h3>Next meeting</h3>
        <div class="next-meeting"><strong>Date</strong>Tuesday, 21 October 2025</div>
        <div class="next-meeting"><strong>Time</strong>10:00 – 11:00 PT · Zoom</div>
        <div class="next-meeting"><strong>Pre-read</strong>Sasha's Q4 one-pagers (Mon EOD)</div>
        <div class="next-meeting"><strong>Notes by</strong>Mira Reddy (rotation)</div>
      </div>
    </div>
  </section>

  <footer>
    <span>Northwind Growth squad · Notes v1</span>
    <span>Filed in #growth-squad · 15 Oct 2025</span>
  </footer>
</div>
</body>
</html>

\`\`\``},{name:`motion-frames`,description:`A single-frame motion-design composition with looping CSS animations — rotating type ring, animated globe, ticking timer, parallax labels. Renders as a hero video poster you can hand straight to HyperFrames or any keyframe-based exporter. Use when the brief asks for "motion design", "animated hero", "loop", "video poster", "title card", or pairs Open Claude Design with HyperFrames for a kinetic export.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/motion-frames`,body:`# Motion Frames Skill

Produce a single full-bleed motion composition. Inline CSS animations only —
the page is the loop. Treat it as a poster frame that an exporter (HyperFrames,
Lottie, etc.) can capture into a video.

## Workflow

1. **Read the active DESIGN.md** (injected above). Motion lives or dies on
   typography contrast — pick the most expressive serif / display token in
   the DS for the headline; the body / mono token labels everything else.
2. **Compose** the canvas as a 16:9 hero with these layers, back to front:
   - **Stage** — full-bleed \`<main>\`. Off-white or DS-canvas background, very
     subtle dotted grid texture (CSS background, \`radial-gradient\` dots at
     22–32px intervals).
   - **Concentric rings** — 2–3 SVG circles radiating from a focal point.
     Ultra-thin strokes (0.5–1px) in DS-foreground at low opacity. These
     rotate at different speeds (60s, 90s, 180s).
   - **Focal mark** — a wireframe globe, a stylized object, or a typographic
     monogram drawn as inline SVG. ~28% of the canvas wide.
   - **Ring labels** — short words / phonetic tokens placed around one of
     the rings (e.g. "Hola · Bonjour · 你好 · नमस्ते"). They co-rotate with
     the ring, with \`<text>\` paths counter-rotated so the words stay upright.
   - **Headline** — bottom-left or center-bottom. Display serif, italic
     accent on one word. Add a subtle \`letterSpacing\` + opacity reveal
     animation (\`@keyframes type-in\`).
   - **Frame chrome** — corner stamps (top-left lab tag, top-right brand or
     issue number) and a thin baseline rule. Static.
3. **Animate** with \`@keyframes\` only — no JS:
   - \`rotate-slow\`, \`rotate-med\`, \`rotate-fast\` for rings.
   - \`globe-spin\` for the focal mark.
   - \`pulse\` for the focal dot, ~2s, easing.
   - \`marquee-fade\` to reveal headline once on load.
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - All motion uses CSS — no scripts, so HyperFrames or any frame-grabber
     can capture it deterministically.
   - \`data-od-id\` on stage, focal, ring, headline, chrome.
5. **Self-check**:
   - The composition still reads as a poster with motion paused at frame 0.
   - At least 3 layers move at different speeds (depth comes from delta
     velocity, not parallax tricks).
   - Accent appears once — usually the italic word in the headline.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="motion-slug" type="text/html" title="Motion — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reach every country — Charlotte &amp; Vine</title>
  <style>
    :root {
      --paper: #f3eee5;
      --ink: #1a1816;
      --muted: #7a766c;
      --accent: #c0563b;
      --serif: 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif;
      --mono: ui-monospace, 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body { background: var(--paper); color: var(--ink); font: 14px/1.5 -apple-system, system-ui, sans-serif; overflow: hidden; }
    main {
      position: relative;
      width: 100vw;
      height: 100vh;
      background:
        radial-gradient(circle at 50% 50%, rgba(26,24,22,0.04), transparent 70%),
        radial-gradient(circle, rgba(26,24,22,0.10) 1px, transparent 1.4px) 0 0 / 28px 28px,
        var(--paper);
      overflow: hidden;
    }

    .chrome { position: absolute; left: 36px; right: 36px; font: 10px/1.4 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; }
    .chrome.top { top: 28px; display: flex; justify-content: space-between; align-items: center; }
    .chrome.top .right { display: flex; align-items: center; gap: 22px; }
    .chrome.top .rule { width: 60px; height: 1px; background: var(--ink); opacity: 0.6; }
    .chrome.bot { bottom: 28px; display: flex; justify-content: space-between; align-items: center; }

    .stage {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }
    .composition {
      position: relative;
      width: min(78vh, 78vw);
      aspect-ratio: 1 / 1;
    }

    .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 1px solid rgba(26,24,22,0.45);
      animation: spin 60s linear infinite;
    }
    .ring.r2 {
      inset: 4%;
      border-color: rgba(26,24,22,0.30);
      animation-duration: 90s;
      animation-direction: reverse;
    }
    .ring.r3 {
      inset: 10%;
      border-color: rgba(26,24,22,0.22);
      border-style: dashed;
      animation-duration: 180s;
    }
    .ring.r4 {
      inset: 18%;
      border-color: rgba(26,24,22,0.12);
      animation-duration: 36s;
    }

    .ring-labels { position: absolute; inset: 0; animation: spin 60s linear infinite; }
    .ring-labels span {
      position: absolute;
      left: 50%; top: 50%;
      font: 12px/1 var(--serif);
      font-style: italic;
      color: var(--ink);
      letter-spacing: 0.02em;
      transform-origin: 0 0;
      white-space: nowrap;
    }
    .ring-labels span.l1 { transform: rotate(-12deg) translate(0, -49vh); }
    .ring-labels span.l2 { transform: rotate(34deg) translate(0, -49vh); }
    .ring-labels span.l3 { transform: rotate(78deg) translate(0, -49vh); }
    .ring-labels span.l4 { transform: rotate(132deg) translate(0, -49vh); }
    .ring-labels span.l5 { transform: rotate(178deg) translate(0, -49vh); }
    .ring-labels span.l6 { transform: rotate(224deg) translate(0, -49vh); }
    .ring-labels span.l7 { transform: rotate(266deg) translate(0, -49vh); }
    .ring-labels span.l8 { transform: rotate(312deg) translate(0, -49vh); }
    .ring-labels span i { display: inline-block; transform: rotate(0deg); /* counter rotation handled inside */ }

    .globe {
      position: absolute;
      inset: 22%;
      border-radius: 50%;
      animation: spin 38s linear infinite reverse;
      transform-style: preserve-3d;
    }
    .globe svg { width: 100%; height: 100%; display: block; }

    .focal-dot {
      position: absolute;
      left: 50%; top: 50%;
      width: 7px; height: 7px;
      background: var(--accent);
      border-radius: 50%;
      transform: translate(-50%,-50%);
      animation: pulse 2.6s ease-in-out infinite;
      box-shadow: 0 0 0 0 rgba(192,86,59,0.35);
    }

    .meta-tl { position: absolute; top: 96px; left: 56px; font: 10px/1.5 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; }
    .meta-tl b { display: block; color: var(--ink); margin-bottom: 4px; letter-spacing: 0.12em; }
    .issue { position: absolute; top: 96px; right: 56px; font: 9px/1.3 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-align: right; text-transform: uppercase; }
    .issue .num { font: 18px/1 var(--serif); font-style: italic; color: var(--ink); display: block; letter-spacing: 0; margin-bottom: 4px; }

    .headline {
      position: absolute;
      bottom: 80px;
      left: 0; right: 0;
      text-align: center;
      font: 38px/1.1 var(--serif);
      letter-spacing: -0.005em;
      animation: type-in 1.4s cubic-bezier(.2,.7,.2,1) both;
    }
    .headline .em { font-style: italic; color: var(--ink); }
    .headline .accent { font-style: italic; color: var(--accent); padding-left: 4px; padding-right: 4px; }
    .baseline { position: absolute; bottom: 56px; left: 36px; right: 36px; height: 1px; background: rgba(26,24,22,0.25); }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(192,86,59,0.45); transform: translate(-50%,-50%) scale(1); }
      50% { box-shadow: 0 0 0 18px rgba(192,86,59,0); transform: translate(-50%,-50%) scale(1.25); }
    }
    @keyframes type-in {
      from { opacity: 0; letter-spacing: 0.06em; }
      to { opacity: 1; letter-spacing: -0.005em; }
    }
    @media (max-width: 900px) {
      .meta-tl { left: 20px; }
      .issue { right: 20px; }
      .headline { font-size: 28px; }
    }
  </style>
</head>
<body>
  <main data-od-id="stage">
    <div class="chrome top">
      <div>ANTHROPIC LABS — APR 17 · 2026</div>
      <div class="right"><div class="rule"></div><div>HOW IT WORKS</div></div>
    </div>

    <div class="meta-tl">
      <b>27 · CHARLOTTE × VINE</b>
      19 · 2026
    </div>
    <div class="issue">
      <span class="num">175</span>
      LANGUAGES HAPPENING
    </div>

    <div class="stage">
      <div class="composition" data-od-id="composition">
        <div class="ring r1"></div>
        <div class="ring r2"></div>
        <div class="ring r3"></div>
        <div class="ring r4"></div>

        <div class="globe" data-od-id="globe">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <radialGradient id="globeShade" cx="35%" cy="32%" r="78%">
                <stop offset="0%" stop-color="#fffaf0"/>
                <stop offset="60%" stop-color="#ece6da"/>
                <stop offset="100%" stop-color="#cfc8b9"/>
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="92" fill="url(#globeShade)" stroke="rgba(26,24,22,0.35)" stroke-width="0.7"/>
            <g fill="none" stroke="rgba(26,24,22,0.40)" stroke-width="0.7">
              <ellipse cx="100" cy="100" rx="92" ry="20"/>
              <ellipse cx="100" cy="100" rx="92" ry="48"/>
              <ellipse cx="100" cy="100" rx="92" ry="78"/>
              <ellipse cx="100" cy="100" rx="20" ry="92"/>
              <ellipse cx="100" cy="100" rx="48" ry="92"/>
              <ellipse cx="100" cy="100" rx="78" ry="92"/>
            </g>
            <g fill="rgba(26,24,22,0.28)" stroke="rgba(26,24,22,0.55)" stroke-width="0.6">
              <path d="M 64 70 Q 78 58 96 64 L 110 78 Q 102 92 88 96 L 70 92 Q 60 84 64 70 Z"/>
              <path d="M 116 70 Q 138 64 156 80 Q 152 96 138 100 Q 124 96 116 86 Z"/>
              <path d="M 54 110 Q 72 110 84 124 Q 80 142 64 150 Q 50 138 54 110 Z"/>
              <path d="M 102 118 Q 124 112 146 126 Q 142 144 120 152 Q 102 144 102 118 Z"/>
              <path d="M 84 36 Q 98 32 112 38 L 108 50 Q 96 56 84 50 Z"/>
              <path d="M 80 158 Q 96 156 110 162 L 104 174 Q 90 174 80 168 Z"/>
            </g>
          </svg>
        </div>

        <div class="focal-dot"></div>
      </div>
    </div>

    <div class="ring-labels" data-od-id="ring-labels" aria-hidden="true">
      <!-- positioned around the outer ring; co-rotates with .ring -->
    </div>

    <div class="headline" data-od-id="headline">
      <span class="em">Reach</span> every <span class="accent">country.</span>
    </div>
    <div class="baseline"></div>

    <div class="chrome bot">
      <div>SIGNAL · LIVE</div>
      <div>BROADCASTING / 0001</div>
    </div>
  </main>
</body>
</html>

\`\`\``},{name:`pm-spec`,description:`Product spec / PRD as a single page — problem, success metrics, scope, user stories, design notes, rollout plan, open questions. Use when the brief mentions "PRD", "spec", "product spec", "feature brief", or "需求文档".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/pm-spec`,body:`# Product Spec Skill

Produce a one-page product spec / PRD.

## Workflow

1. Read the active DESIGN.md.
2. Identify the feature + audience from the brief.
3. Layout:
   - Header strip: title, status pill (Draft / Review / Approved), date, owner.
   - Three-line summary at the top — what, who, why now.
   - "Problem" panel with one paragraph and a quote from a customer or
     internal partner.
   - "Goals & non-goals" two-column block.
   - "Success metrics" table with metric / target / measurement.
   - "User stories" list with as-a / I-want / so-that format.
   - "Scope" milestone tracker (3–4 phases).
   - "Open questions" with assignee chips.
4. One inline \`<style>\`, semantic HTML, accent used twice max.

## Output contract

\`\`\`
<artifact identifier="spec-name" type="text/html" title="Spec Title">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Spec — Two-factor authentication for Northwind</title>
<style>
  :root {
    --bg: #f5f7fa;
    --paper: #ffffff;
    --ink: #0e1322;
    --muted: #5a647a;
    --line: #e2e6ee;
    --line-strong: #c8cfdb;
    --accent: #4a36e3;
    --accent-soft: #ece8ff;
    --warn: #b8741a;
    --positive: #1f8a5a;
    --display: 'Charter', Georgia, serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14.5px; line-height: 1.6; }
  .page { max-width: 1080px; margin: 28px auto; padding: 0 32px 64px; }

  header.top { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); margin-bottom: 28px; }
  .top-left { display: flex; align-items: center; gap: 14px; }
  .crumb { font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .pill.draft { background: var(--accent-soft); color: var(--accent); }
  .pill.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .top-actions { display: flex; gap: 8px; font-size: 12.5px; color: var(--muted); }
  .top-actions span { padding: 4px 10px; border: 1px solid var(--line); border-radius: 8px; }

  h1 { font-family: var(--display); font-size: 42px; line-height: 1.06; letter-spacing: -0.015em; margin: 8px 0 8px; max-width: 22ch; font-weight: 700; }
  .summary { font-size: 17px; color: var(--muted); max-width: 64ch; margin: 0 0 28px; }
  .meta-row { display: flex; gap: 32px; margin: 14px 0 36px; padding: 16px 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; font-size: 13px; }
  .meta-row span strong { display: block; font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 4px; font-weight: 500; }

  section { margin-top: 40px; }
  h2 { font-family: var(--display); font-size: 24px; margin: 0 0 4px; letter-spacing: -0.005em; }
  h2 small { display: block; font-family: var(--body); font-size: 13px; color: var(--muted); font-weight: 400; margin-top: 4px; line-height: 1.5; letter-spacing: 0; }

  /* Problem */
  .problem { display: grid; grid-template-columns: 1.5fr 1fr; gap: 14px; margin-top: 14px; }
  .panel { padding: 22px 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .quote { padding: 22px 24px; background: var(--accent-soft); border-left: 3px solid var(--accent); border-radius: 6px; }
  .quote .body { font-family: var(--display); font-size: 17px; line-height: 1.5; }
  .quote .author { font-family: var(--mono); font-size: 11.5px; color: var(--muted); margin-top: 12px; text-transform: uppercase; letter-spacing: 0.06em; }

  /* Goals */
  .goals { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .goal-list { padding: 22px 24px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
  .goal-list h3 { font-family: var(--display); font-size: 16px; margin: 0 0 10px; }
  .goal-list h3 .tick { display: inline-flex; width: 18px; height: 18px; border-radius: 50%; align-items: center; justify-content: center; margin-right: 8px; font-size: 11px; }
  .goal-list h3 .tick.yes { background: var(--positive); color: white; }
  .goal-list h3 .tick.no { background: var(--line-strong); color: var(--muted); }
  .goal-list ul { padding-left: 18px; margin: 0; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }

  /* Metrics table */
  table { width: 100%; border-collapse: collapse; margin-top: 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { padding: 12px 18px; text-align: left; font-size: 13.5px; border-bottom: 1px solid var(--line); }
  th { font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); background: #f8fafd; }
  tr:last-child td { border-bottom: none; }
  td.target { font-family: var(--mono); color: var(--accent); font-weight: 600; }

  /* Stories */
  .stories { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
  .story { padding: 18px 22px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; }
  .story-num { width: 30px; height: 30px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; font-family: var(--mono); font-weight: 600; font-size: 13px; }
  .story-text { font-size: 14.5px; }
  .story-text strong { color: var(--accent); }

  /* Milestones */
  .timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 14px; }
  .step { padding: 18px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; position: relative; }
  .step .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 8px; background: var(--accent-soft); color: var(--accent); }
  .step h4 { font-family: var(--display); font-size: 15px; margin: 0 0 6px; }
  .step .meta { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-bottom: 8px; }
  .step ul { padding-left: 16px; margin: 0; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }

  /* Open questions */
  .questions { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
  .question { padding: 16px 20px; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
  .question p { margin: 0; font-size: 14px; }
  .assignee { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
  .avatar { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), #8473ff); color: white; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

  footer { margin-top: 60px; padding-top: 18px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

  @media (max-width: 880px) {
    .problem, .goals { grid-template-columns: 1fr; }
    .timeline { grid-template-columns: 1fr 1fr; }
    h1 { font-size: 32px; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="top">
    <div class="top-left">
      <span class="crumb">Northwind / Specs / Auth</span>
      <span class="pill draft"><span class="pill dot"></span>Draft v0.4</span>
    </div>
    <div class="top-actions">
      <span>Owner · Devon Park</span>
      <span>Updated · 22 Oct 2025</span>
      <span>Reviewers · 4</span>
    </div>
  </header>

  <h1>Two-factor authentication for the Northwind app.</h1>
  <p class="summary">Add TOTP and security-key second factors to the Northwind login flow so enterprise customers can meet their internal controls and we can move from "considered" to "approved" on three pending deals.</p>

  <div class="meta-row">
    <span><strong>Squad</strong>Identity Platform</span>
    <span><strong>Engineering lead</strong>Priya Banerjee</span>
    <span><strong>Design lead</strong>Sasha Lin</span>
    <span><strong>Target launch</strong>End Q4 (Dec 18)</span>
    <span><strong>Effort</strong>~6 eng-weeks</span>
  </div>

  <section>
    <h2>Problem<small>What hurts today, and for whom.</small></h2>
    <div class="problem">
      <div class="panel">
        <p>Three of the last six enterprise security reviews flagged the absence of a second factor as a blocker. Today, password is the only thing standing between a phished credential and a workspace full of customer data — for tenants under SOC 2 Type II expectations that's not just a perception problem, it's a control-plane gap.</p>
        <p>It also affects internal staff: every engineer with prod access is on the same auth surface as a marketing-team viewer. We rely on policy, not posture.</p>
      </div>
      <div class="quote">
        <div class="body">"We love the product, but the absence of TOTP came up in two of three security reviews. Add it and we can sign."</div>
        <div class="author">— Maya Reddy · CTO, Pioneer Robotics</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Goals &amp; non-goals<small>What this spec ships, and what we're explicitly leaving for later.</small></h2>
    <div class="goals">
      <div class="goal-list">
        <h3><span class="tick yes">✓</span>Goals</h3>
        <ul>
          <li>TOTP support (Authy, 1Password, Google Authenticator) for all paid plans.</li>
          <li>Security key support (WebAuthn) for Enterprise plans.</li>
          <li>Workspace-level enforcement: admin can require 2FA for all members.</li>
          <li>Recovery codes — printable, downloadable, regeneratable.</li>
          <li>Audit log entries for setup, change, and removal events.</li>
        </ul>
      </div>
      <div class="goal-list">
        <h3><span class="tick no">×</span>Non-goals</h3>
        <ul>
          <li>SMS as a second factor (NIST deprecated; not adding).</li>
          <li>SSO replacement — SAML stays a separate workstream.</li>
          <li>Per-action step-up (future spec, owned by Identity).</li>
          <li>Custom 2FA brand voice for whitelabel deployments.</li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <h2>Success metrics<small>We'll judge this launch on the three numbers below at the 30 / 60 / 90 day marks.</small></h2>
    <table>
      <thead><tr><th>Metric</th><th>Baseline</th><th>Target (90d)</th><th>How we measure</th></tr></thead>
      <tbody>
        <tr><td>Enterprise deals unblocked by 2FA gap</td><td>0 of 3</td><td class="target">3 of 3</td><td>Sales motion notes + signed contract count</td></tr>
        <tr><td>Member 2FA adoption (paid workspaces)</td><td>n/a</td><td class="target">≥ 60%</td><td>auth.factor_enrolled events / DAU</td></tr>
        <tr><td>Account takeover incidents (rolling 30d)</td><td>4 last quarter</td><td class="target">≤ 1</td><td>Security incident tracker (SEV-3+)</td></tr>
        <tr><td>Support load from 2FA recovery</td><td>n/a</td><td class="target">&lt; 1.5% of tickets</td><td>Tagged "auth-2fa" in Zendesk</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>User stories<small>Three personas, three motions.</small></h2>
    <div class="stories">
      <div class="story">
        <div class="story-num">1</div>
        <div class="story-text">As a <strong>workspace admin</strong>, I want to require 2FA for everyone in my workspace, so that I can pass our annual SOC 2 control review.</div>
      </div>
      <div class="story">
        <div class="story-num">2</div>
        <div class="story-text">As a <strong>day-to-day member</strong>, I want to enroll a TOTP app in under two minutes, so that I'm not pulled out of work to reconfigure auth.</div>
      </div>
      <div class="story">
        <div class="story-num">3</div>
        <div class="story-text">As a <strong>support engineer</strong>, I want a clear path to help locked-out users without bypassing their second factor, so that we don't undo the security we just added.</div>
      </div>
    </div>
  </section>

  <section>
    <h2>Rollout milestones<small>Four phases. Each phase ships behind a flag.</small></h2>
    <div class="timeline">
      <div class="step">
        <span class="badge">M1 · Nov 4</span>
        <h4>TOTP enrollment</h4>
        <div class="meta">2 eng-weeks</div>
        <ul><li>Settings page UI</li><li>Recovery codes</li><li>Audit log entries</li></ul>
      </div>
      <div class="step">
        <span class="badge">M2 · Nov 18</span>
        <h4>Login flow</h4>
        <div class="meta">1.5 eng-weeks</div>
        <ul><li>Challenge step in login</li><li>Trusted-device cookie</li><li>Rate limiting</li></ul>
      </div>
      <div class="step">
        <span class="badge">M3 · Dec 2</span>
        <h4>WebAuthn + admin enforcement</h4>
        <div class="meta">2 eng-weeks</div>
        <ul><li>Security keys (Enterprise)</li><li>Workspace policy</li><li>Member nag prompt</li></ul>
      </div>
      <div class="step">
        <span class="badge">M4 · Dec 18</span>
        <h4>GA + comms</h4>
        <div class="meta">0.5 eng-weeks</div>
        <ul><li>Changelog + email</li><li>Help center articles</li><li>Sales enablement</li></ul>
      </div>
    </div>
  </section>

  <section>
    <h2>Open questions<small>Assigned. We need answers by Friday Oct 31 to keep the date.</small></h2>
    <div class="questions">
      <div class="question">
        <p>Should we let members choose between TOTP and security keys, or pick the strongest available factor for them?</p>
        <span class="assignee"><span class="avatar">DP</span>Devon Park · Oct 28</span>
      </div>
      <div class="question">
        <p>Trusted-device cookie lifetime: 7 days, 30 days, or admin-configurable?</p>
        <span class="assignee"><span class="avatar">PB</span>Priya Banerjee · Oct 29</span>
      </div>
      <div class="question">
        <p>Do we surface a member's 2FA status in the admin user list, or only in the audit log?</p>
        <span class="assignee"><span class="avatar">SL</span>Sasha Lin · Oct 30</span>
      </div>
    </div>
  </section>

  <footer>
    <span>Northwind Identity Platform · spec-2fa</span>
    <span>v0.4 · 22 October 2025</span>
  </footer>
</div>
</body>
</html>

\`\`\``},{name:`pricing-page`,description:`A standalone pricing page — header, plan tiers, feature comparison table, and an FAQ. Use when the brief asks for "pricing", "plans", "subscription tiers", or a "compare plans" page.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/pricing-page`,body:`# Pricing Page Skill

Produce a single-screen pricing page that respects the active DESIGN.md.

## Workflow

1. **Read the active DESIGN.md** (injected above). Use only its colors, type
   tokens, and component patterns.
2. **Classify** the product from the brief and pick a tier shape:
   - 3-tier (most common): Free / Pro / Team or Starter / Growth / Enterprise.
   - 4-tier when the brief says "scale" or "enterprise plus".
   - 2-tier when it says "individual / business" or "personal / pro".
3. **Sections**, in order:
   1. **Hero** — page title (e.g. "Pricing"), one-line subhead, optional
      monthly/annual toggle.
   2. **Plan cards** — one card per tier. Each card: tier name, price (use the
      display font + larger scale for the number), 1-line positioning, 4–6
      bullet features, primary CTA. Mark the recommended tier with the DS
      accent border or a small badge.
   3. **Comparison table** — feature rows × tier columns, ✓ / — / value cells.
      Group features into 2–3 logical sections (Core, Collaboration,
      Support, Security…). Sticky header.
   4. **FAQ** — 4–6 collapsible Q&A items. Use \`<details><summary>\` for the
      collapse — no JS.
   5. **Footer CTA** — single line + button, accent band sparingly.
4. **Write** one self-contained HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS in one inline \`<style>\`.
   - CSS Grid for the plan-card row; CSS Grid for the comparison table.
   - \`data-od-id\` on each tier card and each table row.
5. **Money rendering**: use the display font for the big number, body for the
   currency and "/mo" — sizes per DESIGN.md scale.
6. **Self-check**:
   - Prices are plausible for the product (not "$X / month").
   - Accent is on the recommended tier and one CTA only.
   - Comparison table renders cleanly at 1024px and stacks readably below
     768px (rotate column headers or scroll-x).
   - No fake feature names — every row reads as something a real product
     would actually offer.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="pricing-slug" type="text/html" title="Pricing — Product Name">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pricing — Filebase</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1b1a; --muted: #6b6964; --border: #e6e4e0;
      --accent: #c96442; --surface: #ffffff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 -apple-system, system-ui, sans-serif; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 64px 32px 96px; }
    header { text-align: center; margin-bottom: 64px; }
    header h1 { font-size: clamp(40px, 5vw, 60px); letter-spacing: -0.02em; margin: 0 0 14px; }
    header p { font-size: 18px; color: var(--muted); margin: 0 auto; max-width: 50ch; }
    .toggle { display: inline-flex; margin-top: 28px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); overflow: hidden; }
    .toggle button { font: inherit; cursor: pointer; padding: 8px 18px; border: none; background: transparent; color: var(--muted); }
    .toggle button.active { background: var(--fg); color: white; }
    .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 64px; }
    @media (max-width: 800px) { .tiers { grid-template-columns: 1fr; } }
    .tier { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 36px 32px; }
    .tier.featured { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(201,100,66,0.08); }
    .tier h2 { margin: 0 0 4px; font-size: 18px; letter-spacing: -0.01em; }
    .tier .desc { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
    .tier .price { font-size: 48px; letter-spacing: -0.025em; line-height: 1; margin-bottom: 6px; }
    .tier .price small { font-size: 14px; color: var(--muted); font-weight: 400; letter-spacing: 0; }
    .tier ul { list-style: none; padding: 0; margin: 24px 0 28px; font-size: 14px; }
    .tier ul li { padding: 8px 0; color: var(--fg); border-top: 1px solid var(--border); display: flex; gap: 10px; align-items: flex-start; }
    .tier ul li::before { content: '✓'; color: var(--accent); flex-shrink: 0; }
    .tier ul li:first-child { border-top: none; }
    button.cta { font: inherit; cursor: pointer; padding: 12px 18px; border-radius: 8px; width: 100%; font-weight: 500; }
    .cta-primary { background: var(--accent); color: white; border: 1px solid var(--accent); }
    .cta-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .featured-pill { display: inline-block; font-size: 11px; padding: 2px 9px; border-radius: 999px; background: var(--accent); color: white; margin-bottom: 12px; letter-spacing: 0.04em; text-transform: uppercase; }
    .compare { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
    .compare h3 { padding: 24px 28px; margin: 0; font-size: 16px; border-bottom: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 12px 18px; text-align: left; border-top: 1px solid var(--border); }
    th { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; background: var(--bg); }
    td.has { color: var(--accent); font-weight: 500; }
    td.no { color: var(--muted); }
    .faq { margin-top: 56px; }
    .faq h3 { font-size: 22px; letter-spacing: -0.01em; margin-bottom: 24px; }
    details { padding: 16px 0; border-top: 1px solid var(--border); }
    details summary { font-weight: 500; cursor: pointer; }
    details p { margin: 10px 0 0; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap">
    <header data-od-id="header">
      <h1>One flat rate. No throttling.</h1>
      <p>Start free. Pick a paid tier the day you outgrow it. Switch yearly billing for two months off.</p>
      <div class="toggle">
        <button class="active">Monthly</button>
        <button>Yearly · save 17%</button>
      </div>
    </header>

    <section class="tiers" data-od-id="tiers">
      <div class="tier">
        <h2>Solo</h2>
        <p class="desc">For individuals.</p>
        <div class="price">$8 <small>/ month</small></div>
        <ul>
          <li>1 TB storage</li>
          <li>Block-level sync</li>
          <li>2 devices</li>
          <li>Email support</li>
        </ul>
        <button class="cta cta-secondary">Choose Solo</button>
      </div>
      <div class="tier featured">
        <span class="featured-pill">Recommended</span>
        <h2>Team</h2>
        <p class="desc">For teams up to 50 people.</p>
        <div class="price">$14 <small>/ seat / month</small></div>
        <ul>
          <li>5 TB pooled storage</li>
          <li>Shared folders & granular roles</li>
          <li>Unlimited devices</li>
          <li>Audit log + usage analytics</li>
          <li>Priority support</li>
        </ul>
        <button class="cta cta-primary">Choose Team</button>
      </div>
      <div class="tier">
        <h2>Enterprise</h2>
        <p class="desc">SSO, on-prem keys, 99.99% SLA.</p>
        <div class="price">Custom</div>
        <ul>
          <li>Unlimited storage</li>
          <li>SAML / SCIM provisioning</li>
          <li>On-prem encryption keys</li>
          <li>Dedicated CSM</li>
        </ul>
        <button class="cta cta-secondary">Talk to sales</button>
      </div>
    </section>

    <section class="compare" data-od-id="compare">
      <h3>Plan comparison</h3>
      <table>
        <thead><tr><th>Feature</th><th>Solo</th><th>Team</th><th>Enterprise</th></tr></thead>
        <tbody>
          <tr><td>Block-level sync</td><td class="has">✓</td><td class="has">✓</td><td class="has">✓</td></tr>
          <tr><td>End-to-end encryption</td><td class="has">✓</td><td class="has">✓</td><td class="has">✓</td></tr>
          <tr><td>Shared folders</td><td class="no">—</td><td class="has">✓</td><td class="has">✓</td></tr>
          <tr><td>SAML / SCIM</td><td class="no">—</td><td class="no">—</td><td class="has">✓</td></tr>
          <tr><td>Audit log</td><td class="no">—</td><td class="has">✓</td><td class="has">✓</td></tr>
          <tr><td>SLA</td><td class="no">—</td><td>99.9%</td><td>99.99%</td></tr>
          <tr><td>Support</td><td>Email</td><td>Priority</td><td>Dedicated CSM</td></tr>
        </tbody>
      </table>
    </section>

    <section class="faq" data-od-id="faq">
      <h3>Common questions</h3>
      <details><summary>Can I change tiers mid-month?</summary><p>Yes. Switching upward charges a prorated difference; downgrades take effect at the next billing cycle.</p></details>
      <details><summary>Is there a free tier?</summary><p>14-day free trial on every paid tier. No credit card required.</p></details>
      <details><summary>How does seat-based billing work for Team?</summary><p>You pay per active seat per month. Inactive seats automatically free up after 30 days; we'll prorate the credit.</p></details>
    </section>
  </div>
</body>
</html>

\`\`\``},{name:`saas-landing`,description:`Single-page SaaS landing with hero, features, social proof, pricing, and CTA. Respects the active DESIGN.md color/typography/layout tokens. Trigger keywords: "saas landing", "marketing page", "product landing".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/saas-landing`,body:`# SaaS Landing Skill

Produce a single-page SaaS landing. Agent, follow this workflow exactly.

## 1. Read context

Before writing anything:
- Read \`DESIGN.md\` in the current working directory. If missing, stop and ask for one.
- Identify the color palette, typography tokens, and layout principles.
- Note the "Agent Prompt Guide" section — it overrides any instruction here if they conflict.

## 2. Plan sections

Required sections, in order:
1. **Hero** — logo-or-wordmark, headline (tagline input), subhead (1–2 sentences), primary CTA, secondary CTA. Use the hero_density parameter as vertical padding in px.
2. **Features** — 3–6 feature tiles. Each: icon, short title, 1–2 sentence body.
3. **Social proof** — \`proof_count\` logos or testimonials. If 0, skip this section.
4. **Pricing** — 2–3 tiers. Include only if \`has_pricing\` is true.
5. **Footer CTA** — large accent-colored band with one-button call to action.
6. **Footer** — minimal: links + copyright.

## 3. Apply design system

- All colors must come from DESIGN.md tokens. Do not invent hex values.
- Typography: use the declared display font for headlines, body font for everything else.
- Layout: respect the grid, max-width, and section spacing rules.
- Components: use declared button/card/input patterns. Do not add shadows if DESIGN.md's Depth & Elevation says minimal.
- Accent: use the accent color only once in the hero, once in the footer CTA, and for all links. Do not flood the page.

## 4. Write the file

Output a single self-contained \`index.html\` with:
- All CSS inlined in a \`<style>\` block in \`<head>\`.
- System font fallbacks if DESIGN.md fonts aren't loadable from Google Fonts etc.
- No external JS.
- Semantic HTML (\`<header>\`, \`<main>\`, \`<section>\`, \`<footer>\`).
- Each editable element tagged with \`data-od-id="<unique-slug>"\` so the host app's comment mode can target it.

## 5. Self-check

Before finishing, verify:
- [ ] All text is content-meaningful, not lorem ipsum (use product_name and tagline inputs; generate plausible specific copy for the rest).
- [ ] No broken color references (every CSS color value is in DESIGN.md's palette or a valid alpha/fallback variant).
- [ ] Responsive breakpoints match DESIGN.md's Responsive Behavior section.
- [ ] The page looks good at 1440w, 768w, and 375w (mentally simulate).
- [ ] Accent used no more than twice total.

## 6. Done

Write only \`index.html\`. Do not generate a separate CSS file, JS file, or README.

---

## For skill authors reading this as a reference

This is a minimal but complete skill. Structure:

\`\`\`
saas-landing-skill/
├── SKILL.md    ← you are here
└── assets/
    └── base.html    (optional starter template; this skill doesn't use one)
\`\`\`

Things to notice:
- The \`od:\` front-matter block is optional for Claude-Code-only compatibility, but adding it lights up OD's typed inputs, sliders, preview metadata, and capability gating.
- The workflow below the front-matter is plain Markdown that the agent reads as its system prompt.
- DESIGN.md is treated as a collaborator, not an override. The skill gives the agent authority to override when the brief conflicts, but never to invent new tokens.
- \`data-od-id\` tagging is how we wire elements to comment mode. Skills that want comment-mode compatibility must annotate their output.

See [\`../../skills-protocol.md\`](../../skills-protocol.md) for the full protocol.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Filebase — sync that respects your bandwidth</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1b1a; --muted: #6b6964; --border: #e6e4e0;
      --accent: #c96442; --surface: #ffffff;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 -apple-system, system-ui, sans-serif; }
    .wrap { max-width: 1080px; margin: 0 auto; padding: 0 32px; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; }
    .logo { font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
    nav a { color: var(--fg); text-decoration: none; margin-left: 22px; font-size: 14px; }
    button { font: inherit; cursor: pointer; padding: 11px 20px; border-radius: 8px; font-weight: 500; }
    .btn-primary { background: var(--accent); color: white; border: 1px solid var(--accent); }
    .btn-secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
    .btn-link { background: transparent; border: none; color: var(--accent); padding: 11px 0; font-weight: 500; cursor: pointer; }
    section { padding: 80px 0; }
    .hero { padding: 100px 0; }
    .hero h1 { font-size: clamp(44px, 6vw, 76px); line-height: 1.05; letter-spacing: -0.02em; max-width: 17ch; margin: 0 0 22px; }
    .hero p { font-size: 19px; color: var(--muted); max-width: 56ch; margin: 0 0 36px; }
    .hero .cta { display: flex; gap: 12px; }
    .features { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; }
    @media (max-width: 800px) { .feature-grid { grid-template-columns: 1fr; } }
    .feature h3 { font-size: 18px; margin: 0 0 8px; letter-spacing: -0.01em; }
    .feature .num { font-family: ui-monospace, monospace; color: var(--accent); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 12px; display: block; }
    .feature p { margin: 0; color: var(--muted); font-size: 14.5px; }
    .proof { text-align: center; }
    .proof h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin: 0 0 28px; }
    .logos { display: flex; justify-content: center; gap: 56px; flex-wrap: wrap; opacity: 0.6; font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
    .pricing h2 { text-align: center; font-size: 36px; margin: 0 0 12px; letter-spacing: -0.02em; }
    .pricing .lede { text-align: center; color: var(--muted); margin: 0 0 48px; }
    .tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    @media (max-width: 800px) { .tiers { grid-template-columns: 1fr; } }
    .tier { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 32px; }
    .tier.featured { border-color: var(--accent); position: relative; }
    .tier.featured::before { content: 'Recommended'; position: absolute; top: -12px; left: 24px; background: var(--accent); color: white; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; }
    .tier h3 { margin: 0 0 8px; font-size: 18px; }
    .tier .price { font-size: 40px; letter-spacing: -0.02em; margin: 6px 0 16px; }
    .tier .price small { font-size: 14px; color: var(--muted); font-weight: 400; }
    .tier ul { list-style: none; padding: 0; margin: 16px 0 24px; color: var(--muted); font-size: 14px; }
    .tier ul li { padding: 5px 0; border-top: 1px solid var(--border); }
    .tier ul li:first-child { border-top: none; }
    .closing { background: var(--accent); color: white; text-align: center; }
    .closing h2 { font-size: 38px; letter-spacing: -0.02em; margin: 0 0 14px; }
    .closing p { opacity: 0.85; margin: 0 0 28px; }
    .closing button { background: white; color: var(--accent); border: none; }
    footer { padding: 28px 0; color: var(--muted); font-size: 13px; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <header data-od-id="topnav">
      <span class="logo">◰ Filebase</span>
      <nav>
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#docs">Docs</a>
        <button class="btn-secondary" style="margin-left: 12px;">Sign in</button>
      </nav>
    </header>
    <section class="hero" data-od-id="hero">
      <h1>File sync that doesn't eat your bandwidth.</h1>
      <p>Block-level deltas, end-to-end encryption, and a pricing model that doesn't punish you for working with video.</p>
      <div class="cta">
        <button class="btn-primary">Get Filebase</button>
        <button class="btn-link">Read the whitepaper →</button>
      </div>
    </section>
  </div>

  <section class="features" id="features" data-od-id="features">
    <div class="wrap feature-grid">
      <div class="feature">
        <span class="num">01</span>
        <h3>Block-level diffs</h3>
        <p>Edit a 4 GB Final Cut project? We sync the 200 KB you changed. Not the whole file.</p>
      </div>
      <div class="feature">
        <span class="num">02</span>
        <h3>End-to-end encrypted</h3>
        <p>Files are encrypted on your laptop before they leave. We can't read them. Neither can law enforcement, by design.</p>
      </div>
      <div class="feature">
        <span class="num">03</span>
        <h3>Honest pricing</h3>
        <p>One flat rate for unlimited storage. No "fair use" clauses. No throttling at 90%.</p>
      </div>
    </div>
  </section>

  <section class="proof wrap" data-od-id="proof">
    <h2>Used by teams at</h2>
    <div class="logos"><span>Anthropic</span><span>Stripe</span><span>Linear</span><span>Vercel</span><span>Cursor</span></div>
  </section>

  <section class="pricing wrap" id="pricing" data-od-id="pricing">
    <h2>Pricing</h2>
    <p class="lede">Pick a tier. Switch or cancel any time.</p>
    <div class="tiers">
      <div class="tier">
        <h3>Solo</h3>
        <div class="price">$8<small>/mo</small></div>
        <p style="color: var(--muted); margin: 0;">For individuals.</p>
        <ul>
          <li>1 TB storage</li>
          <li>Block-level sync</li>
          <li>Email support</li>
        </ul>
        <button class="btn-secondary" style="width: 100%;">Choose Solo</button>
      </div>
      <div class="tier featured">
        <h3>Team</h3>
        <div class="price">$14<small>/seat/mo</small></div>
        <p style="color: var(--muted); margin: 0;">For teams up to 50.</p>
        <ul>
          <li>5 TB pooled storage</li>
          <li>Shared folders & roles</li>
          <li>Priority support</li>
          <li>Audit log</li>
        </ul>
        <button class="btn-primary" style="width: 100%;">Choose Team</button>
      </div>
      <div class="tier">
        <h3>Enterprise</h3>
        <div class="price">Custom</div>
        <p style="color: var(--muted); margin: 0;">SSO, on-prem keys, SLA.</p>
        <ul>
          <li>Unlimited storage</li>
          <li>SAML / SCIM</li>
          <li>Dedicated support</li>
        </ul>
        <button class="btn-secondary" style="width: 100%;">Talk to sales</button>
      </div>
    </div>
  </section>

  <section class="closing" data-od-id="closing">
    <div class="wrap">
      <h2>Sync less, ship more.</h2>
      <p>14-day free trial. No credit card needed.</p>
      <button>Get Filebase</button>
    </div>
  </section>

  <footer class="wrap" data-od-id="footer">© Filebase · Privacy · Terms · Status</footer>
</body>
</html>

\`\`\``},{name:`social-carousel`,description:`A three-card social-media carousel laid out as 1080×1080 squares — three cinematic, on-brand panels with display headlines that connect across the series ("onwards." → "to the next one." → "looking ahead."). Each card has a brand mark, a number / total, a caption, and a "loop" affordance. Use when the brief asks for a "carousel post", "social carousel", "Instagram carousel", "LinkedIn series", "X thread cards", or "三连发".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/social-carousel`,body:`# Social Carousel Skill

Produce a 3-panel social carousel on a single dark stage. Each panel is a
1080×1080 cinematic still — connected as a series, but each readable on its
own.

## Workflow

1. **Read the active DESIGN.md** (injected above). Pick the loudest serif
   token for the headline lockups and a mono token for stamps / counters.
2. **Pick the theme + 3 captions** from the brief. The captions must read
   as one sentence when stacked: ("onwards." → "to the next one." →
   "looking ahead." or "input." → "iterate." → "ship.").
3. **Stage** — full-bleed dark page. Top header strip:
   - Left: serif italic display "Three posts. One beat."
   - Just below the title: a one-line description in muted mono ("1080×1080
     · cinematic video loops · minimal type. Drop into Instagram, LinkedIn,
     or X — each post stands on its own or runs as a three-part series.").
   - Right: small mono badge "SERIES · 01 → 03".
4. **Cards** — 3 squares in a horizontal row (wraps to stack on narrow
   viewports). Each card is \`aspect-ratio: 1 / 1\` with rounded 12px corners
   and a subtle 1px border, plus a soft drop shadow.
   - Background: a layered gradient that *suggests* a cinematic photo — for
     example, panel 1 = warm dawn meadow (stacked greens with a cyan sky
     wash); panel 2 = forest dusk (warm oranges fading into deep teals);
     panel 3 = pink-mountain ridge (rosy peaks against a dim violet sky).
     Use \`radial-gradient\` + \`linear-gradient\` only — no images.
   - Top-left chip: brand wordmark in serif italic ("Jerrod Lew") with a
     small accent dot.
   - Top-left below chip: micro mono index "AI · 01 / 03" (and 02, 03).
   - Bottom-left: the headline lockup in white serif display, italic accent
     on one word.
   - Bottom-right corner: a \`1× LOOP\` mono stamp inside a thin border.
   - Bottom strip caption: small caps mono describing the imagined frame
     ("Man, walking forward — close.", "Woman, stepping into frame.",
     "Woman, overlooking the city.").
5. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Cards are sized via \`width: clamp(280px, 30vw, 380px)\` so 3 fit
     comfortably across most desktops and stack at < 1100px.
   - \`data-od-id\` on stage, each card, each headline.
6. **Self-check**:
   - The three headlines together form one sentence and feel cinematic.
   - Mono is used only for the wordmark index, the loop stamp, and the
     bottom captions. The headlines stay serif.
   - Each panel's color story is distinct — no two share a dominant hue.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="carousel-slug" type="text/html" title="Carousel — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Three posts. One beat. — social carousel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --stage: #0a0a0a;
      --stage-2: #141414;
      --paper: #f4ede0;
      --serif: 'Instrument Serif', 'Iowan Old Style', Georgia, serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,255,255,0.04), transparent 70%),
        var(--stage);
      color: #f4ede0;
      font: 14px/1.5 -apple-system, system-ui, sans-serif;
    }

    .stage {
      max-width: 1280px; margin: 0 auto; padding: 60px 32px 80px;
    }
    .stage-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 36px; }
    .stage-head h1 { margin: 0; font: italic 700 36px/1 var(--serif); letter-spacing: -0.005em; }
    .stage-head h1 em { font-style: normal; }
    .stage-head h1 .dot { color: #a4a09a; }
    .stage-head .lede { margin: 8px 0 0; font: 11px/1.6 var(--mono); color: rgba(244,237,224,0.5); letter-spacing: 0.06em; max-width: 60ch; text-transform: uppercase; }
    .stage-head .badge { font: 10.5px/1 var(--mono); padding: 7px 10px; border: 1px solid rgba(244,237,224,0.3); color: rgba(244,237,224,0.7); letter-spacing: 0.18em; flex-shrink: 0; }

    .row { display: flex; gap: 22px; justify-content: center; align-items: stretch; flex-wrap: wrap; }

    .card {
      width: clamp(280px, 30vw, 380px);
      aspect-ratio: 1 / 1;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.06);
      box-shadow: 0 30px 60px rgba(0,0,0,0.45);
      position: relative;
      overflow: hidden;
      color: #ffffff;
    }
    .card .scrim {
      position: absolute; inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%);
      pointer-events: none;
    }
    .card .top { position: absolute; top: 18px; left: 18px; right: 18px; display: flex; justify-content: space-between; align-items: flex-start; }
    .card .brand { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; background: rgba(255,255,255,0.10); backdrop-filter: blur(6px); border-radius: 999px; }
    .card .brand .name { font: italic 700 13px/1 var(--serif); }
    .card .brand .dot { width: 5px; height: 5px; background: var(--paper); border-radius: 50%; opacity: 0.9; }
    .card .index { font: 11px/1.4 var(--mono); color: rgba(255,255,255,0.85); letter-spacing: 0.16em; text-align: right; padding: 6px 10px; background: rgba(0,0,0,0.30); backdrop-filter: blur(4px); border-radius: 4px; }

    .card .lockup { position: absolute; left: 22px; right: 22px; bottom: 78px; }
    .card .lockup h2 { margin: 0; font: 700 60px/1 var(--serif); letter-spacing: -0.005em; color: #ffffff; }
    .card .lockup h2 em { font-style: italic; }
    .card .lockup h2 .accent { font-style: italic; }

    .card .footer { position: absolute; left: 22px; right: 22px; bottom: 22px; display: flex; justify-content: space-between; align-items: center; }
    .card .footer .caption { font: 10.5px/1.4 var(--mono); color: rgba(255,255,255,0.85); letter-spacing: 0.14em; text-transform: uppercase; max-width: 70%; }
    .card .loop { font: 10.5px/1 var(--mono); padding: 6px 8px; border: 1px solid rgba(255,255,255,0.55); border-radius: 4px; color: rgba(255,255,255,0.85); letter-spacing: 0.18em; }

    /* Card 1 — dawn meadow, blue sky */
    .card.c1 {
      background:
        linear-gradient(180deg, #5b8cb6 0%, #92aebd 32%, #b0a679 50%, #6f8a4d 70%, #2a4a2a 100%),
        #4a6a8a;
    }
    .card.c1 .figure {
      position: absolute; left: 50%; top: 56%;
      width: 80px; height: 200px;
      transform: translate(-50%, 0);
      background:
        radial-gradient(ellipse 30px 14px at 50% 30%, #2a1f15 0%, #2a1f15 60%, transparent 70%),
        linear-gradient(180deg, #2a1f15 0%, #4a3018 22%, #6a3a1a 60%, transparent 100%);
      filter: drop-shadow(0 6px 8px rgba(0,0,0,0.35));
      clip-path: polygon(35% 0%, 65% 0%, 78% 26%, 70% 60%, 70% 100%, 30% 100%, 30% 60%, 22% 26%);
      opacity: 0.92;
    }

    /* Card 2 — forest dusk, warm orange center */
    .card.c2 {
      background:
        radial-gradient(ellipse 80% 50% at 50% 100%, #f49255 0%, #c95a30 35%, transparent 60%),
        radial-gradient(ellipse 80% 80% at 50% 90%, rgba(255,180,120,0.5), transparent 60%),
        linear-gradient(180deg, #1c2a25 0%, #2a3a30 30%, #4a3a26 70%, #2a1a14 100%);
    }
    .card.c2 .trees {
      position: absolute; left: 0; right: 0; top: 0; bottom: 0;
    }
    .card.c2 .trees::before, .card.c2 .trees::after {
      content: ''; position: absolute; bottom: 0; width: 50%; height: 70%;
      background:
        radial-gradient(circle at 20% 90%, #0f1a14 6px, transparent 7px),
        radial-gradient(circle at 50% 88%, #0f1a14 8px, transparent 9px),
        radial-gradient(circle at 80% 92%, #0f1a14 6px, transparent 7px);
    }
    .card.c2 .trees::before { left: 0; background:
      linear-gradient(180deg, transparent 0%, transparent 30%, rgba(15,26,20,0.85) 30%, #0f1a14 100%);
      mask: radial-gradient(ellipse 60% 90% at 50% 100%, black 70%, transparent 100%);
    }
    .card.c2 .trees::after { right: 0; background:
      linear-gradient(180deg, transparent 0%, transparent 36%, rgba(15,26,20,0.85) 36%, #0f1a14 100%);
      mask: radial-gradient(ellipse 60% 90% at 50% 100%, black 70%, transparent 100%);
    }
    .card.c2 .figure {
      position: absolute; left: 52%; top: 56%; width: 56px; height: 130px;
      transform: translate(-50%, 0);
      background: linear-gradient(180deg, #2a1810 0%, #4a2818 100%);
      clip-path: polygon(40% 0%, 60% 0%, 70% 22%, 70% 56%, 65% 100%, 35% 100%, 30% 56%, 30% 22%);
      filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));
    }

    /* Card 3 — pink ridge / mountain */
    .card.c3 {
      background:
        linear-gradient(180deg, #1b1e3a 0%, #4a3956 28%, #c9627e 60%, #d57f86 75%, #b8d2d8 100%);
    }
    .card.c3 .ridge {
      position: absolute; inset: 0;
      background:
        linear-gradient(180deg, transparent 60%, rgba(60,30,40,0.4) 80%, rgba(40,20,30,0.7) 100%);
    }
    .card.c3 .ridge::before {
      content: ''; position: absolute; left: 0; right: 0; bottom: 24%;
      height: 30%;
      background:
        linear-gradient(180deg, #b3526a 0%, #7a3148 100%);
      clip-path: polygon(0% 60%, 12% 30%, 22% 50%, 36% 18%, 50% 40%, 60% 22%, 72% 48%, 86% 26%, 100% 50%, 100% 100%, 0% 100%);
    }
    .card.c3 .ridge::after {
      content: ''; position: absolute; left: 0; right: 0; bottom: 0;
      height: 32%;
      background: linear-gradient(180deg, #2a1f2a 0%, #1a1018 100%);
      clip-path: polygon(0% 50%, 8% 20%, 18% 38%, 30% 8%, 44% 32%, 56% 12%, 68% 36%, 82% 18%, 100% 40%, 100% 100%, 0% 100%);
    }
    .card.c3 .figure {
      position: absolute; right: 18%; bottom: 14%; width: 30px; height: 56px;
      background: #1a0d12;
      clip-path: polygon(35% 0%, 65% 0%, 75% 30%, 60% 100%, 40% 100%, 25% 30%);
      filter: drop-shadow(0 4px 4px rgba(0,0,0,0.4));
    }

    @media (max-width: 1180px) {
      .row { flex-direction: column; align-items: center; }
      .card { width: min(96vw, 480px); }
      .card .lockup h2 { font-size: 56px; }
    }
  </style>
</head>
<body>
  <div class="stage" data-od-id="stage">
    <div class="stage-head">
      <div>
        <h1>Three posts<span class="dot">.</span> One <em>beat</em><span class="dot">.</span></h1>
        <p class="lede">1080×1080 · cinematic video loops · minimal type. Drop into Instagram, LinkedIn, or X — each post stands on its own or runs as a three-part series.</p>
      </div>
      <span class="badge">SERIES · 01 → 03</span>
    </div>

    <div class="row" data-od-id="cards">

      <article class="card c1" data-od-id="card-1">
        <div class="figure"></div>
        <div class="scrim"></div>
        <div class="top">
          <div class="brand"><span class="dot"></span><span class="name">Jerrod Lew</span></div>
          <div class="index">01 · ONWARDS</div>
        </div>
        <div class="lockup"><h2>onwards<em>.</em></h2></div>
        <div class="footer">
          <div class="caption">Man, walking forward — close.</div>
          <div class="loop">1× LOOP</div>
        </div>
      </article>

      <article class="card c2" data-od-id="card-2">
        <div class="trees"></div>
        <div class="figure"></div>
        <div class="scrim"></div>
        <div class="top">
          <div class="brand"><span class="dot"></span><span class="name">Jerrod Lew</span></div>
          <div class="index">02 · TO THE NEXT ONE</div>
        </div>
        <div class="lockup"><h2><span class="accent">to the</span><br/><em>next one.</em></h2></div>
        <div class="footer">
          <div class="caption">Woman, stepping into frame.</div>
          <div class="loop">1× LOOP</div>
        </div>
      </article>

      <article class="card c3" data-od-id="card-3">
        <div class="ridge"></div>
        <div class="figure"></div>
        <div class="scrim"></div>
        <div class="top">
          <div class="brand"><span class="dot"></span><span class="name">Jerrod Lew</span></div>
          <div class="index">03 · LOOKING AHEAD</div>
        </div>
        <div class="lockup"><h2>looking<br/><em>ahead.</em></h2></div>
        <div class="footer">
          <div class="caption">Woman, overlooking the city.</div>
          <div class="loop">1× LOOP</div>
        </div>
      </article>

    </div>
  </div>
</body>
</html>

\`\`\``},{name:`sprite-animation`,description:`A pixel / sprite-style animated explainer slide — full-bleed cream stage, bold display year, animated pixel-art mascot (e.g. Hanafuda card, mushroom, or 8-bit console), kinetic Japanese display type, ticking timeline ribbon. Reads like a single frame of an educational motion video — looping CSS keyframes, no JS, ready to be screen-recorded into a vertical video. Use when the brief asks for a "sprite animation", "pixel-art video", "8-bit explainer", "history of X explainer", "kinetic typography history", "Nintendo-style", "精灵图动画", "像素动画", or "复古动画".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/sprite-animation`,body:`# Sprite Animation Skill

Produce a single animated frame of an educational explainer — the kind you
might screen-record into a vertical video. Pixel-art mascots, big year
display, looping CSS animations, kinetic Japanese / English display type.

## Workflow

1. **Read the active DESIGN.md** (injected above). Pick the loudest serif
   token for the year, a sturdy sans for headlines, and a mono token for
   timeline / index labels.
2. **Pick the topic** from the brief (e.g. "Nintendo · 1889 — Hanafuda").
   You always need: a year, a one-line headline, an animated subject (a
   pixel sprite — character, object, or icon), and a short caption.
3. **Stage** — full-bleed cream / off-white background (\`#f5efe2\`) with a
   subtle paper grain. Keep margins generous; this is one beat of a video.
4. **Top bar** — small mono row:
   - Left: title slug ("名次の/番組" or "EP. 01 / NINTENDO")
   - Right: progress dots ("01 / 12") and a "REC" stamp
5. **Subject animations** — at least three independent looping animations
   on the page:
   - **Big year**: the headline year (e.g. "1889年") fills the lower-left,
     in a serif display weight. It has a subtle vertical glitch / scanline
     animation (clip-path keyframes), and a 1-frame "pop" every loop.
   - **Pixel sprite card**: a 96×128 pixel-art card or character (use an
     inline SVG with crisp \`shape-rendering: crispEdges\` rectangles, or a
     \`box-shadow\` pixel grid). Subtle bobbing animation (±4px, 1.6s).
   - **Kinetic kana**: 1–2 Japanese / kanji characters that fade-and-slide
     in sync with the bob (e.g. "花" — *hana* — flower).
   - **Tick ribbon**: bottom of the stage, a tape/ribbon with year ticks
     (1889 · 1907 · 1949 · 1977 · 1985 · 2006 · 2017) sliding left at a
     slow constant speed.
6. **Caption block** — small mono caption explaining the trivia:
   "Nintendo started as a Hanafuda playing-card maker in Kyoto, 1889.
    Mario didn't show up for another ninety-six years."
7. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline, no external JS.
   - All animations use \`@keyframes\` + \`animation: ... infinite\`.
   - Stage uses a fixed canvas ratio (e.g. 16:9 letterboxed) so the loop
     reads as a single frame from a video.
   - \`data-od-id\` on stage, year, sprite, caption, and tick ribbon.
8. **Self-check**:
   - The page is one cohesive scene, not a collage. The eye lands on the
     year first, then the sprite, then the caption.
   - At least 3 independent looping animations are visible.
   - The color palette is restrained (cream + a single accent red + ink).
   - No external assets — all sprites are inline SVG or CSS.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="sprite-anim-slug" type="text/html" title="Sprite animation — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nintendo, 1889 — sprite animation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+JP:wght@500;700&family=Press+Start+2P&display=swap" rel="stylesheet" />
  <style>
    :root {
      --paper: #f5efe2;
      --paper-2: #ede4d0;
      --ink: #181612;
      --accent: #d92b1c;
      --muted: #6f6a60;
      --serif: 'DM Serif Display', 'Iowan Old Style', Georgia, serif;
      --jp: 'Noto Serif JP', serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
      --pixel: 'Press Start 2P', monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      min-height: 100vh;
      background: #1a1816;
      color: var(--ink);
      font: 14px/1.5 -apple-system, system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }

    .stage {
      width: min(1280px, 100%);
      aspect-ratio: 16 / 9;
      position: relative;
      overflow: hidden;
      background: var(--paper);
      background-image:
        radial-gradient(rgba(120,90,40,0.06) 1px, transparent 1px),
        radial-gradient(rgba(120,90,40,0.04) 1px, transparent 1px);
      background-size: 4px 4px, 7px 7px;
      background-position: 0 0, 2px 3px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.05);
      border-radius: 4px;
    }
    .stage::before {
      content: ''; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0.04) 0%, transparent 8%, transparent 92%, rgba(0,0,0,0.05) 100%);
      pointer-events: none;
    }

    /* top bar */
    .topbar { position: absolute; top: 0; left: 0; right: 0; padding: 22px 32px; display: flex; justify-content: space-between; align-items: center; font: 11px/1 var(--mono); color: var(--muted); letter-spacing: 0.18em; text-transform: uppercase; }
    .topbar .slug { display: inline-flex; align-items: center; gap: 10px; }
    .topbar .slug .jp { font-family: var(--jp); font-weight: 700; color: var(--ink); letter-spacing: 0.05em; text-transform: none; font-size: 13px; }
    .topbar .slug .en { color: var(--muted); }
    .topbar .progress { display: inline-flex; align-items: center; gap: 12px; }
    .topbar .progress .dots { display: inline-flex; gap: 4px; }
    .topbar .progress .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--ink); display: inline-block; opacity: 0.18; }
    .topbar .progress .dots i.on { opacity: 1; }
    .topbar .rec { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border: 1px solid var(--ink); color: var(--ink); }
    .topbar .rec::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: blink 1.2s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0.2; } }

    /* big year */
    .year { position: absolute; left: 6%; bottom: 14%; font: 700 200px/0.85 var(--serif); color: var(--ink); letter-spacing: -0.03em; }
    .year .num { display: inline-block; position: relative; }
    .year .num .glitch {
      position: absolute; left: 0; top: 0; color: var(--accent);
      clip-path: inset(0 0 70% 0);
      animation: glitch 4s steps(8) infinite;
      mix-blend-mode: multiply;
    }
    @keyframes glitch {
      0%, 88%, 100% { clip-path: inset(0 0 100% 0); transform: translate(0,0); opacity: 0; }
      89% { clip-path: inset(20% 0 60% 0); transform: translate(2px, -1px); opacity: 0.7; }
      91% { clip-path: inset(60% 0 20% 0); transform: translate(-2px, 1px); opacity: 0.7; }
      94% { clip-path: inset(40% 0 40% 0); transform: translate(1px, 0); opacity: 0.6; }
      97% { clip-path: inset(0 0 100% 0); transform: translate(0,0); opacity: 0; }
    }
    .year .jp-suffix { font-family: var(--jp); font-weight: 700; font-size: 0.6em; vertical-align: 0.16em; margin-left: 0.04em; }

    .year-label { position: absolute; left: 6%; bottom: calc(14% + 200px + 12px); font: 11px/1.2 var(--mono); letter-spacing: 0.22em; color: var(--muted); text-transform: uppercase; }
    .year-label::before { content: ''; display: inline-block; width: 24px; height: 1px; background: var(--ink); vertical-align: middle; margin-right: 10px; opacity: 0.5; }

    /* sprite card */
    .sprite-stack {
      position: absolute; right: 12%; top: 22%;
      display: flex; flex-direction: column; align-items: center; gap: 22px;
      animation: bob 2.4s ease-in-out infinite;
    }
    @keyframes bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }
    .sprite-card {
      width: 168px; height: 252px;
      background: var(--paper-2);
      border: 4px solid var(--ink);
      border-radius: 10px;
      box-shadow: 8px 8px 0 var(--ink);
      position: relative;
      padding: 12px;
      display: flex; flex-direction: column; align-items: center;
      image-rendering: pixelated;
    }
    .sprite-card::before, .sprite-card::after {
      content: ''; position: absolute; left: 8px; right: 8px; height: 4px; background: var(--ink);
    }
    .sprite-card::before { top: 14px; }
    .sprite-card::after { bottom: 14px; }

    .sprite-card svg { display: block; image-rendering: pixelated; shape-rendering: crispEdges; margin-top: 18px; }

    .sprite-tag { font-family: var(--jp); font-weight: 700; font-size: 28px; color: var(--accent); margin-top: auto; line-height: 1; letter-spacing: 0.06em; }
    .sprite-tag small { display: block; font-family: var(--mono); font-weight: 500; font-size: 10px; color: var(--muted); letter-spacing: 0.18em; margin-top: 4px; text-transform: uppercase; }

    /* kinetic kana */
    .kana { position: absolute; right: 6%; top: 12%; font-family: var(--jp); font-weight: 700; font-size: 96px; color: var(--ink); line-height: 1; letter-spacing: 0; }
    .kana span { display: inline-block; opacity: 0; animation: kana-in 4s ease-in-out infinite; }
    .kana span:nth-child(1) { animation-delay: 0s; }
    .kana span:nth-child(2) { animation-delay: 0.4s; }
    @keyframes kana-in {
      0% { opacity: 0; transform: translateY(-12px); }
      18%, 78% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(8px); }
    }

    /* caption block */
    .caption {
      position: absolute; left: 6%; right: 50%; bottom: 6%;
      font: 12px/1.5 var(--mono); color: var(--ink);
      letter-spacing: 0.04em;
      max-width: 32ch;
    }
    .caption strong { display: block; font-family: var(--serif); font-weight: 400; font-style: italic; font-size: 18px; letter-spacing: -0.005em; margin-bottom: 6px; color: var(--ink); }

    /* tick ribbon */
    .ribbon {
      position: absolute; left: 0; right: 0; bottom: 0;
      height: 36px;
      background: var(--ink);
      color: var(--paper);
      overflow: hidden;
      display: flex; align-items: center;
    }
    .ribbon-track {
      display: inline-flex; gap: 64px;
      padding: 0 32px;
      animation: scroll-left 22s linear infinite;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .ribbon-track .tick { display: inline-flex; align-items: center; gap: 8px; font: 11px/1 var(--mono); letter-spacing: 0.22em; }
    .ribbon-track .tick .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; }
    .ribbon-track .tick .label { color: var(--paper); }
    .ribbon-track .tick .note { color: rgba(245,239,226,0.55); text-transform: uppercase; }
    @keyframes scroll-left {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }

    /* corner registration marks */
    .reg { position: absolute; width: 14px; height: 14px; border: 1px solid var(--ink); opacity: 0.35; }
    .reg.tl { top: 14px; left: 14px; border-right: none; border-bottom: none; }
    .reg.tr { top: 14px; right: 14px; border-left: none; border-bottom: none; }
    .reg.bl { bottom: 50px; left: 14px; border-right: none; border-top: none; }
    .reg.br { bottom: 50px; right: 14px; border-left: none; border-top: none; }

    @media (max-width: 900px) {
      .year { font-size: 120px; bottom: 18%; }
      .year-label { bottom: calc(18% + 120px + 8px); }
      .kana { font-size: 64px; }
      .sprite-stack { right: 8%; top: 26%; }
      .sprite-card { width: 124px; height: 184px; }
    }
  </style>
</head>
<body>
  <div class="stage" data-od-id="stage">

    <span class="reg tl"></span>
    <span class="reg tr"></span>
    <span class="reg bl"></span>
    <span class="reg br"></span>

    <div class="topbar" data-od-id="topbar">
      <div class="slug">
        <span class="jp">名次の番組</span>
        <span class="en">EP. 01 · NINTENDO TRIVIA</span>
      </div>
      <div class="progress">
        <span class="dots"><i class="on"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <span>01 / 12</span>
        <span class="rec">REC</span>
      </div>
    </div>

    <div class="kana" data-od-id="kana"><span>花</span><span>札</span></div>

    <div class="year-label" data-od-id="year-label">CHAPTER 01 · KYOTO · A PLAYING-CARD COMPANY</div>
    <div class="year" data-od-id="year">
      <span class="num">
        1889
        <span class="glitch" aria-hidden="true">1889</span>
      </span><span class="jp-suffix">年</span>
    </div>

    <div class="sprite-stack" data-od-id="sprite">
      <div class="sprite-card">
        <!-- Hanafuda card sprite — pixel-art flower -->
        <svg width="120" height="160" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" aria-label="Hanafuda card">
          <!-- background -->
          <rect x="0" y="0" width="24" height="32" fill="#f5efe2"/>
          <!-- moon glow -->
          <rect x="3" y="2" width="18" height="10" fill="#1a1614"/>
          <!-- moon -->
          <rect x="14" y="4" width="5" height="5" fill="#f7c95b"/>
          <rect x="13" y="5" width="1" height="3" fill="#f7c95b"/>
          <rect x="19" y="5" width="1" height="3" fill="#f7c95b"/>
          <!-- petals (red) -->
          <rect x="9" y="14" width="6" height="2" fill="#d92b1c"/>
          <rect x="7" y="16" width="10" height="2" fill="#d92b1c"/>
          <rect x="6" y="18" width="12" height="2" fill="#d92b1c"/>
          <rect x="7" y="20" width="10" height="2" fill="#d92b1c"/>
          <rect x="9" y="22" width="6" height="2" fill="#d92b1c"/>
          <!-- petal highlights -->
          <rect x="10" y="15" width="2" height="1" fill="#ff6b5e"/>
          <rect x="8" y="17" width="2" height="1" fill="#ff6b5e"/>
          <rect x="14" y="19" width="2" height="1" fill="#ff6b5e"/>
          <!-- center -->
          <rect x="11" y="18" width="2" height="2" fill="#f7c95b"/>
          <!-- stem / leaves -->
          <rect x="11" y="24" width="2" height="6" fill="#3b6b3b"/>
          <rect x="8" y="26" width="3" height="2" fill="#3b6b3b"/>
          <rect x="13" y="27" width="3" height="2" fill="#3b6b3b"/>
        </svg>
        <div class="sprite-tag">花<small>HANA · FLOWER</small></div>
      </div>
    </div>

    <div class="caption" data-od-id="caption">
      <strong>Nintendo started as a hanafuda maker.</strong>
      Founded in Kyoto by Fusajiro Yamauchi to print hand-painted playing
      cards. Mario wouldn&rsquo;t show up for another <em>ninety-six</em> years.
    </div>

    <div class="ribbon" data-od-id="ribbon">
      <div class="ribbon-track">
        <div class="tick"><span class="dot"></span><span class="label">1889</span><span class="note">HANAFUDA · KYOTO</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1907</span><span class="note">WESTERN CARDS</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1949</span><span class="note">YAMAUCHI III</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1977</span><span class="note">COLOR TV-GAME</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1985</span><span class="note">SUPER MARIO BROS.</span></div>
        <div class="tick"><span class="dot"></span><span class="label">2006</span><span class="note">WII</span></div>
        <div class="tick"><span class="dot"></span><span class="label">2017</span><span class="note">SWITCH</span></div>

        <div class="tick"><span class="dot"></span><span class="label">1889</span><span class="note">HANAFUDA · KYOTO</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1907</span><span class="note">WESTERN CARDS</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1949</span><span class="note">YAMAUCHI III</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1977</span><span class="note">COLOR TV-GAME</span></div>
        <div class="tick"><span class="dot"></span><span class="label">1985</span><span class="note">SUPER MARIO BROS.</span></div>
        <div class="tick"><span class="dot"></span><span class="label">2006</span><span class="note">WII</span></div>
        <div class="tick"><span class="dot"></span><span class="label">2017</span><span class="note">SWITCH</span></div>
      </div>
    </div>

  </div>
</body>
</html>

\`\`\``},{name:`team-okrs`,description:`OKR tracker page — quarter banner, three objectives with their key results as progress bars, owner avatars, status pills, and a "this quarter at a glance" sidebar. Use when the brief mentions "OKRs", "key results", "objectives", or "目标".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/team-okrs`,body:`# Team OKRs Skill

Produce a single-screen OKR tracker.

## Workflow

1. Read DESIGN.md.
2. Layout:
   - Quarter banner: Q4 FY25, dates, overall progress chip.
   - Three objective cards. Each has:
     - Objective title + owner avatar + status pill (On track / At risk / Off track)
     - 3 key results, each a row with metric / current → target / progress bar
   - Right sidebar: at-a-glance KPIs, top movers, blockers callout.
3. Clear progress visualisation, calm palette, one accent.

## Output contract

\`\`\`
<artifact identifier="okr-q4" type="text/html" title="OKRs Q4">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Northwind · Q4 FY25 OKRs</title>
<style>
  :root {
    --bg: #f5f6f9;
    --paper: #ffffff;
    --ink: #161924;
    --muted: #5d6678;
    --line: #e3e6ee;
    --accent: #2c4ee8;
    --accent-soft: #eaeefe;
    --positive: #1f8a5a;
    --warn: #b58522;
    --danger: #b13b3b;
    --display: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 14px; line-height: 1.55; }
  .app { display: grid; grid-template-columns: 1fr 320px; min-height: 100vh; }
  main { padding: 28px 32px 56px; min-width: 0; }
  aside.side { padding: 28px 28px 56px; background: var(--paper); border-left: 1px solid var(--line); }

  .crumb { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .quarter-banner { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 24px; padding: 28px 32px; background: linear-gradient(135deg, var(--ink), #2a3050); color: white; border-radius: 16px; margin: 6px 0 28px; }
  .quarter-banner h1 { margin: 6px 0 4px; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; }
  .quarter-banner .meta { color: rgba(255,255,255,0.72); font-size: 13.5px; }
  .qb-progress { text-align: right; }
  .qb-progress .num { font-size: 56px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: #b3c0ff; }
  .qb-progress .label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.6); margin-top: 4px; }

  /* Objective cards */
  .objectives { display: flex; flex-direction: column; gap: 16px; }
  .obj { background: var(--paper); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .obj-head { padding: 22px 26px; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto auto; gap: 18px; align-items: center; }
  .obj-title { display: flex; flex-direction: column; gap: 4px; }
  .obj-num { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .obj-name { font-size: 19px; font-weight: 600; letter-spacing: -0.005em; line-height: 1.35; max-width: 60ch; }
  .obj-owner { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); }
  .av { width: 30px; height: 30px; border-radius: 50%; color: white; font-size: 11.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .av-mr { background: linear-gradient(135deg, #d6336c, #ff7a9b); }
  .av-pb { background: linear-gradient(135deg, #b58522, #f1b13a); }
  .av-dp { background: linear-gradient(135deg, #2c4ee8, #6e85ff); }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-family: var(--mono); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.on-track { background: rgba(31,138,90,0.12); color: var(--positive); }
  .pill.at-risk { background: rgba(181,133,34,0.12); color: var(--warn); }
  .pill.off-track { background: rgba(177,59,59,0.12); color: var(--danger); }

  .krs { padding: 8px 0; }
  .kr { display: grid; grid-template-columns: 1fr 200px 110px; gap: 18px; padding: 16px 26px; border-top: 1px solid var(--line); align-items: center; }
  .kr:first-child { border-top: none; }
  .kr-name { font-size: 14px; }
  .kr-name strong { display: block; font-weight: 500; }
  .kr-name small { color: var(--muted); display: block; margin-top: 2px; font-family: var(--mono); font-size: 11px; }
  .kr-bar { height: 8px; background: var(--bg); border-radius: 999px; overflow: hidden; position: relative; }
  .kr-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--accent), #6e85ff); }
  .kr-fill.warn { background: linear-gradient(90deg, var(--warn), #f1b13a); }
  .kr-fill.danger { background: linear-gradient(90deg, var(--danger), #d8625e); }
  .kr-pct { font-family: var(--mono); font-size: 13px; font-weight: 600; text-align: right; }

  /* Sidebar */
  aside.side h3 { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 22px 0 12px; font-weight: 500; }
  aside.side h3:first-child { margin-top: 0; }
  .stat { display: flex; justify-content: space-between; padding: 10px 0; border-top: 1px dashed var(--line); font-size: 13.5px; }
  .stat:first-of-type { border-top: none; padding-top: 4px; }
  .stat strong { font-family: var(--mono); }
  .stat strong.up { color: var(--positive); }
  .stat strong.down { color: var(--danger); }

  .mover { display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; padding: 10px 0; border-top: 1px dashed var(--line); font-size: 13px; align-items: center; }
  .mover:first-of-type { border-top: none; padding-top: 0; }
  .mover .delta { font-family: var(--mono); font-size: 11.5px; color: var(--positive); }
  .mover .delta.down { color: var(--danger); }

  .blocker { padding: 16px; background: rgba(177,59,59,0.06); border: 1px solid rgba(177,59,59,0.2); border-radius: 10px; margin-top: 10px; }
  .blocker strong { color: var(--danger); }
  .blocker p { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }

  @media (max-width: 1080px) {
    .app { grid-template-columns: 1fr; }
    aside.side { border-left: none; border-top: 1px solid var(--line); }
    .obj-head { grid-template-columns: 1fr; }
    .kr { grid-template-columns: 1fr; }
    .kr-pct { text-align: left; }
  }
</style>
</head>
<body>
<div class="app">
  <main>
    <div class="crumb">Northwind / OKRs / FY25 / Q4</div>
    <div class="quarter-banner">
      <div>
        <h1>Q4 FY25 · Northwind</h1>
        <div class="meta">14 October → 31 December 2025 · Owner Devon Park · 3 objectives · 9 key results</div>
      </div>
      <div class="qb-progress">
        <div class="num">42%</div>
        <div class="label">Quarter through · 47% time elapsed</div>
      </div>
    </div>

    <section class="objectives">
      <article class="obj">
        <div class="obj-head">
          <div class="obj-title"><span class="obj-num">Objective 1</span><span class="obj-name">Make Northwind feel finished to the Enterprise buyer.</span></div>
          <div class="obj-owner"><span class="av av-mr">MR</span>Mira Reddy</div>
          <span class="pill on-track"><span class="dot"></span>On track</span>
        </div>
        <div class="krs">
          <div class="kr">
            <div class="kr-name"><strong>Close 3 of 3 stalled enterprise deals</strong><small>auth-gap blocker · sales: Devon</small></div>
            <div class="kr-bar"><span class="kr-fill" style="width: 67%"></span></div>
            <div class="kr-pct">2 of 3</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>Reach SOC 2 Type II readiness</strong><small>controls: 14 / 16 implemented</small></div>
            <div class="kr-bar"><span class="kr-fill" style="width: 88%"></span></div>
            <div class="kr-pct">88%</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>Ship workspace 2FA enforcement (TOTP + WebAuthn)</strong><small>M3 lands Dec 2 · Devon</small></div>
            <div class="kr-bar"><span class="kr-fill" style="width: 60%"></span></div>
            <div class="kr-pct">60%</div>
          </div>
        </div>
      </article>

      <article class="obj">
        <div class="obj-head">
          <div class="obj-title"><span class="obj-num">Objective 2</span><span class="obj-name">Cut time-to-value for new sign-ups in half.</span></div>
          <div class="obj-owner"><span class="av av-dp">DP</span>Devon Park</div>
          <span class="pill at-risk"><span class="dot"></span>At risk</span>
        </div>
        <div class="krs">
          <div class="kr">
            <div class="kr-name"><strong>Median activation time ≤ 30 min</strong><small>baseline 72 min · current 47 min</small></div>
            <div class="kr-bar"><span class="kr-fill warn" style="width: 64%"></span></div>
            <div class="kr-pct">64%</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>Activation rate ≥ 50% of new signups</strong><small>current 38% · last quarter 29%</small></div>
            <div class="kr-bar"><span class="kr-fill warn" style="width: 76%"></span></div>
            <div class="kr-pct">76%</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>Ship onboarding redesign v2 to 100%</strong><small>currently at 25% experiment</small></div>
            <div class="kr-bar"><span class="kr-fill warn" style="width: 25%"></span></div>
            <div class="kr-pct">25%</div>
          </div>
        </div>
      </article>

      <article class="obj">
        <div class="obj-head">
          <div class="obj-title"><span class="obj-num">Objective 3</span><span class="obj-name">Make the platform feel native on mobile.</span></div>
          <div class="obj-owner"><span class="av av-pb">PB</span>Priya Banerjee</div>
          <span class="pill off-track"><span class="dot"></span>Off track</span>
        </div>
        <div class="krs">
          <div class="kr">
            <div class="kr-name"><strong>Mobile DAU as % of total ≥ 35%</strong><small>current 22% · last quarter 19%</small></div>
            <div class="kr-bar"><span class="kr-fill danger" style="width: 22%"></span></div>
            <div class="kr-pct">22%</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>Ship redesigned mobile settings + auth surfaces</strong><small>scope locked Nov 1 · build started</small></div>
            <div class="kr-bar"><span class="kr-fill danger" style="width: 18%"></span></div>
            <div class="kr-pct">18%</div>
          </div>
          <div class="kr">
            <div class="kr-name"><strong>App Store rating ≥ 4.6 (currently 4.2)</strong><small>10-week rolling, requires sustained release cadence</small></div>
            <div class="kr-bar"><span class="kr-fill danger" style="width: 10%"></span></div>
            <div class="kr-pct">10%</div>
          </div>
        </div>
      </article>
    </section>
  </main>

  <aside class="side">
    <h3>This quarter at a glance</h3>
    <div class="stat"><span>Objectives on track</span><strong class="up">1 of 3</strong></div>
    <div class="stat"><span>Key results green</span><strong>4 of 9</strong></div>
    <div class="stat"><span>Days remaining</span><strong>53 of 78</strong></div>
    <div class="stat"><span>Risk score</span><strong class="down">Medium</strong></div>

    <h3>Top movers (this week)</h3>
    <div class="mover"><span class="av av-mr" style="width:24px;height:24px;font-size:9.5px;">MR</span><span>Enterprise deal #2 — closed</span><span class="delta">+33%</span></div>
    <div class="mover"><span class="av av-dp" style="width:24px;height:24px;font-size:9.5px;">DP</span><span>Activation rate · funnel B</span><span class="delta">+9 pp</span></div>
    <div class="mover"><span class="av av-pb" style="width:24px;height:24px;font-size:9.5px;">PB</span><span>Mobile signup completion</span><span class="delta down">−2.4%</span></div>

    <h3>Blockers</h3>
    <div class="blocker">
      <strong>Mobile O3 is off-track.</strong>
      <p>Two engineers were borrowed for the 2FA push. Either we drop the auth-surface redesign from O3, or we backfill with contractors by Nov 4. Decision needed Friday.</p>
    </div>
  </aside>
</div>
</body>
</html>

\`\`\``},{name:`tweaks`,description:`Wrap any HTML artifact with a side panel of live, parameterized controls — accent color, type scale, density, motion, theme — that rewrite CSS custom properties in real time and persist to localStorage. Lets the user explore variants of a design without re-prompting the agent. Use when the brief asks for "variants", "side-by-side options", "tweak this", "let me adjust", "live knobs", or "实时调参".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/tweaks`,body:`# Tweaks Skill · 参数化变体面板

Wrap any HTML artifact with a side panel of live controls that rewrite
CSS custom properties in real time and persist to \`localStorage\`.
Inspired by the *huashu-design* tweak pattern.

## What you produce

A single self-contained HTML file with two layers:

1. **Stage** — the original artifact (landing page / deck / dashboard)
   re-keyed so all visual decisions read from CSS custom properties:
   \`--accent\`, \`--scale\`, \`--density\`, \`--mode\`, \`--motion\`.
2. **Panel** — a fixed sidebar (or drawer on small viewports) with
   form controls bound to those custom properties via a tiny
   vanilla-JS bridge. Persists every change to \`localStorage\` keyed
   by the artifact identifier.

The user can:

- Open the artifact and see the stage rendered with their saved
  preferences (or sensible defaults).
- Adjust accent / scale / density / mode / motion in the panel and
  watch the stage update instantly — no rerender.
- Press <kbd>T</kbd> to hide / reveal the panel; <kbd>R</kbd> to
  reset to defaults.
- Refresh the page — every choice is persisted.

## When to use

- The user generated something they like 80% of, and wants to dial
  in the last 20% themselves.
- You're presenting a design system / brand and want the audience to
  feel the variants live (instead of you re-running the agent).
- You're shipping a stand-alone demo (e.g. a portfolio piece) and
  want viewers to play.

## When *not* to use

- One-shot artifacts that won't be iterated on (e.g. a runbook —
  parameters don't help).
- When the artifact's value is in fixed ratios (e.g. an infographic
  with carefully balanced data viz — knobs would degrade it).

## The 5 standard knobs

> Pick a subset that suits the artifact. Don't ship all 5 if only 2
> matter — clutter is a regression.

### 1. \`--accent\` — Accent color

A select with 5–8 curated swatches (don't ship a free color picker —
the user will pick a bad color and blame you).

\`\`\`js
const ACCENT_PRESETS = [
  { id: 'rust',    val: '#c96442', label: 'Rust' },
  { id: 'cobalt',  val: '#2c4d8e', label: 'Cobalt' },
  { id: 'sage',    val: '#4a7a3f', label: 'Sage' },
  { id: 'plum',    val: '#7a3f6a', label: 'Plum' },
  { id: 'graphite',val: '#3a3a3a', label: 'Graphite' },
];
\`\`\`

The artifact uses \`var(--accent)\` everywhere it had a hard-coded
accent before. Border / link / pull-quote rule / CTA all flip
together.

### 2. \`--scale\` — Type scale (0.85 / 1.0 / 1.15)

Three settings: *Compact* (0.85), *Normal* (1.0), *Generous* (1.15).
All \`font-size\` declarations multiply by \`var(--scale)\` via
\`calc(... * var(--scale))\`.

Don't go beyond ±15% — beyond that the layout breaks (column flow,
breakpoints, line counts).

### 3. \`--density\` — Layout density (Tight / Normal / Roomy)

Three settings that swap the spacing scale: *Tight* (0.75) /
*Normal* (1.0) / *Roomy* (1.4). All \`padding\` / \`gap\` / \`margin\`
declarations multiply by \`var(--density)\`.

This is the highest-impact knob — it's also the most fragile, so
**every layout-critical container must declare its base spacing in
custom properties** before you wrap.

### 4. \`--mode\` — Light / Dark

A 2-state toggle. Sets \`data-mode="light"\` vs \`"dark"\` on the
\`<html>\` element and the artifact's \`:root\` selector responds with
two color sets.

If the artifact already has a media-query-based dark mode, *replace*
it with the data-attr version — the user's choice should win over
their OS.

### 5. \`--motion\` — Off / Subtle / Lively

Three settings. Maps to a CSS variable \`--motion-mult\` that scales
all \`transition-duration\` / \`animation-duration\` declarations:

- *Off* — \`0s\` (also disables WebGL canvases / decorative animation).
- *Subtle* — \`1.0\` (the artifact's authored timing).
- *Lively* — \`1.6\` (slower transitions, more visible motion).

Respect \`prefers-reduced-motion\`: default to *Off* if the user has
that set, regardless of stored preference.

## Implementation primitives

Read \`assets/wrap.html\` — it ships the panel + bridge as an
inert template. Your job is to:

1. Take the user's existing artifact HTML.
2. Lift its accent / mode / spacing / scale into custom properties
   (search for hard-coded \`#hex\` / \`Npx\` / \`Nrem\` and convert).
3. Paste the contents into the marked region of \`wrap.html\`.
4. Edit \`assets/wrap.html\`'s \`KNOBS\` array to keep only the knobs
   you decided are relevant to *this* artifact. Don't ship 5 if 2
   matter.
5. Patch the \`STORAGE_KEY\` to a unique slug (\`tweaks-<artifact-slug>\`).

The bridge in \`wrap.html\`:
- Loads \`localStorage[STORAGE_KEY]\` JSON on first paint.
- Applies values as \`document.documentElement.style.setProperty('--accent', ...)\`.
- Listens to every form control's \`change\` event and writes back.
- Exposes <kbd>T</kbd> (toggle panel) and <kbd>R</kbd> (reset).

## Workflow

### Step 1 — Acquire the artifact

Same options as the critique skill:

1. Project file (\`index.html\` in the project folder).
2. Pasted HTML in the chat.
3. Generated by you in this turn.

### Step 2 — Decide which knobs apply

Read the artifact's CSS first. For each knob, decide *yes / no*:

- \`--accent\` — yes if the artifact has 1 accent color used ≥ 3 times.
- \`--scale\` — yes if the artifact is type-driven (article, deck,
  pricing page).
- \`--density\` — yes if the artifact has consistent gap / padding
  rhythm (deck, dashboard, landing). No for runbooks (already dense).
- \`--mode\` — yes if the artifact has authored dark mode tokens, or
  you're willing to derive them.
- \`--motion\` — yes if the artifact has any transition / animation
  worth scaling. No for static reports / critique reports.

Default: **3 knobs is the sweet spot.** Five is too busy, one is
not worth a panel.

### Step 3 — Lift hard-coded values into custom properties

Open \`assets/wrap.html\`'s \`<style>\` block — copy its custom-property
naming scheme (\`--accent\`, \`--scale\`, etc.). In the user's artifact,
find every place those concerns live and rewrite:

- \`color: #c96442\` → \`color: var(--accent)\`
- \`font-size: 18px\` → \`font-size: calc(18px * var(--scale))\`
- \`padding: 24px 32px\` → \`padding: calc(24px * var(--density)) calc(32px * var(--density))\`
- \`transition: opacity 200ms\` → \`transition: opacity calc(200ms * var(--motion-mult))\`

If the artifact uses \`clamp()\` or \`vw\` already, multiply the
*outer* value by the custom property — don't tear apart \`clamp(...)\`.

### Step 4 — Paste into the wrap

Copy the artifact's \`<style>\` and \`<body>\` into the marked regions
of \`wrap.html\`. Keep the panel + bridge intact.

### Step 5 — Test the loop

Open the result, click each knob at least once, refresh the page,
confirm the choice persists. If a knob breaks the layout —
*remove it*, don't ship it.

## Output contract

\`\`\`
<artifact identifier="tweaks-<artifact-slug>" type="text/html" title="<Artifact Title> · Tweaks">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact ("Wrapped X with a 3-knob tweak
panel — accent / scale / mode."). Stop after \`</artifact>\`.

## Hard rules

- **Don't ship a free color picker** — only curated swatches. Users
  pick bad colors when given freedom; saving them from that is the
  whole point.
- **Persist by artifact identifier** — \`tweaks-<slug>\`, not a global
  key. Two artifacts open in two tabs must not share state.
- **Respect \`prefers-reduced-motion\`** — default to *Off* for motion
  if the user has that set, override only on explicit click.
- **Single-file** — no external CSS / JS / fonts beyond the artifact's
  existing imports. Inline the panel + bridge.
- **Panel hidden by default on viewports < 720px** — slide-in drawer
  via a "T" button at top-right.
- **Don't ship more than 5 knobs.** Three is the sweet spot.

## Example

\`\`\`html
<!doctype html>
<html lang="en" data-mode="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Filebase · Tweaks demo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: #c96442;
      --scale: 1;
      --density: 1;
      --motion-mult: 1;

      --bg: #f6f4ef;
      --paper: #ffffff;
      --ink: #1a1a1c;
      --muted: #6b6964;
      --rule: #e2dfd7;

      --serif: 'Source Serif 4', Georgia, serif;
      --sans: 'Inter', -apple-system, system-ui, sans-serif;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    [data-mode="dark"] {
      --bg: #0e0d0c;
      --paper: #181715;
      --ink: #f4f1ea;
      --muted: #8a857a;
      --rule: #2a2723;
    }
    @media (prefers-reduced-motion: reduce) {
      :root { --motion-mult: 0; }
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: var(--sans);
      font-size: calc(16px * var(--scale));
      line-height: 1.55;
      transition: background calc(220ms * var(--motion-mult)) ease,
                  color calc(220ms * var(--motion-mult)) ease;
    }

    /* ============ Layout ============ */
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: calc(28px * var(--density)) calc(40px * var(--density));
    }

    /* ============ Header / nav ============ */
    .nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: calc(20px * var(--density)) 0;
      gap: calc(32px * var(--density));
      border-bottom: 1px solid var(--rule);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: var(--serif);
      font-weight: 700;
      font-size: calc(20px * var(--scale));
      letter-spacing: -0.01em;
    }
    .brand-mark {
      width: 28px; height: 28px;
      border-radius: 6px;
      background: var(--accent);
      transition: background calc(220ms * var(--motion-mult)) ease;
    }
    .nav-links {
      display: flex;
      gap: calc(28px * var(--density));
      font-size: calc(14px * var(--scale));
      color: var(--muted);
    }
    .nav-links a {
      color: inherit;
      text-decoration: none;
      transition: color calc(180ms * var(--motion-mult)) ease;
    }
    .nav-links a:hover { color: var(--ink); }
    .cta {
      display: inline-block;
      padding: calc(10px * var(--density)) calc(18px * var(--density));
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      font-size: calc(13px * var(--scale));
      font-weight: 600;
      letter-spacing: 0.02em;
      text-decoration: none;
      transition: background calc(220ms * var(--motion-mult)) ease,
                  transform calc(220ms * var(--motion-mult)) ease;
    }
    .cta:hover { transform: translateY(-1px); }

    /* ============ Hero ============ */
    .hero {
      padding: calc(96px * var(--density)) 0 calc(80px * var(--density));
      display: grid;
      grid-template-columns: 1.4fr 1fr;
      gap: calc(64px * var(--density));
      align-items: center;
    }
    @media (max-width: 880px) {
      .hero { grid-template-columns: 1fr; }
    }
    .eyebrow {
      font-family: var(--mono);
      font-size: calc(11px * var(--scale));
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: calc(22px * var(--density));
      transition: color calc(220ms * var(--motion-mult)) ease;
    }
    .h1 {
      font-family: var(--serif);
      font-weight: 700;
      font-size: calc(58px * var(--scale));
      line-height: 1.04;
      letter-spacing: -0.02em;
      margin: 0 0 calc(22px * var(--density));
    }
    .h1 em {
      font-style: italic;
      color: var(--accent);
      font-weight: 600;
      transition: color calc(220ms * var(--motion-mult)) ease;
    }
    .lede {
      font-size: calc(19px * var(--scale));
      color: var(--muted);
      max-width: 38ch;
      margin: 0 0 calc(36px * var(--density));
      line-height: 1.5;
    }
    .row { display: flex; gap: calc(14px * var(--density)); align-items: center; flex-wrap: wrap; }
    .secondary {
      font-size: calc(13px * var(--scale));
      color: var(--muted);
      font-family: var(--mono);
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    /* Hero card preview */
    .hero-card {
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: calc(20px * var(--density));
      box-shadow: 0 12px 40px rgba(0,0,0,0.06);
      font-family: var(--mono);
      font-size: calc(12px * var(--scale));
      transition: background calc(220ms * var(--motion-mult)) ease,
                  border-color calc(220ms * var(--motion-mult)) ease;
    }
    [data-mode="dark"] .hero-card { box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
    .hero-card .label {
      color: var(--muted);
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: calc(12px * var(--density));
      font-size: calc(10px * var(--scale));
    }
    .hero-card pre {
      margin: 0;
      padding: calc(14px * var(--density));
      background: var(--bg);
      border-radius: 6px;
      color: var(--ink);
      font-family: var(--mono);
      font-size: calc(12px * var(--scale));
      line-height: 1.55;
      overflow-x: auto;
    }
    .hero-card .k { color: var(--accent); }
    .hero-card .c { color: var(--muted); }
    .hero-card .ok { color: #4a7a3f; }
    [data-mode="dark"] .hero-card .ok { color: #8db876; }

    /* ============ Stats strip ============ */
    .stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: calc(32px * var(--density));
      padding: calc(48px * var(--density)) 0;
      border-top: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
    }
    @media (max-width: 720px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
    }
    .stat {
      display: flex;
      flex-direction: column;
      gap: calc(6px * var(--density));
    }
    .stat .num {
      font-family: var(--serif);
      font-weight: 700;
      font-size: calc(40px * var(--scale));
      line-height: 1;
      letter-spacing: -0.02em;
      color: var(--accent);
      transition: color calc(220ms * var(--motion-mult)) ease;
    }
    .stat .lbl {
      font-size: calc(13px * var(--scale));
      color: var(--muted);
      max-width: 22ch;
      line-height: 1.45;
    }

    /* ============ Features grid ============ */
    .features {
      padding: calc(80px * var(--density)) 0 calc(40px * var(--density));
    }
    .section-title {
      font-family: var(--serif);
      font-weight: 600;
      font-size: calc(34px * var(--scale));
      letter-spacing: -0.015em;
      margin: 0 0 calc(48px * var(--density));
      max-width: 22ch;
    }
    .feat-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: calc(28px * var(--density));
    }
    @media (max-width: 880px) {
      .feat-grid { grid-template-columns: 1fr; }
    }
    .feat {
      padding: calc(28px * var(--density));
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 10px;
      transition: background calc(220ms * var(--motion-mult)) ease,
                  border-color calc(220ms * var(--motion-mult)) ease,
                  transform calc(220ms * var(--motion-mult)) ease;
    }
    .feat:hover { transform: translateY(-2px); }
    .feat .ico {
      width: 36px; height: 36px;
      border-radius: 8px;
      background: color-mix(in oklch, var(--accent) 18%, transparent);
      color: var(--accent);
      display: grid;
      place-items: center;
      font-family: var(--serif);
      font-weight: 700;
      font-size: calc(15px * var(--scale));
      margin-bottom: calc(20px * var(--density));
    }
    .feat h3 {
      font-family: var(--serif);
      font-weight: 600;
      font-size: calc(20px * var(--scale));
      margin: 0 0 calc(8px * var(--density));
      letter-spacing: -0.01em;
    }
    .feat p {
      color: var(--muted);
      font-size: calc(15px * var(--scale));
      line-height: 1.55;
      margin: 0;
    }

    /* ============ CTA banner ============ */
    .banner {
      margin: calc(60px * var(--density)) 0 calc(40px * var(--density));
      padding: calc(56px * var(--density)) calc(48px * var(--density));
      background: var(--ink);
      color: var(--bg);
      border-radius: 14px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: calc(40px * var(--density));
      align-items: center;
      transition: background calc(220ms * var(--motion-mult)) ease,
                  color calc(220ms * var(--motion-mult)) ease;
    }
    @media (max-width: 720px) {
      .banner { grid-template-columns: 1fr; }
    }
    .banner h2 {
      font-family: var(--serif);
      font-weight: 600;
      font-size: calc(32px * var(--scale));
      letter-spacing: -0.015em;
      line-height: 1.15;
      margin: 0 0 calc(8px * var(--density));
      max-width: 22ch;
    }
    .banner p {
      color: rgba(244,241,234,0.68);
      font-size: calc(15px * var(--scale));
      margin: 0;
    }
    [data-mode="dark"] .banner p { color: rgba(26,26,28,0.68); }

    .ft {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      padding: calc(28px * var(--density)) 0;
      border-top: 1px solid var(--rule);
      font-family: var(--mono);
      font-size: calc(11px * var(--scale));
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }

    /* =========================================================
       PANEL  · same primitives as assets/wrap.html
       ========================================================= */
    .tw-panel {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 100;
      width: 280px;
      max-width: calc(100vw - 32px);
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.08);
      font-family: var(--sans);
      transition: transform calc(220ms * var(--motion-mult)) cubic-bezier(.2,.8,.2,1),
                  opacity calc(220ms * var(--motion-mult)) ease,
                  background calc(220ms * var(--motion-mult)) ease;
    }
    [data-mode="dark"] .tw-panel { box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .tw-panel.tw-hidden {
      transform: translateX(calc(100% + 32px));
      opacity: 0;
      pointer-events: none;
    }
    .tw-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      border-bottom: 1px solid var(--rule);
    }
    .tw-head .ttl {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .tw-head .toggle {
      background: transparent;
      border: 1px solid var(--rule);
      color: var(--muted);
      width: 24px; height: 24px;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--mono);
      font-size: 11px;
      padding: 0;
    }
    .tw-head .toggle:hover { color: var(--ink); }
    .tw-body { padding: 14px 18px 18px; }
    .tw-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    .tw-row:last-child { margin-bottom: 0; }
    .tw-row .lbl {
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .tw-seg {
      display: flex;
      border: 1px solid var(--rule);
      border-radius: 5px;
      overflow: hidden;
      background: var(--bg);
    }
    .tw-seg button {
      flex: 1;
      padding: 7px 8px;
      background: transparent;
      border: 0;
      border-left: 1px solid var(--rule);
      cursor: pointer;
      font-family: var(--sans);
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      transition: color calc(180ms * var(--motion-mult)) ease,
                  background calc(180ms * var(--motion-mult)) ease;
    }
    .tw-seg button:first-child { border-left: 0; }
    .tw-seg button:hover { color: var(--ink); }
    .tw-seg button[aria-pressed='true'] {
      background: var(--paper);
      color: var(--ink);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .tw-swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
    .tw-swatch {
      width: 100%; aspect-ratio: 1;
      border: 2px solid transparent;
      border-radius: 5px;
      cursor: pointer;
      padding: 0;
      transition: transform calc(160ms * var(--motion-mult)) ease,
                  border-color calc(160ms * var(--motion-mult)) ease;
    }
    .tw-swatch:hover { transform: scale(1.06); }
    .tw-swatch[aria-pressed='true'] { border-color: var(--ink); }
    .tw-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 18px;
      border-top: 1px solid var(--rule);
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .tw-foot button {
      background: transparent;
      border: 0;
      color: var(--muted);
      cursor: pointer;
      padding: 0;
      font: inherit;
      letter-spacing: inherit;
      text-transform: inherit;
    }
    .tw-foot button:hover { color: var(--ink); }
    kbd {
      font-family: var(--mono);
      font-size: 9px;
      padding: 2px 5px;
      border: 1px solid var(--rule);
      border-radius: 3px;
      color: var(--ink);
    }
    .tw-restore {
      position: fixed;
      top: 16px; right: 16px;
      z-index: 100;
      width: 36px; height: 36px;
      border-radius: 50%;
      border: 1px solid var(--rule);
      background: var(--paper);
      color: var(--ink);
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      transition: transform calc(180ms * var(--motion-mult)) ease;
    }
    .tw-restore:hover { transform: scale(1.06); }
    .tw-restore.tw-show { display: flex; }

    @media (max-width: 720px) {
      .tw-panel { left: 16px; right: 16px; width: auto; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <!-- Nav -->
    <nav class="nav">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Filebase</span>
      </div>
      <div class="nav-links">
        <a href="#">Product</a>
        <a href="#">Pricing</a>
        <a href="#">Docs</a>
        <a href="#">Changelog</a>
        <a href="#">Customers</a>
      </div>
      <a class="cta" href="#">Start free</a>
    </nav>

    <!-- Hero -->
    <header class="hero">
      <div>
        <div class="eyebrow">Series B · 2026</div>
        <h1 class="h1">The bandwidth bill is the <em>bug</em>.</h1>
        <p class="lede">A sync engine that ships only what changed. 38× less data over the wire on real customer workloads.</p>
        <div class="row">
          <a class="cta" href="#">Start free</a>
          <span class="secondary">no card required</span>
        </div>
      </div>
      <div class="hero-card">
        <div class="label">filebase sync — typical run</div>
<pre><span class="c">// hourly cron · feature/render-pass branch</span>
$ filebase sync --watch
<span class="k">→</span> diff:    <span class="ok">12.4 MB</span>  <span class="c">(of 4.7 GB)</span>
<span class="k">→</span> upload:  <span class="ok">8.2 MB</span>   <span class="c">(deduplicated)</span>
<span class="k">→</span> latency: <span class="ok">340 ms</span>   <span class="c">p99</span>
<span class="ok">✓ done in 2.1s</span></pre>
      </div>
    </header>

    <!-- Stats -->
    <section class="stats">
      <div class="stat">
        <div class="num">38×</div>
        <div class="lbl">less data moved over the wire vs naive sync</div>
      </div>
      <div class="stat">
        <div class="num">3,184</div>
        <div class="lbl">paying teams across post-production, design, ML</div>
      </div>
      <div class="stat">
        <div class="num">99.99%</div>
        <div class="lbl">uptime over the last 12 rolling months</div>
      </div>
      <div class="stat">
        <div class="num">$2.1M</div>
        <div class="lbl">aggregate egress savings reported by Q1 cohort</div>
      </div>
    </section>

    <!-- Features -->
    <section class="features">
      <h2 class="section-title">Three reasons teams switch in the first month.</h2>
      <div class="feat-grid">
        <article class="feat">
          <div class="ico" aria-hidden="true">∂</div>
          <h3>Block-level diffs</h3>
          <p>Edit one frame in a 4 GB Final Cut project; sync 12 MB. The diff doesn't care how big your file is — it cares what changed.</p>
        </article>
        <article class="feat">
          <div class="ico" aria-hidden="true">≈</div>
          <h3>Cross-region dedup</h3>
          <p>Your team in Berlin uploads a checkpoint your team in Tokyo already pushed. We notice. Nothing transfers.</p>
        </article>
        <article class="feat">
          <div class="ico" aria-hidden="true">∇</div>
          <h3>Drop-in for S3 / GCS</h3>
          <p>Wire one env var, change zero application code. Existing buckets, existing IAM, new bandwidth bill.</p>
        </article>
      </div>
    </section>

    <!-- CTA banner -->
    <section class="banner">
      <div>
        <h2>Pay for storage. Stop paying for movement.</h2>
        <p>Start free, no card required. Production teams in 14 days or fewer.</p>
      </div>
      <a class="cta" href="#" style="background: var(--accent); color: #fff;">Book a demo</a>
    </section>

    <footer class="ft">
      <span>© 2026 Filebase, Inc.</span>
      <span>Privacy · Terms · Status</span>
      <span>built with the OD tweaks skill</span>
    </footer>
  </div>

  <!-- ============ Tweak panel ============ -->
  <aside class="tw-panel" id="tw-panel" aria-label="Tweak panel">
    <header class="tw-head">
      <span class="ttl">Tweaks · Filebase</span>
      <button class="toggle" id="tw-close" aria-label="Hide panel" title="Hide (T)">×</button>
    </header>
    <div class="tw-body">
      <div class="tw-row">
        <span class="lbl">Accent</span>
        <div class="tw-swatches" id="tw-accent" role="radiogroup" aria-label="Accent color"></div>
      </div>
      <div class="tw-row">
        <span class="lbl">Mode</span>
        <div class="tw-seg" id="tw-mode" role="radiogroup" aria-label="Color mode">
          <button data-val="light" aria-pressed="true">Light</button>
          <button data-val="dark" aria-pressed="false">Dark</button>
        </div>
      </div>
      <div class="tw-row">
        <span class="lbl">Type scale</span>
        <div class="tw-seg" id="tw-scale" role="radiogroup" aria-label="Type scale">
          <button data-val="0.85" aria-pressed="false">Compact</button>
          <button data-val="1" aria-pressed="true">Normal</button>
          <button data-val="1.15" aria-pressed="false">Generous</button>
        </div>
      </div>
      <div class="tw-row">
        <span class="lbl">Density</span>
        <div class="tw-seg" id="tw-density" role="radiogroup" aria-label="Density">
          <button data-val="0.75" aria-pressed="false">Tight</button>
          <button data-val="1" aria-pressed="true">Normal</button>
          <button data-val="1.4" aria-pressed="false">Roomy</button>
        </div>
      </div>
      <div class="tw-row">
        <span class="lbl">Motion</span>
        <div class="tw-seg" id="tw-motion" role="radiogroup" aria-label="Motion">
          <button data-val="0" aria-pressed="false">Off</button>
          <button data-val="1" aria-pressed="true">Subtle</button>
          <button data-val="1.6" aria-pressed="false">Lively</button>
        </div>
      </div>
    </div>
    <footer class="tw-foot">
      <span><kbd>T</kbd> hide · <kbd>R</kbd> reset</span>
      <button id="tw-reset" type="button">Reset</button>
    </footer>
  </aside>

  <button class="tw-restore" id="tw-restore" aria-label="Show panel" title="Show panel (T)">T</button>

  <script>
    const STORAGE_KEY = 'tweaks-filebase-example';
    const ACCENT_PRESETS = [
      { id: 'rust',     val: '#c96442' },
      { id: 'cobalt',   val: '#2c4d8e' },
      { id: 'sage',     val: '#4a7a3f' },
      { id: 'plum',     val: '#7a3f6a' },
      { id: 'graphite', val: '#3a3a3a' },
    ];
    const DEFAULTS = {
      accent: ACCENT_PRESETS[0].val,
      mode: 'light',
      scale: 1,
      density: 1,
      motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1,
    };

    function load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        return { ...DEFAULTS, ...JSON.parse(raw) };
      } catch { return { ...DEFAULTS }; }
    }
    function save(s) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
    }

    function applyState(s) {
      const r = document.documentElement;
      r.style.setProperty('--accent', s.accent);
      r.style.setProperty('--scale', s.scale);
      r.style.setProperty('--density', s.density);
      r.style.setProperty('--motion-mult', s.motion);
      r.setAttribute('data-mode', s.mode);
      paintAccent(s.accent);
      paintSeg('tw-mode', s.mode);
      paintSeg('tw-scale', String(s.scale));
      paintSeg('tw-density', String(s.density));
      paintSeg('tw-motion', String(s.motion));
    }
    function paintAccent(val) {
      document.querySelectorAll('#tw-accent button').forEach((b) =>
        b.setAttribute('aria-pressed', b.dataset.val === val ? 'true' : 'false'),
      );
    }
    function paintSeg(id, val) {
      document.querySelectorAll('#' + id + ' button').forEach((b) =>
        b.setAttribute('aria-pressed', b.dataset.val === val ? 'true' : 'false'),
      );
    }

    function buildAccent(state) {
      const host = document.getElementById('tw-accent');
      host.innerHTML = '';
      for (const p of ACCENT_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tw-swatch';
        b.dataset.val = p.val;
        b.setAttribute('aria-label', p.id);
        b.style.background = p.val;
        b.addEventListener('click', () => {
          state.accent = p.val;
          save(state); applyState(state);
        });
        host.appendChild(b);
      }
    }
    function bindSeg(id, key, parser) {
      document.getElementById(id).addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-val]');
        if (!btn) return;
        state[key] = parser ? parser(btn.dataset.val) : btn.dataset.val;
        save(state); applyState(state);
      });
    }

    const state = load();
    buildAccent(state);
    bindSeg('tw-mode', 'mode');
    bindSeg('tw-scale', 'scale', parseFloat);
    bindSeg('tw-density', 'density', parseFloat);
    bindSeg('tw-motion', 'motion', parseFloat);
    applyState(state);

    const panel = document.getElementById('tw-panel');
    const restore = document.getElementById('tw-restore');
    function setPanelVisible(v) {
      panel.classList.toggle('tw-hidden', !v);
      restore.classList.toggle('tw-show', !v);
    }
    document.getElementById('tw-close').addEventListener('click', () => setPanelVisible(false));
    restore.addEventListener('click', () => setPanelVisible(true));
    document.getElementById('tw-reset').addEventListener('click', () => {
      Object.assign(state, DEFAULTS);
      save(state); applyState(state);
    });

    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.matches('input, textarea, select, [contenteditable]')) return;
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setPanelVisible(panel.classList.contains('tw-hidden'));
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        Object.assign(state, DEFAULTS);
        save(state); applyState(state);
      }
    });
  <\/script>
</body>
</html>

\`\`\``},{name:`video-shortform`,description:`Short-form video generation skill — 3-10 second clips for product reveals, motion teasers, ambient loops. Defaults to Seedance 2 but works the same with Kling 3 / 4, Veo 3 or Sora 2. Output is one MP4 saved to the project folder. When the workspace also ships an interactive-video / hyperframes skill, prefer composing several short shots into a single timeline rather than one long monolithic clip.`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/video-shortform`,body:`# Video Shortform Skill

Short-form (≤ 10s) is the sweet spot for current text-to-video models —
they're great at one **shot** with one **idea**, weaker at multi-cut
narratives. Plan one shot per call.

Special case: \`hyperframes-html\` is **not** a photoreal text-to-video
model. It's a local HTML-to-MP4 renderer. For that model, do not roleplay
cinematography or "real-world" camera physics. Treat the brief as a motion
design card / title-frame / product interstitial, ask at most one
clarifying question, then dispatch immediately.

## Resource map

\`\`\`
video-shortform/
├── SKILL.md
└── example.html
\`\`\`

## Workflow

### Step 0 — Read the project metadata

\`videoModel\`, \`videoLength\` (seconds), \`videoAspect\`. These are
hard-locks — clamp the prompt to whatever the chosen model supports
(Seedance 2 caps at 10s; Kling 4 supports up to 10s + image-to-video;
Veo 3 supports 8s with audio).

### Step 1 — Plan the shot

Write the shotlist BEFORE calling the model:

| Slot | Content |
|---|---|
| Subject | What's in frame? |
| Camera | Static / pan / push-in / orbit? |
| Lighting | Key direction + temperature |
| Motion | What moves, at what pace? Subject motion vs camera motion. |
| Sound | Ambient bed? (only if the model supports audio) |

Normally, show this to the user as a one-sentence plan before
dispatching — they can redirect cheaply.

For \`hyperframes-html\`, skip the extra pre-dispatch narration once the
user has answered the discovery form. Collapse the plan into the actual
generation prompt and dispatch immediately.

### Step 2 — Compose the prompt

Use the format the upstream model prefers (Seedance: motion + camera +
mood; Kling: subject + camera + style; Veo: subject + cinematography +
sound). Bind the project's \`videoAspect\` and \`videoLength\` directly to
the API parameters; never put them in prose.

For \`hyperframes-html\`, write a concise motion-design brief instead of a
camera-realism prompt. Focus on subject, layout, palette, motion
character, and overall tone. Do not spend turns narrating environment
checks, missing side files, or "I am about to dispatch" status updates.

### Step 3 — Dispatch via the media contract

Use the unified dispatcher — do **not** call provider APIs by hand:

\`\`\`bash
node "$OD_BIN" media generate \\
  --project "$OD_PROJECT_ID" \\
  --surface video \\
  --model "<videoModel from metadata>" \\
  --aspect "<videoAspect from metadata>" \\
  --length <videoLength seconds> \\
  --output "<short-slug>-<seconds>s.mp4" \\
  --prompt "<assembled shot prompt from Step 2>"
\`\`\`

The command prints one line of JSON: \`{"file": {"name": "...", ...}}\`.
The bytes land in the project; the FileViewer plays it automatically.

### Step 4 — Hand off

Reply with: shot summary, the filename returned by the dispatcher, and
one sentence on what to try if the user wants a variation.

For \`hyperframes-html\`, keep the reply especially short: what was
rendered, the filename, and one concrete variation idea.

## Hard rules

- One shot per turn. Multi-shot timelines belong in a hyperframes /
  interactive-video skill, not here.
- Match \`videoAspect\` exactly — re-renders are slow.
- Never ship a video without saving the file — the user expects
  something to play in the file viewer.
- When the underlying model fails (NSFW filter, content policy,
  timeout), report the error verbatim. Don't silently retry.
- Do not claim a render has been "sent", "started", or "is running"
  unless you have already called \`od media generate\`.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Short-form video — example</title>
    <style>
      :root {
        --bg: #0e0d0c;
        --panel: #1a1816;
        --ink: #f5efe5;
        --muted: #8b8579;
        --accent: #c96442;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
        font-family: 'Iowan Old Style', 'Charter', Georgia, serif; }
      body { min-height: 100dvh; display: grid; place-items: center; padding: 32px; }
      .stage {
        width: min(720px, 92vw);
        background: var(--panel);
        border-radius: 8px;
        padding: 22px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.45);
      }
      .frame {
        position: relative;
        aspect-ratio: 16 / 9;
        border-radius: 6px;
        overflow: hidden;
        background:
          radial-gradient(circle at 30% 35%, #d8b08b 0%, #6f4a35 40%, #1a120c 80%);
      }
      .frame::after {
        content: ''; position: absolute; inset: 0;
        background: repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 4px);
        pointer-events: none;
        animation: scan 12s linear infinite;
      }
      @keyframes scan { from { background-position-y: 0; } to { background-position-y: 200px; } }
      .frame .mug {
        position: absolute; left: 50%; top: 56%; transform: translate(-50%, -50%);
        width: 28%; aspect-ratio: 1 / 1;
        background: radial-gradient(ellipse at 35% 35%, #f5efe5 0%, #c2b8a7 50%, #6f6757 100%);
        border-radius: 18% 18% 22% 22% / 28% 28% 18% 18%;
        box-shadow: 18px 6px 30px rgba(0,0,0,0.45);
        animation: turn 6s ease-in-out infinite alternate;
      }
      .frame .mug::after {
        content: ''; position: absolute; right: -14%; top: 28%;
        width: 18%; height: 44%;
        border: 6px solid #c2b8a7; border-left: none; border-radius: 0 100% 100% 0 / 0 50% 50% 0;
      }
      @keyframes turn { from { transform: translate(-50%, -50%) rotate(-6deg); } to { transform: translate(-50%, -50%) rotate(6deg); } }
      .frame .timecode {
        position: absolute; left: 14px; bottom: 12px;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 11px; letter-spacing: 0.16em;
        color: var(--muted);
        background: rgba(0,0,0,0.4);
        padding: 4px 8px; border-radius: 999px;
      }
      .frame .badge {
        position: absolute; left: 14px; top: 12px;
        font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        font-size: 10.5px; letter-spacing: 0.2em; text-transform: uppercase;
        color: var(--accent);
      }
      .meta {
        display: grid; grid-template-columns: 1fr auto; gap: 10px;
        align-items: end; margin-top: 18px;
      }
      .title { font-size: 22px; line-height: 1.1; margin: 0; }
      .sub { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="frame">
        <span class="badge">● REC</span>
        <div class="mug" aria-hidden></div>
        <span class="timecode">00:05 · 16:9 · seedance-2</span>
      </div>
      <div class="meta">
        <h1 class="title">A 5-second product reveal — saved as MP4.</h1>
        <span class="sub">Open Design · Video</span>
      </div>
    </div>
  </body>
</html>

\`\`\``},{name:`weekly-update`,description:`Single-file horizontal-swipe slide deck for a weekly team update — shipped, in flight, blocked, metrics, asks. 6–8 slides. Use when the brief mentions "weekly update", "team update slides", "weekly status", "周报演示".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/weekly-update`,body:`# Weekly Update Deck Skill

Produce a single-file horizontal-swipe HTML deck for a weekly team update.

## Workflow

1. Read DESIGN.md.
2. Identify squad name, week range, and audience (squad-internal vs cross-functional).
3. Slides:
   1. Cover (squad + week + author + date)
   2. Headline (one sentence + one number that matters this week)
   3. What shipped (3–5 items, link-style affordance)
   4. In flight (3–5 items, owner avatars)
   5. Blocked (1–3 items + clear ask)
   6. Metrics that matter (1–2 inline charts)
   7. Asks for next week (named owners)
   8. Closing + thanks
4. Arrow keys or click navigation. Each slide is 100vw wide.

## Output contract

\`\`\`
<artifact identifier="weekly-update-w42" type="text/html" title="Weekly Update — Growth · W42">
<!doctype html>...</artifact>
\`\`\`

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Growth · Weekly update · W42</title>
<style>
  :root {
    --bg: #0e0d12;
    --paper: #19171f;
    --paper-2: #221f2a;
    --ink: #f4f0e6;
    --muted: #a09aaf;
    --line: #2c2935;
    --accent: #ffcc4d;
    --accent-2: #b388ff;
    --display: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --mono: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: var(--display); }
  body { overflow: hidden; }
  .deck {
    display: flex;
    width: 100vw; height: 100vh;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    scrollbar-width: none;
  }
  .deck::-webkit-scrollbar { display: none; }
  .slide {
    flex: 0 0 100vw; height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 56px 80px;
    scroll-snap-align: start;
    position: relative;
  }
  .slide-inner { width: 100%; max-width: 1100px; }
  .crumb {
    position: absolute; top: 24px; left: 32px;
    font-family: var(--mono); font-size: 11px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .pageno {
    position: absolute; bottom: 24px; right: 32px;
    font-family: var(--mono); font-size: 11px; color: var(--muted);
  }
  .nav {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 6px; z-index: 5;
  }
  .nav .dot {
    width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.2);
    cursor: pointer;
  }
  .nav .dot.active { background: var(--accent); }

  /* Cover */
  .cover { display: flex; flex-direction: column; gap: 28px; }
  .cover .badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: var(--paper); border: 1px solid var(--line); align-self: flex-start; font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .cover .badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .cover h1 { font-size: clamp(56px, 8vw, 110px); margin: 0; line-height: 0.96; letter-spacing: -0.03em; font-weight: 800; }
  .cover h1 em { font-style: normal; color: var(--accent); }
  .cover .meta { display: flex; gap: 36px; color: var(--muted); font-family: var(--mono); font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; }

  /* Headline */
  .headline { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: center; }
  .headline-num { font-size: clamp(120px, 18vw, 220px); line-height: 0.9; letter-spacing: -0.04em; font-weight: 800; color: var(--accent); }
  .headline-num small { display: block; font-size: 18px; color: var(--muted); font-weight: 400; letter-spacing: 0; margin-top: 12px; font-family: var(--mono); text-transform: uppercase; }
  .headline-text h2 { font-size: 44px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 18px; font-weight: 700; }
  .headline-text p { color: var(--muted); font-size: 18px; max-width: 36ch; line-height: 1.5; }

  /* Section title */
  .section-title { font-size: clamp(32px, 4vw, 56px); margin: 0 0 36px; line-height: 1.05; letter-spacing: -0.02em; font-weight: 700; }
  .section-title em { font-style: normal; color: var(--accent); }

  /* Lists of items */
  .item-list { display: flex; flex-direction: column; gap: 14px; }
  .item { display: grid; grid-template-columns: auto 1fr auto; gap: 22px; align-items: center; padding: 22px 26px; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; }
  .item-num { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .item-title { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .item-meta { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .av-row { display: flex; }
  .av { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--paper); margin-left: -8px; font-size: 11px; font-weight: 700; color: var(--bg); display: inline-flex; align-items: center; justify-content: center; background: var(--accent); }
  .av:first-child { margin-left: 0; }
  .av-2 { background: var(--accent-2); color: white; }
  .av-3 { background: #ff6f91; color: white; }

  /* Blocked */
  .blocked-block { padding: 36px 40px; background: linear-gradient(135deg, rgba(255,111,145,0.18), rgba(255,204,77,0.08)); border: 1px solid rgba(255,111,145,0.4); border-radius: 18px; }
  .blocked-block h3 { font-size: 28px; margin: 0 0 8px; letter-spacing: -0.01em; }
  .blocked-block p { color: var(--muted); margin: 0 0 18px; font-size: 16px; }
  .blocked-ask { display: inline-flex; padding: 10px 22px; background: var(--accent); color: var(--bg); border-radius: 999px; font-weight: 600; font-size: 14px; }

  /* Charts */
  .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .chart { padding: 28px; background: var(--paper); border: 1px solid var(--line); border-radius: 16px; }
  .chart h4 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
  .chart .sub { font-family: var(--mono); font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .chart svg { width: 100%; height: 220px; display: block; margin-top: 16px; }
  .big-num { font-size: 72px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; color: var(--accent); margin-top: 16px; }
  .delta { font-family: var(--mono); font-size: 13px; color: var(--accent); margin-top: 8px; }
  .delta.warn { color: #ff6f91; }

  /* Asks */
  .asks { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .ask { padding: 28px; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; display: flex; flex-direction: column; gap: 14px; }
  .ask .who { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.06em; }
  .ask h3 { font-size: 22px; line-height: 1.25; margin: 0; letter-spacing: -0.01em; }
  .ask p { margin: 0; color: var(--muted); font-size: 14.5px; line-height: 1.5; }

  /* Closer */
  .closer { display: flex; flex-direction: column; gap: 28px; align-items: flex-start; }
  .closer h2 { font-size: clamp(44px, 6vw, 84px); margin: 0; line-height: 1.05; letter-spacing: -0.025em; font-weight: 800; }
  .closer h2 em { font-style: normal; color: var(--accent); }
  .closer p { color: var(--muted); font-size: 18px; max-width: 56ch; }
  .closer .signature { display: flex; align-items: center; gap: 14px; padding-top: 24px; border-top: 1px solid var(--line); width: 100%; }
  .closer .signature .av { width: 44px; height: 44px; font-size: 16px; }
  .closer .signature strong { display: block; font-size: 16px; }
  .closer .signature span { color: var(--muted); font-size: 13px; }

  @media (max-width: 760px) {
    .slide { padding: 48px 28px; }
    .headline { grid-template-columns: 1fr; }
    .chart-grid, .asks { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="deck" id="deck">

  <!-- 1. Cover -->
  <section class="slide">
    <span class="crumb">Growth squad · weekly</span>
    <div class="slide-inner cover">
      <div class="badge"><span class="dot"></span>Week 42 · 14 → 18 Oct</div>
      <h1>Hello, week <em>forty&#8209;two</em>.</h1>
      <div class="meta">
        <span>Author · Devon Park</span>
        <span>Audience · Squad + leadership</span>
        <span>5 min read</span>
      </div>
    </div>
    <span class="pageno">01 / 08</span>
  </section>

  <!-- 2. Headline number -->
  <section class="slide">
    <span class="crumb">Headline</span>
    <div class="slide-inner headline">
      <div class="headline-num">+22%<small>Net new MRR vs Q3 weekly avg</small></div>
      <div class="headline-text">
        <h2>The week the funnel started feeling fast again.</h2>
        <p>Onboarding completion is up 9 pp, signup→activation cut to 47 minutes from 1h12, and we shipped the first piece of the 2FA workstream.</p>
      </div>
    </div>
    <span class="pageno">02 / 08</span>
  </section>

  <!-- 3. Shipped -->
  <section class="slide">
    <span class="crumb">What shipped</span>
    <div class="slide-inner">
      <h2 class="section-title">Shipped, <em>top to bottom</em>.</h2>
      <div class="item-list">
        <div class="item"><span class="item-num">01</span><span class="item-title">TOTP enrollment in member settings</span><span class="item-meta">NW-201 · Devon</span></div>
        <div class="item"><span class="item-num">02</span><span class="item-title">Onboarding empty-state illustrations</span><span class="item-meta">NW-241 · Mira</span></div>
        <div class="item"><span class="item-num">03</span><span class="item-title">Audit-log entries for auth events</span><span class="item-meta">NW-198 · Priya</span></div>
        <div class="item"><span class="item-num">04</span><span class="item-title">Workspace-switcher scroll-reset fix</span><span class="item-meta">NW-233 · Caleb</span></div>
      </div>
    </div>
    <span class="pageno">03 / 08</span>
  </section>

  <!-- 4. In flight -->
  <section class="slide">
    <span class="crumb">In flight</span>
    <div class="slide-inner">
      <h2 class="section-title">In flight, <em>landing soon</em>.</h2>
      <div class="item-list">
        <div class="item"><span class="item-num">01</span><span class="item-title">Recovery codes — generate, download, regenerate</span><div class="av-row"><span class="av">PB</span></div></div>
        <div class="item"><span class="item-num">02</span><span class="item-title">2FA challenge step — visual + microcopy</span><div class="av-row"><span class="av av-2">MR</span><span class="av">SL</span></div></div>
        <div class="item"><span class="item-num">03</span><span class="item-title">Settings nav restructure (left rail)</span><div class="av-row"><span class="av av-2">MR</span></div></div>
        <div class="item"><span class="item-num">04</span><span class="item-title">Audit-writer backlog dashboard</span><div class="av-row"><span class="av av-3">CA</span></div></div>
      </div>
    </div>
    <span class="pageno">04 / 08</span>
  </section>

  <!-- 5. Blocked -->
  <section class="slide">
    <span class="crumb">Blocked</span>
    <div class="slide-inner">
      <h2 class="section-title">One thing's <em>stuck</em>.</h2>
      <div class="blocked-block">
        <h3>Brand copy review for the 2FA challenge step.</h3>
        <p>Sasha needs Brand to review the new microcopy by Wednesday EOD or M2 (Nov 18) slips. The doc is tagged in <code style="font-family: var(--mono);">#brand-reviews</code>; we just need eyes.</p>
        <span class="blocked-ask">Ask: Brand — please review by Wed</span>
      </div>
    </div>
    <span class="pageno">05 / 08</span>
  </section>

  <!-- 6. Metrics -->
  <section class="slide">
    <span class="crumb">Metrics</span>
    <div class="slide-inner">
      <h2 class="section-title">Metrics that <em>moved</em>.</h2>
      <div class="chart-grid">
        <div class="chart">
          <h4>Activation rate · 4-week trailing</h4>
          <div class="sub">Higher is better</div>
          <svg viewBox="0 0 600 220" preserveAspectRatio="none">
            <defs><linearGradient id="lg1" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ffcc4d" stop-opacity="0.4"/><stop offset="100%" stop-color="#ffcc4d" stop-opacity="0"/></linearGradient></defs>
            <polygon fill="url(#lg1)" points="20,210 20,160 110,150 200,140 290,124 380,108 470,80 560,52 580,52 580,210" />
            <polyline fill="none" stroke="#ffcc4d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"
              points="20,160 110,150 200,140 290,124 380,108 470,80 560,52" />
            <circle cx="560" cy="52" r="5" fill="#ffcc4d"/>
          </svg>
          <div class="big-num">38%</div>
          <div class="delta">▲ +9 pp this week</div>
        </div>
        <div class="chart">
          <h4>Time-to-activation · median</h4>
          <div class="sub">Lower is better</div>
          <svg viewBox="0 0 600 220" preserveAspectRatio="none">
            <defs><linearGradient id="lg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#b388ff" stop-opacity="0.4"/><stop offset="100%" stop-color="#b388ff" stop-opacity="0"/></linearGradient></defs>
            <polygon fill="url(#lg2)" points="20,210 20,60 110,72 200,90 290,108 380,124 470,148 560,164 580,164 580,210" />
            <polyline fill="none" stroke="#b388ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"
              points="20,60 110,72 200,90 290,108 380,124 470,148 560,164" />
            <circle cx="560" cy="164" r="5" fill="#b388ff"/>
          </svg>
          <div class="big-num" style="color: #b388ff;">47 min</div>
          <div class="delta">▼ −25 min this week</div>
        </div>
      </div>
    </div>
    <span class="pageno">06 / 08</span>
  </section>

  <!-- 7. Asks -->
  <section class="slide">
    <span class="crumb">Asks</span>
    <div class="slide-inner">
      <h2 class="section-title">Asks for <em>next week</em>.</h2>
      <div class="asks">
        <div class="ask">
          <div class="who"><span class="av av-2">SL</span>Brand</div>
          <h3>Review the 2FA challenge microcopy by Wednesday EOD.</h3>
          <p>Doc is tagged in <code style="font-family: var(--mono);">#brand-reviews</code>. Without it, M2 ships late and the Pioneer deal slips.</p>
        </div>
        <div class="ask">
          <div class="who"><span class="av av-3">PB</span>Security</div>
          <h3>Pair on the KMS rotation rehearsal Thursday 14:00.</h3>
          <p>30 minutes. We want to dry-run the procedure before we touch prod next quarter.</p>
        </div>
        <div class="ask">
          <div class="who"><span class="av">DP</span>Sales</div>
          <h3>Loop us in to the Pioneer security review call.</h3>
          <p>We can answer the 2FA questions live; will save a round-trip.</p>
        </div>
        <div class="ask">
          <div class="who"><span class="av av-2">MR</span>Research</div>
          <h3>Five recruits for the Enterprise admin study by next Friday.</h3>
          <p>Existing customers preferred. We have an Airtable form ready.</p>
        </div>
      </div>
    </div>
    <span class="pageno">07 / 08</span>
  </section>

  <!-- 8. Closing -->
  <section class="slide">
    <span class="crumb">Thanks</span>
    <div class="slide-inner closer">
      <h2>That's the <em>week</em>.</h2>
      <p>Thanks for the focus. The 2FA push is paying off and the funnel work landed harder than I expected. Special thanks to Mira for the empty-state work — small change, big lift on activation.</p>
      <div class="signature">
        <span class="av">DP</span>
        <div><strong>Devon Park</strong><span>Growth squad lead · ping me in #growth-squad</span></div>
      </div>
    </div>
    <span class="pageno">08 / 08</span>
  </section>
</div>

<div class="nav" id="nav"></div>

<script>
  const deck = document.getElementById('deck');
  const slides = deck.querySelectorAll('.slide');
  const nav = document.getElementById('nav');
  slides.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'dot' + (i === 0 ? ' active' : '');
    d.addEventListener('click', () => deck.scrollTo({ left: window.innerWidth * i, behavior: 'smooth' }));
    nav.appendChild(d);
  });
  function activeIndex() {
    return Math.round(deck.scrollLeft / window.innerWidth);
  }
  deck.addEventListener('scroll', () => {
    const idx = activeIndex();
    nav.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    const idx = activeIndex();
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      const next = Math.min(slides.length - 1, idx + 1);
      deck.scrollTo({ left: window.innerWidth * next, behavior: 'smooth' });
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      const prev = Math.max(0, idx - 1);
      deck.scrollTo({ left: window.innerWidth * prev, behavior: 'smooth' });
    }
  });
<\/script>
</body>
</html>

\`\`\``},{name:`wireframe-sketch`,description:`A hand-drawn wireframe exploration — graph-paper background, marker / pencil tone, multiple tab labels for variants, sticky-note annotations, scribbled chart placeholders, hatched fills. Reads like a designer's whiteboard before any pixels are committed. Use when the brief asks for "wireframe", "sketch wireframe", "hand-drawn", "lo-fi", "whiteboard", "草稿", or "手绘原型".`,publisher:`nexu-io`,collection:`nexu-io/open-design skills`,repo:`nexu-io/open-design`,sourceUrl:`https://github.com/nexu-io/open-design/tree/main/skills/wireframe-sketch`,body:`# Wireframe Sketch Skill

Produce a single hand-drawn wireframe page. The whole point is "this is a
sketch" — looseness is the brand. Lean into pencil/marker tones, hatched
fills, dashed borders, slight rotations.

## Workflow

1. **Skip the DESIGN.md** if it pushes for finished UI. This skill explicitly
   wants a low-fidelity look. Only honor type tokens loosely (system serif
   for headlines, mono for annotations, marker font fallback).
2. **Pick the screen variants** from the brief — typically 3–4 tab labels
   like "01 · A · ORGANIZED", "02 · B · DASHBOARD", etc. One is "active",
   the rest are inactive sketch tabs.
3. **Layout**, in order:
   - **Page header** — bold serif title with a fake "WIREFRAME v0.1" tag
     pinned next to it (dashed border, slight rotation). Below: one-line
     subtitle in marker italic + a date / device / fidelity dateline on
     the right in mono.
   - **Tab strip** — 4–5 labels with marker check-square glyphs. The active
     one has a highlighter swipe behind it (yellow / orange tint + slight
     skew).
   - **Sketch canvas** — a graph-paper card (background: 24px × 24px grid
     drawn with \`linear-gradient\` lines), with a thick rounded border drawn
     to look like a sharpie line.
   - **Browser chrome row** — three sketched circles + a fake URL bar with
     a hand-written-style URL.
   - **Sidebar nav** — sketched checkbox + label for each nav item, marker
     italic. One has a highlighter line through it (active).
   - **KPI tiles** — 3–4 boxes, each with a chunky scribbled number in a
     marker-style stroke, a tiny accent stamp, and a one-line label.
   - **Chart placeholder** — a card with a hand-drawn axis and a wobbly
     polyline. Add 3–4 dot markers.
   - **Bar chart placeholder** — a card with hatched-fill rectangles of
     varying heights.
   - **Sticky notes** — 1–2 yellow / pink notes with marker text, taped
     with a slightly rotated band, pinned over key regions to call out
     "next step", "page-1", or "needs review".
4. **Write** a single HTML document:
   - \`<!doctype html>\` through \`</html>\`, CSS inline.
   - Use the system's available "Caveat", "Patrick Hand", or "Architects
     Daughter" fonts via Google Fonts; otherwise fall back to italic serif.
   - Slight rotations everywhere (\`transform: rotate(-0.6deg)\`) to break
     the grid and feel hand-drawn.
   - \`data-od-id\` on header, tabs, sidebar, KPIs, chart, bar-chart,
     sticky notes.
5. **Self-check**:
   - The page should *not* look pixel-perfect. If it does, you over-rendered.
   - Marker / pencil + graph paper + hatched fills + sticky notes are all
     present; if any is missing, add it.
   - The active tab has the highlighter swipe; the others don't.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="wireframe-slug" type="text/html" title="Wireframe — Title">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

One sentence before the artifact, nothing after.

## Example

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zentou AI Portal — Wireframe v0.1</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Patrick+Hand&family=DM+Serif+Display&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --paper: #fbf6ec;
      --paper-tint: #f5eedf;
      --ink: #2b2620;
      --pencil: #4d473d;
      --rule: #c8bfa9;
      --grid: #e3d8b8;
      --accent: #d8482b;
      --highlight: #f9d27c;
      --note-yellow: #fff19a;
      --note-pink: #ffd5c9;
      --serif: 'DM Serif Display', 'Iowan Old Style', Georgia, serif;
      --hand: 'Patrick Hand', 'Caveat', cursive;
      --hand-bold: 'Caveat', 'Patrick Hand', cursive;
      --mono: 'IBM Plex Mono', ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle, rgba(43,38,32,0.04) 1px, transparent 1.4px) 0 0 / 22px 22px,
        var(--paper);
      font: 16px/1.5 var(--hand);
    }
    .page { padding: 32px 48px 56px; max-width: 1320px; margin: 0 auto; }

    .head { display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: end; padding-bottom: 14px; border-bottom: 2px solid var(--ink); }
    .head h1 { font: 800 56px/1 var(--serif); margin: 0; letter-spacing: -0.005em; display: flex; align-items: center; gap: 18px; }
    .head h1 em { font-style: italic; }
    .pin { display: inline-flex; align-items: center; gap: 8px; font: 12px/1 var(--mono); padding: 6px 10px; border: 1.5px dashed var(--accent); color: var(--accent); transform: rotate(-2.2deg); letter-spacing: 0.18em; background: var(--paper); }
    .pin .x { width: 6px; height: 6px; background: var(--accent); transform: rotate(45deg); }
    .head .sub { font: 18px/1.4 var(--hand); color: var(--pencil); }
    .head .meta { font: 11px/1.4 var(--mono); color: var(--pencil); letter-spacing: 0.14em; text-align: right; text-transform: uppercase; }
    .head .meta b { color: var(--ink); }

    .tabs { display: flex; gap: 8px; padding: 18px 0 12px; flex-wrap: wrap; }
    .tab { font: 16px/1 var(--hand); padding: 10px 14px; display: inline-flex; align-items: center; gap: 8px; color: var(--pencil); position: relative; transform: rotate(-0.4deg); }
    .tab .num { font: 11px/1 var(--mono); color: var(--pencil); padding: 4px 6px; border: 1.5px solid var(--pencil); letter-spacing: 0.06em; }
    .tab.active { color: var(--ink); }
    .tab.active::before { content: ''; position: absolute; left: -2px; right: -2px; top: 4px; bottom: 6px; background: var(--highlight); transform: skew(-8deg); z-index: -1; opacity: 0.85; }
    .tab.active .num { border-color: var(--ink); color: var(--ink); }
    .tab .glyph { width: 14px; height: 14px; border: 1.5px solid currentColor; display: inline-block; }

    .canvas {
      position: relative;
      background:
        repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 24px),
        repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 24px),
        var(--paper-tint);
      border: 3px solid var(--ink);
      border-radius: 14px;
      padding: 26px 26px 32px;
      box-shadow: 6px 8px 0 -4px rgba(43,38,32,0.18);
    }
    .canvas .section-label { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .canvas h2 { font: 800 30px/1 var(--serif); margin: 0; }
    .canvas .pill { font: 12px/1 var(--mono); padding: 5px 9px; border: 1.5px solid var(--pencil); border-radius: 999px; color: var(--pencil); letter-spacing: 0.12em; transform: rotate(1.2deg); }
    .canvas .lede { font: 17px/1.5 var(--hand); color: var(--pencil); margin: 0 0 18px; max-width: 70ch; }

    .browser { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border: 2px solid var(--pencil); border-radius: 999px; background: var(--paper); margin-bottom: 16px; }
    .browser .dots { display: flex; gap: 6px; }
    .browser .dots span { width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid var(--pencil); }
    .browser .url { flex: 1; font: 14px/1 var(--hand); color: var(--pencil); }
    .browser .user { font: 14px/1 var(--hand); color: var(--pencil); }

    .layout { display: grid; grid-template-columns: 200px 1fr; gap: 22px; }
    aside.nav { padding: 10px 0; }
    aside.nav .brand { font: 800 28px/1 var(--serif); font-style: italic; padding: 4px 6px; border-bottom: 2px solid var(--ink); display: inline-block; margin-bottom: 18px; }
    aside.nav ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    aside.nav li { font: 17px/1.2 var(--hand); display: flex; align-items: center; gap: 10px; padding: 6px 6px; position: relative; }
    aside.nav li .square { width: 14px; height: 14px; border: 1.5px solid var(--pencil); display: inline-block; flex-shrink: 0; }
    aside.nav li.active { color: var(--ink); }
    aside.nav li.active::before {
      content: ''; position: absolute; left: -4px; right: -8px; top: 4px; bottom: 6px;
      background: var(--highlight); opacity: 0.6; transform: skew(-6deg); z-index: -1;
    }

    .greeting { font: 14px/1.4 var(--hand); color: var(--pencil); }
    .name { font: 800 28px/1 var(--serif); font-style: italic; margin: 2px 0 4px; }
    .toggle-row { display: inline-flex; gap: 6px; padding: 4px; border: 1.5px solid var(--pencil); border-radius: 999px; }
    .toggle-row .tag { font: 13px/1 var(--hand); padding: 6px 10px; border-radius: 999px; color: var(--pencil); }
    .toggle-row .tag.active { background: var(--highlight); color: var(--ink); }

    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 16px 0; }
    .kpi { border: 2px solid var(--pencil); border-radius: 10px; padding: 14px; background: var(--paper); position: relative; }
    .kpi .label { font: 13px/1 var(--mono); color: var(--pencil); letter-spacing: 0.14em; text-transform: uppercase; }
    .kpi .value { font: 800 44px/1 var(--serif); margin-top: 8px; color: var(--accent); }
    .kpi .value.ink { color: var(--ink); }
    .kpi .small { font: 12px/1.4 var(--hand); color: var(--pencil); margin-top: 6px; }
    .kpi.tilt-1 { transform: rotate(-0.6deg); }
    .kpi.tilt-2 { transform: rotate(0.4deg); }
    .kpi.tilt-3 { transform: rotate(-0.2deg); }
    .kpi.tilt-4 { transform: rotate(0.7deg); }

    .panels { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
    .panel { border: 2px solid var(--pencil); border-radius: 10px; padding: 14px; background: var(--paper); position: relative; }
    .panel h3 { font: 700 16px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 14px; color: var(--pencil); display: flex; align-items: center; gap: 8px; }
    .panel h3 .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
    .panel svg.scribble { width: 100%; height: 160px; display: block; }

    .sticky {
      position: absolute;
      padding: 10px 12px;
      font: 16px/1.3 var(--hand);
      box-shadow: 4px 6px 0 -2px rgba(43,38,32,0.18);
      max-width: 220px;
    }
    .sticky.sn1 { top: 20px; right: 30px; background: var(--note-yellow); transform: rotate(2.4deg); }
    .sticky.sn2 { top: 380px; right: 90px; background: var(--note-pink); transform: rotate(-3.2deg); }
    .sticky .tape { position: absolute; top: -10px; left: 30px; width: 70px; height: 18px; background: rgba(43,38,32,0.18); transform: rotate(-4deg); }
    .sticky b { font-family: var(--hand-bold); font-weight: 700; }

    .events { padding: 12px 14px; border: 2px dashed var(--pencil); border-radius: 10px; margin-top: 14px; background: var(--paper); }
    .events .label { font: 13px/1 var(--mono); letter-spacing: 0.14em; color: var(--accent); text-transform: uppercase; margin-bottom: 6px; }
    .events .lines span { display: block; height: 8px; background: var(--pencil); opacity: 0.18; border-radius: 4px; margin: 6px 0; }
    .events .lines span:nth-child(1) { width: 80%; }
    .events .lines span:nth-child(2) { width: 60%; }
    .events .lines span:nth-child(3) { width: 70%; }

    .next-step { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 2px solid var(--accent); border-radius: 10px; background: var(--paper); margin-top: 14px; }
    .next-step .head { font: 13px/1 var(--mono); letter-spacing: 0.16em; color: var(--accent); text-transform: uppercase; }
    .next-step ul { padding: 0 0 0 18px; margin: 6px 0 0; font: 15px/1.4 var(--hand); color: var(--ink); }

    @media (max-width: 1000px) {
      .layout { grid-template-columns: 1fr; }
      .kpis { grid-template-columns: 1fr 1fr; }
      .panels { grid-template-columns: 1fr; }
      .sticky.sn1 { display: none; }
      .sticky.sn2 { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="head" data-od-id="head">
      <h1><em>Zentou AI · Portal</em>
        <span class="pin"><span class="x"></span>WIREFRAME v0.1</span>
      </h1>
      <div class="sub">受験者画面のレイアウト探索 — 4案 + 元画面の再整理</div>
      <div class="meta"><b>DATE</b> 2026-04-18 · <b>DEVICE</b> DESKTOP 1440 · <b>FIDELITY</b> LOW</div>
    </div>

    <div class="tabs" data-od-id="tabs">
      <div class="tab"><span class="glyph"></span><span class="num">00</span>ALL</div>
      <div class="tab"><span class="glyph"></span><span class="num">01</span>A · 整理型 (元画面ベース)</div>
      <div class="tab active"><span class="glyph"></span><span class="num">02</span>B · ダッシュボード (KPI)</div>
      <div class="tab"><span class="glyph"></span><span class="num">03</span>C · タイムライン (次の試験)</div>
      <div class="tab"><span class="glyph"></span><span class="num">04</span>D · 学習体験型</div>
    </div>

    <div class="canvas" data-od-id="canvas">
      <div class="section-label">
        <h2>B · ダッシュボード</h2>
        <span class="pill">DATA-FORWARD</span>
      </div>
      <p class="lede">KPIを最上段に。「今の自分の位置」を一目で把握 → 詳細は下へスクロール。</p>

      <div class="browser" data-od-id="browser"><div class="dots"><span></span><span></span><span></span></div><div class="url">zentou-ai.jp / portal / dashboard</div><div class="user">motoki.daisuke</div></div>

      <div class="layout">
        <aside class="nav" data-od-id="sidebar">
          <span class="brand">全統 AI</span>
          <ul>
            <li class="active"><span class="square"></span>ダッシュボード</li>
            <li><span class="square"></span>試験日程</li>
            <li><span class="square"></span>成績一覧</li>
            <li><span class="square"></span>練習問題</li>
            <li><span class="square"></span>学習計画</li>
          </ul>
        </aside>

        <div data-od-id="main">
          <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;">
            <div>
              <div class="greeting">おかえりなさい</div>
              <div class="name">motoki.daisuke <span style="font-size:18px;color:var(--pencil);">さん</span></div>
            </div>
            <div class="toggle-row">
              <span class="tag">今週</span>
              <span class="tag active">今月</span>
              <span class="tag">通算</span>
            </div>
          </div>

          <div class="kpis" data-od-id="kpis">
            <div class="kpi tilt-1"><div class="label">認定ランク</div><div class="value">A2</div><div class="small">基礎認定</div></div>
            <div class="kpi tilt-2"><div class="label">偏差値</div><div class="value ink" style="color:#3b6e8e;">39</div><div class="small">↑ +3.2 前回比</div></div>
            <div class="kpi tilt-3"><div class="label">次回まで</div><div class="value">1日</div><div class="small">04/19 10:00</div></div>
            <div class="kpi tilt-4"><div class="label">練習進捗</div><div class="value ink" style="color:#3b6e8e;">62%</div><div class="small">▰▰▰▰▰▱▱▱</div></div>
          </div>

          <div class="panels" data-od-id="panels">
            <div class="panel" data-od-id="chart">
              <h3><span class="dot"></span>CHART · 偏差値推移</h3>
              <svg class="scribble" viewBox="0 0 480 160" aria-hidden="true">
                <path d="M 14 142 L 460 142" stroke="#4d473d" stroke-width="1.6" fill="none"/>
                <path d="M 14 14 L 14 142" stroke="#4d473d" stroke-width="1.6" fill="none"/>
                <path d="M 18 110 C 80 96, 130 102, 180 92 S 280 60, 340 50 S 440 32, 460 22"
                  stroke="#d8482b" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="80" cy="98" r="4" fill="#d8482b"/>
                <circle cx="200" cy="86" r="4" fill="#d8482b"/>
                <circle cx="320" cy="56" r="4" fill="#d8482b"/>
                <circle cx="440" cy="28" r="4" fill="#d8482b"/>
              </svg>
            </div>
            <div class="panel" data-od-id="bars">
              <h3><span class="dot"></span>SUBJECTS · 科目別</h3>
              <svg class="scribble" viewBox="0 0 320 160" aria-hidden="true">
                <defs>
                  <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#2b2620" stroke-width="1.6"/>
                  </pattern>
                </defs>
                <path d="M 14 142 L 306 142" stroke="#4d473d" stroke-width="1.6" fill="none"/>
                <rect x="30" y="60" width="38" height="82" fill="url(#hatch)" stroke="#2b2620" stroke-width="1.4"/>
                <rect x="86" y="38" width="38" height="104" fill="url(#hatch)" stroke="#2b2620" stroke-width="1.4"/>
                <rect x="142" y="78" width="38" height="64" fill="url(#hatch)" stroke="#2b2620" stroke-width="1.4"/>
                <rect x="198" y="22" width="38" height="120" fill="url(#hatch)" stroke="#2b2620" stroke-width="1.4"/>
                <rect x="254" y="50" width="38" height="92" fill="url(#hatch)" stroke="#2b2620" stroke-width="1.4"/>
                <text x="14" y="158" font-family="IBM Plex Mono, monospace" font-size="11" fill="#4d473d">開発 / 国 / 数 / 英 / 理</text>
              </svg>
            </div>
          </div>

          <div class="events" data-od-id="events">
            <div class="label">📣 お知らせ (直近 3 件)</div>
            <div class="lines"><span></span><span></span><span></span></div>
          </div>

          <div class="next-step" data-od-id="next-step">
            <div class="head">● NEXT STEP / 次にやること</div>
            <ul>
              <li>試験の申込を完了する</li>
              <li>弱点「論理」を10問だけ解く</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="sticky sn1" data-od-id="sticky-1"><div class="tape"></div>一日目から触りたくなる画面に</div>
      <div class="sticky sn2" data-od-id="sticky-2"><div class="tape"></div><b>page-1 / 5</b><br/>余白は気持ちよく。<br/>密度は B 案ぐらい。</div>
    </div>
  </div>
</body>
</html>

\`\`\``}],G=`/skills/default`,K=[...I,...R,...F,...L,...z,...W,...U],q=new Map(K.map(e=>[e.name,e])),J=new Map,Y=e=>({name:e.name,description:e.description,path:`${G}/${e.name}.md`,publisher:e.publisher,collection:e.collection,repo:e.repo,sourceUrl:e.sourceUrl,origin:`default`,readOnly:!0,format:`file`,author:e.publisher,tags:e.collection?[e.collection]:[]}),X=e=>{let t=e.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);return t?t[1].trim():e.trim()},Z=()=>K.map(Y),Q=async e=>{let t=q.get(e);if(!t)return null;let n=J.get(e);if(n)return n;let r=(async()=>{if(t.body!==void 0)return{...Y(t),body:t.body};let n=t.rawUrls??[t.rawUrl].filter(Boolean),r=await Promise.all(n.map(async n=>{let r=await fetch(n);if(!r.ok)throw Error(`Failed to load default skill "${e}" from ${t.repo}: HTTP ${r.status}`);return X(await r.text())}));return{...Y(t),body:r.join(`

---

`)}})();J.set(e,r);try{return await r}catch(t){throw J.delete(e),t}};export{y as a,b as i,Q as n,P as o,v as r,g as s,Z as t};