# Browser Extension Store Submission Guide

## Pre-Submission Checklist

### 1. Prepare Production Build
```bash
# Build, audit, and ZIP both store targets
yarn package:extension:all
```

This will create production builds in:
- `publish/extension/chrome/` - unpacked Chrome Web Store build
- `publish/extension/edge/` - unpacked Microsoft Edge Add-ons build
- `publish/extension/memorall-chrome.zip` - Chrome upload package
- `publish/extension/memorall-edge.zip` - Edge upload package

### 2. Required Assets & Documentation

#### Icons (Already have)
- ✅ 16x16 / 32x32 / 48x48 / 128x128: `docs/images/extension_<size>.png`
- ✅ 128x128, 256x256, 512x512 store listing art: `docs/store/store_<size>.png`
- Regenerate every size from the master artwork with `yarn assets:icons docs/images/icon-source.png`

#### Screenshots Needed
- At least 1280x800 or 640x400 pixels
- Minimum 1 screenshot, recommended 3-5
- Show key features of your extension

#### Store Listing Content
- **Name**: Memorall
- **Short description** (max 132 chars): Browser-native agent workspace with local-first memory, tools, files, and model choice. The browser is your agent's full workspace.
- **Detailed description** (see template below)
- **Category**: Productivity
- **Privacy Policy URL** (required)
- **Support/Homepage URL**: https://github.com/zrg-team/memorall

---

## Chrome Web Store Submission

### Prerequisites
1. **Developer Account**
   - Go to: https://chrome.google.com/webstore/devconsole
   - One-time registration fee: $5 USD
   - Sign in with Google account

### Submission Steps

1. **Create New Item**
   - Click "New Item" in Chrome Web Store Developer Dashboard
   - Upload the ZIP file from `publish/extension/memorall-chrome.zip`

2. **Store Listing**
   - Fill in:
     - Product name: Memorall
     - Short description (132 chars max)
     - Detailed description
     - Category: Productivity
     - Language: English

3. **Upload Assets**
   - Icon: 128x128 (required)
   - Screenshots: At least 1, up to 5 (1280x800 or 640x400)
   - Promotional images (optional but recommended)

4. **Privacy & Permissions**
   - Justify permissions:
     - `storage`: Save user preferences and knowledge data
     - `activeTab`: Interact with current webpage
     - `contextMenus`: Quick access features
     - `scripting`: Inject content scripts for page analysis
     - `notifications`: Alert users about important events
     - `offscreen`: Run background AI/ML tasks
     - `<all_urls>`: Access web pages for content extraction

5. **Distribution**
   - Select visibility: Public / Unlisted / Private
   - Select regions (recommended: All regions)

6. **Submit for Review**
   - Review typically takes 1-3 business days
   - Check for any policy violations

### Important Notes for Chrome
- CSP policy includes localhost - **MUST REMOVE for production**
- Test with `yarn run preview` before submitting

---

## Microsoft Edge Add-ons Submission

### Prerequisites
1. **Partner Center Account**
   - Go to: https://partner.microsoft.com/dashboard/microsoftedge
   - Free registration (no fee required)
   - Sign in with Microsoft account

### Submission Steps

1. **Create New Extension**
   - Navigate to "Extensions" in Partner Center
   - Click "New extension"
     - Upload the ZIP file from `publish/extension/memorall-edge.zip`

2. **Store Listing**
   - Fill in:
     - Extension name: Memorall
     - Short description (max 132 chars)
     - Detailed description (max 10,000 chars)
     - Category: Productivity
     - Supported languages: English

3. **Upload Assets**
   - Store logo: 300x300 PNG (required)
   - Screenshots: At least 1, up to 10 (1280x800 minimum)
   - Promotional images (optional)

4. **Privacy & Compliance**
   - Privacy policy URL (required)
   - Justify host permissions and permissions
   - Declare if extension uses remote code or AI

5. **Pricing & Availability**
   - Free
   - Select markets (recommended: All markets)

6. **Submit for Review**
   - Certification typically takes 24-72 hours
   - Automated and manual review process

---

## Firefox Add-ons Submission (Optional)

### Prerequisites
1. **Firefox Add-ons Account**
   - Go to: https://addons.mozilla.org/developers/
   - Free registration

### Submission Steps
1. Build Firefox version:
   ```bash
   extension build --browser=firefox
   ```

2. Upload to: https://addons.mozilla.org/developers/addon/submit/
3. Fill in listing details
4. Submit for review (typically 1-2 weeks)

---

## Pre-Production Fixes Needed

### 1. Update Manifest for Production
Current issues in `manifest.json`:
- Author is "Your Name" - needs to be updated
- CSP includes localhost - remove for production

### 2. Create Store Icons
Need to generate:
- 128x128 (Chrome required)
- 256x256 (recommended)
- 512x512 (recommended)
- 300x300 (Edge required)

### 3. Create Privacy Policy
Required by both stores. Should cover:
- What data is collected
- How data is stored (locally using IndexedDB)
- No data sent to external servers (except chosen LLM providers)
- User control over data

### 4. Create Screenshots
Capture:
- Main extension popup
- Options/settings page
- Extension in action (knowledge graph, chat, etc.)
- Key features demonstration

### 5. Prepare Detailed Description Template

```
Memorall — The browser is your agent's full workspace.

Memorall turns your browser into a full agent workspace — with memory, tools, files, and model choice all in one place. Capture context from any page, build a knowledge graph from your real work, and run a powerful local-first agent that can browse, read documents, execute code, and remember everything across sessions. No fragmented apps, no mandatory cloud, no context lost between tabs.

Open Source: https://github.com/zrg-team/memorall

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 MEMORY — Durable memory that learns from your browser

Pages, selections, screenshots, PDFs, notes, and spreadsheets get captured from any tab and converted into structured, topic-scoped memory. Relationships between ideas, sources, and documents stay attached, so the work stays recoverable instead of disappearing after one session. A built-in knowledge graph connects facts across everything you save.

• Capture from pages, selections, screenshots, files
• Topic-organized memory with a live knowledge graph
• Hybrid retrieval: exact match + semantic search
• Sources and relationships stay linked to prior work

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ AGENT POWER — One strong agent, fully inside your browser

The agent is not isolated. It has live browser access, virtual filesystems, your personal documents, and a browser-hosted sandbox runtime — all from the same product.

• Browser session — live page content, DOM awareness, page-aware actions
• Workspace files — virtual filesystem + document library (PDF, MD, Excel, and more)
• Node.js sandbox — run code, install packages, start APIs, prototype web apps locally
• Visual flow builder for custom agent behavior and logic
• MCP-ready architecture for future extensibility

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 OFFLINE-FIRST — Your stack, your control

The core experience works without any external service. No account required to get started.

• All data stored locally via PGlite — no server, no sign-in required
• Local memory, local files, local agent — fully operational offline
• No mandatory cloud dependency for core workflows
• Optional Supabase auth available when you want sync

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ MODEL CHOICE — Browser-local LLMs are first-class, not fallbacks

Use whichever runtime fits the job. The agent workflow stays the same regardless of where inference runs.

• Browser-local inference: WebLLM, Wllama, Transformers.js
• Local server runtimes: Ollama, LM Studio
• Remote APIs when you choose them: OpenAI, Anthropic, Azure, OpenRouter
• Switch providers without changing the workflow

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 SUPPORT
• GitHub: https://github.com/zrg-team/memorall
• Issues: https://github.com/zrg-team/memorall/issues
```

---

## Build And Package Scripts

Use the canonical extension script family:

```sh
yarn build:extension:chrome
yarn build:extension:edge
yarn build:extension:firefox
yarn build:extension:all
yarn package:extension:chrome
yarn package:extension:edge
yarn package:extension:all
```

---

## Testing Before Submission

1. **Load Unpacked Extension**
   - Chrome: chrome://extensions/ → Enable Developer Mode → Load unpacked
   - Edge: edge://extensions/ → Enable Developer Mode → Load unpacked

2. **Test All Features**
   - [ ] Extension popup opens
   - [ ] Options page works
   - [ ] Content scripts inject properly
   - [ ] Background service worker functions
   - [ ] AI models download and work
   - [ ] Knowledge graph builds correctly
   - [ ] Chat functionality works
   - [ ] Data persists across sessions

3. **Test Permissions**
   - [ ] All required permissions requested
   - [ ] No unnecessary permissions
   - [ ] Permissions justification is clear

---

## Post-Submission

1. **Monitor Reviews**
   - Check developer dashboard daily
   - Respond to any reviewer questions quickly

2. **Common Rejection Reasons**
   - Broad host permissions without justification
   - Missing privacy policy
   - Unclear permission usage
   - CSP policy issues
   - Remotely hosted code

3. **After Approval**
   - Test the published extension
   - Promote on social media, GitHub
   - Monitor user reviews
   - Plan updates and bug fixes

---

## Useful Links

### Chrome
- Developer Dashboard: https://chrome.google.com/webstore/devconsole
- Developer Policies: https://developer.chrome.com/docs/webstore/program-policies/
- Best Practices: https://developer.chrome.com/docs/webstore/best_practices/

### Edge
- Partner Center: https://partner.microsoft.com/dashboard/microsoftedge
- Developer Policies: https://docs.microsoft.com/microsoft-edge/extensions-chromium/store-policies/
- Publishing Guide: https://docs.microsoft.com/microsoft-edge/extensions-chromium/publish/publish-extension

### Firefox
- Developer Hub: https://addons.mozilla.org/developers/
- Add-on Policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Submission Guide: https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
