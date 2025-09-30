# Privacy Policy for Memorall Browser Extension

**Last Updated:** October 1, 2025

## Introduction

Memorall ("we", "our", or "the extension") is committed to protecting your privacy. This Privacy Policy explains how we handle data when you use the Memorall browser extension.

## Data Collection and Storage

### What We Collect
Memorall is designed with privacy-first principles. All data is stored **locally on your device**:

- **Knowledge Graph Data**: Notes, entities, relationships, and metadata you create
- **User Preferences**: Settings and configuration choices
- **Browsing Context**: URLs and page content you choose to save
- **AI Model Cache**: Downloaded AI models stored in your browser's storage

### What We DO NOT Collect
- We do **NOT** collect or transmit your personal data to external servers
- We do **NOT** track your browsing history beyond what you explicitly save
- We do **NOT** share your data with third parties
- We do **NOT** use analytics or tracking services
- We do **NOT** access your data without your explicit action

## Data Storage

### Local Storage
All data is stored locally using:
- **IndexedDB**: For knowledge graph, notes, and structured data
- **Browser Storage API**: For preferences and settings
- **Cache Storage**: For AI models and assets

### Data Persistence
- Data remains on your device until you explicitly delete it
- Uninstalling the extension will remove all stored data
- No cloud backups are created automatically

## External Connections

### AI Model Downloads
- On first use, Memorall downloads AI models from **HuggingFace.co**
- Models are cached locally and used offline after initial download
- No usage data is sent back to HuggingFace

### Optional LLM Providers
If you configure external LLM providers (OpenAI, Anthropic, etc.):
- You must provide your own API keys
- Data you send via chat is transmitted to your chosen provider
- These transmissions are governed by the provider's privacy policy
- We do not intercept or store API keys or transmitted data

### GitHub Pages Runner
- The extension connects to `https://zrg-team.github.io/memorall/` to load AI model runners
- This is a static file hosting service, no data is collected
- Runners execute entirely in your browser

## Permissions Explained

### Required Permissions

1. **storage**
   - **Purpose**: Save your knowledge graph, notes, and preferences locally
   - **Access**: Local browser storage only

2. **activeTab**
   - **Purpose**: Read content from the current webpage when you save it
   - **Access**: Only when you actively use the save feature

3. **contextMenus**
   - **Purpose**: Provide right-click menu shortcuts
   - **Access**: Menu items only, no data collection

4. **scripting**
   - **Purpose**: Inject content analysis scripts on pages you visit
   - **Access**: Only to extract content you choose to save

5. **notifications**
   - **Purpose**: Show alerts about AI processing status
   - **Access**: Local notifications only

6. **offscreen**
   - **Purpose**: Run AI models in background without blocking UI
   - **Access**: Local processing only

### Host Permissions

1. **https://huggingface.co/***
   - **Purpose**: Download AI models for local use
   - **Frequency**: One-time per model

2. **<all_urls>**
   - **Purpose**: Allow you to save content from any webpage
   - **Access**: Only when you explicitly trigger save/analyze actions
   - **Note**: We do not monitor or collect browsing history

## Data Security

### Protection Measures
- All data stays on your device
- No transmission to external servers (except when you use external LLM APIs)
- AI processing happens locally in your browser
- No encryption keys or sensitive data are stored

### Your Control
You have complete control over your data:
- View all stored data via browser developer tools
- Export your knowledge graph at any time
- Delete individual items or all data
- No account or login required

## Third-Party Services

### HuggingFace.co
- **Purpose**: AI model hosting
- **Data Shared**: Model download requests (no personal data)
- **Privacy Policy**: https://huggingface.co/privacy

### Optional LLM Providers (if you configure them)
When you use external LLM services:
- **OpenAI**: https://openai.com/policies/privacy-policy
- **Anthropic**: https://www.anthropic.com/privacy
- **Others**: Refer to the specific provider's privacy policy

**Important**: Using external LLM providers is optional. Memorall works fully offline with locally-running models.

## Children's Privacy

Memorall is not directed at children under 13. We do not knowingly collect data from children.

## Changes to This Policy

We may update this Privacy Policy occasionally. Changes will be posted with a new "Last Updated" date. Continued use after changes constitutes acceptance.

## Data Deletion

To delete all Memorall data:
1. Right-click the extension icon → Settings
2. Click "Delete All Data"
3. Or uninstall the extension (removes all data automatically)

## Open Source

Memorall is open source. You can verify our privacy practices by reviewing the source code:
- **GitHub**: https://github.com/zrg-team/memorall
- **License**: MIT

## Contact

For privacy questions or concerns:
- **GitHub Issues**: https://github.com/zrg-team/memorall/issues
- **Email**: zerglingno2@outlook.com

---

## Summary

**TL;DR:**
- ✅ All data stored locally on your device
- ✅ No tracking or analytics
- ✅ No data sent to our servers (we don't have any!)
- ✅ You own and control your data
- ✅ Optional external LLM usage (your choice)
- ✅ Open source - verify yourself

**Your privacy is our priority.**
