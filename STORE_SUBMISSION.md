# Browser Extension Store Submission Guide

## Pre-Submission Checklist

### 1. Prepare Production Build
```bash
# Build for production with GitHub Pages runner URL
npm run build:prod
```

This will create production builds in:
- `dist/chrome/` - Chrome Web Store
- `dist/edge/` - Microsoft Edge Add-ons (uses same as Chrome)

### 2. Required Assets & Documentation

#### Icons (Already have)
- ✅ 48x48: `images/extension_48.png`
- ⚠️ Need: 128x128, 256x256, 512x512 for store listings

#### Screenshots Needed
- At least 1280x800 or 640x400 pixels
- Minimum 1 screenshot, recommended 3-5
- Show key features of your extension

#### Store Listing Content
- **Name**: Memorall
- **Short description** (max 132 chars): AI-powered memory and knowledge management browser extension
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
   - Upload the ZIP file from `dist/chrome/` folder

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
- Test with `npm run preview` before submitting

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
   - Upload the ZIP file from `dist/chrome/` folder
     - Edge accepts Chrome Manifest V3 extensions

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
   extension build --target=firefox-mv3
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
Memorall - Your AI-Powered Knowledge Companion

Memorall is an intelligent browser extension that helps you capture, organize, and recall information from your web browsing. Powered by local AI, your data stays private and secure.

🌟 KEY FEATURES:
• Knowledge Graph: Automatically build connections between concepts
• AI Chat Assistant: Ask questions about saved information
• Smart Note Taking: Extract and save important content
• Local Processing: AI runs in your browser - your data stays private
• Cross-Device Sync: Access your knowledge anywhere

🔒 PRIVACY FIRST:
• All data stored locally in your browser
• AI models run on your device
• No data sent to external servers without your consent
• You own and control your knowledge

🚀 PERFECT FOR:
• Students: Organize research and study materials
• Researchers: Track papers and build knowledge networks
• Professionals: Save and recall important information
• Anyone: Build your personal knowledge base

📖 GETTING STARTED:
1. Install the extension
2. Click the extension icon to open
3. Start browsing - Memorall will help you capture knowledge
4. Use chat to query your saved information

🔧 REQUIREMENTS:
• Modern browser (Chrome/Edge)
• Internet connection for AI model downloads (one-time)

💬 SUPPORT:
• GitHub: https://github.com/zrg-team/memorall
• Issues: https://github.com/zrg-team/memorall/issues
```

---

## Build Scripts to Add

Add these scripts to `package.json`:

```json
"scripts": {
  "build:chrome": "extension build --target=chrome-mv3",
  "build:edge": "extension build --target=edge-mv3",
  "build:firefox": "extension build --target=firefox-mv3",
  "build:all": "npm run build:chrome && npm run build:edge && npm run build:firefox",
  "package:chrome": "cd dist/chrome && zip -r ../../memorall-chrome.zip .",
  "package:edge": "cd dist/chrome && zip -r ../../memorall-edge.zip .",
  "package:all": "npm run build:all && npm run package:chrome && npm run package:edge"
}
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
