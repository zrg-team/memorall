export const customStyles = `
  /*
   * Copilot-owned CSS for the injected surfaces.
   *
   * Design tokens are NOT declared here. The packaged app stylesheet is linked
   * into the same shadow root and scopes them to '.light' / '.dark', both of
   * which match the themed container, so the copilot inherits the app's palette
   * instead of keeping a hand-copied fork of it in sync.
   *
   * This sheet is appended AFTER that stylesheet, so its rules win ties by
   * document order and do not need '!important'.
   */
  :host {
    /* html/body never exist in a shadow tree, so the base font is set here. */
    font-family:
      "Space Grotesk",
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
  }

  .memorall-chat-container input,
  .memorall-chat-container textarea {
    background-color: transparent;
    border: none;
    outline: none;
    color: hsl(var(--foreground));
  }

  .memorall-chat-container input::placeholder,
  .memorall-chat-container textarea::placeholder {
    color: hsl(var(--muted-foreground));
  }

  .memorall-chat-container .memorall-embedded-root {
    position: fixed;
    inset: 0;
    z-index: 999999;
    pointer-events: none;
    font-family: inherit;
  }

  .memorall-chat-container .memorall-chat-shell {
    position: fixed;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    border-color: hsl(var(--border));
    box-shadow:
      0 18px 56px rgba(0, 0, 0, 0.22),
      0 2px 12px rgba(0, 0, 0, 0.12);
    pointer-events: auto;
    animation: slideInFromRight 220ms ease-out both;
  }

  .memorall-chat-container .memorall-chat-shell--panel {
    top: 0;
    right: 0;
    bottom: 0;
    width: clamp(380px, 32vw, 520px);
    max-width: calc(100vw - 16px);
    border-left: 1px solid hsl(var(--border));
  }

  .memorall-chat-container .memorall-chat-shell--popup {
    right: 12px;
    bottom: 12px;
    width: min(420px, calc(100vw - 24px));
    height: min(640px, calc(100vh - 24px));
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
  }

  .memorall-chat-container .memorall-embedded-root--minimized {
    pointer-events: none;
  }

  .memorall-chat-container .memorall-chat-minimized-button {
    position: fixed;
    right: 18px;
    bottom: 18px;
    width: 54px;
    height: 54px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--background) / 0.96);
    color: hsl(var(--foreground));
    box-shadow:
      0 16px 40px rgba(0, 0, 0, 0.22),
      0 2px 8px rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(12px);
    cursor: pointer;
    pointer-events: auto;
    animation: slideInFromRight 180ms ease-out both;
  }

  .memorall-chat-container .memorall-chat-minimized-button:hover {
    transform: translateY(-1px);
    background: hsl(var(--muted));
  }

  .memorall-chat-container .memorall-chat-minimized-button:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .memorall-chat-container .memorall-chat-minimized-logo {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }

  .memorall-chat-container .memorall-chat-shell--smart {
    top: 12px;
    right: 12px;
    bottom: auto;
    width: min(420px, calc(100vw - 24px));
    height: auto;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background) / 0.96);
    backdrop-filter: blur(12px);
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-header-inner {
    min-height: 48px;
    padding: 8px 14px;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-title {
    max-width: 100%;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-header-actions {
    display: none;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-brand {
    display: none;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-model-chip {
    max-width: none;
    flex: 1 1 auto;
  }

  .memorall-chat-container .memorall-smart-select-notice {
    padding: 14px;
  }

  .memorall-chat-container .memorall-smart-select-notice-card {
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--muted) / 0.22);
    padding: 16px;
  }

  .memorall-chat-container .memorall-smart-select-notice-title {
    color: hsl(var(--foreground));
    font-size: 16px;
    font-weight: 700;
    line-height: 1.25;
  }

  .memorall-chat-container .memorall-smart-select-notice-text {
    margin: 8px 0 0;
    color: hsl(var(--muted-foreground));
    font-size: 14px;
    line-height: 1.6;
  }

  .memorall-chat-container .memorall-smart-select-cancel-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    margin-top: 14px;
    border: 0;
    border-radius: 8px;
    background: hsl(0 84% 60%);
    color: white;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .memorall-chat-container .memorall-smart-select-cancel-button:hover {
    background: hsl(0 72% 51%);
  }

  .memorall-chat-container .memorall-chat-header {
    flex-shrink: 0;
    border-bottom: 1px solid hsl(var(--border));
    background: hsl(var(--background) / 0.96);
    backdrop-filter: blur(10px);
  }

  .memorall-chat-container .memorall-chat-header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 52px;
    padding: 8px 12px;
  }

  .memorall-chat-container .memorall-chat-title {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 10px;
  }

  .memorall-chat-container .memorall-chat-logo,
  .memorall-chat-container .memorall-empty-logo-image {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .memorall-chat-container .memorall-chat-brand {
    flex-shrink: 0;
    color: hsl(var(--foreground));
    font-size: 14px;
    font-weight: 650;
    line-height: 1;
  }

  .memorall-chat-container .memorall-model-chip {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    flex: 1 1 auto;
    align-items: center;
    gap: 6px;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    padding: 4px 8px;
    background: hsl(var(--muted) / 0.55);
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    line-height: 1.2;
  }

  .memorall-chat-container .memorall-model-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 999px;
    background: hsl(142 70% 45%);
  }

  .memorall-chat-container .memorall-model-chip--empty .memorall-model-dot {
    background: hsl(0 84% 60%);
  }

  .memorall-chat-container .memorall-model-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .memorall-chat-container .memorall-header-actions,
  .memorall-chat-container .memorall-composer-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
  }

  .memorall-chat-container .memorall-icon-button {
    display: inline-flex;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease,
      transform 150ms ease;
  }

  .memorall-chat-container .memorall-icon-button:hover {
    background: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-icon-button--active {
    background: hsl(var(--primary) / 0.12);
    color: hsl(var(--primary));
  }

  .memorall-chat-container .memorall-icon-button:focus-visible,
  .memorall-chat-container .memorall-submit-button:focus-visible,
  .memorall-chat-container .memorall-suggested-prompt:focus-visible,
  .memorall-chat-container .memorall-context-cta:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .memorall-chat-container .memorall-icon-button--compact {
    width: 34px;
    height: 34px;
  }

  .memorall-chat-container .memorall-icon-button--danger:hover {
    background: hsl(0 84% 60%);
    color: white;
  }

  .memorall-chat-container .memorall-icon {
    width: 16px;
    height: 16px;
  }

  .memorall-chat-container .memorall-conversation-content {
    min-height: 100%;
    overflow-y: auto;
    padding: 18px 16px;
  }

  .memorall-chat-container .memorall-message {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .memorall-chat-container .memorall-message--user {
    align-items: flex-end;
  }

  .memorall-chat-container .memorall-message--assistant {
    align-items: flex-start;
  }

  .memorall-chat-container .memorall-message-content {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-size: 13px;
    line-height: 1.55;
  }

  .memorall-chat-container .memorall-message-content--user {
    max-width: 86%;
    border: 1px solid hsl(var(--primary) / 0.18);
    border-radius: 8px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    padding: 10px 12px;
    text-align: left;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .memorall-chat-container .memorall-submit-button *,
  .memorall-chat-container .memorall-user-text {
    color: hsl(var(--primary-foreground));
  }

  .memorall-chat-container .memorall-user-text--with-context {
    overflow-wrap: anywhere;
    line-height: 1.45;
  }

  .memorall-chat-container .memorall-user-context {
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-user-text-card {
    border-color: hsl(var(--border));
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-user-context-card {
    border-color: hsl(var(--border));
    background: hsl(var(--card));
    color: hsl(var(--card-foreground));
  }

  .memorall-chat-container .memorall-user-context-card-header {
    background: hsl(var(--card));
    color: hsl(var(--card-foreground));
  }

  .memorall-chat-container .memorall-user-context-card-header:hover,
  .memorall-chat-container .memorall-user-context-icon-button:hover {
    background: hsl(var(--accent));
  }

  .memorall-chat-container .memorall-user-context-card-title,
  .memorall-chat-container .memorall-user-context-pre {
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-user-context-card-subtitle,
  .memorall-chat-container .memorall-user-context-card-icon {
    color: hsl(var(--muted-foreground));
  }

  .memorall-chat-container .memorall-user-context-expanded {
    background: hsl(var(--muted) / 0.3);
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-co-agent-hover-context {
    margin-top: 8px;
    border: 1px solid hsl(var(--primary-foreground) / 0.32);
    border-radius: 8px;
    background: transparent;
    color: hsl(var(--primary-foreground));
    padding: 8px 9px;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0;
    opacity: 0.86;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: hsl(var(--primary-foreground));
    flex: 0 0 auto;
    opacity: 0.78;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-label {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    overflow-wrap: anywhere;
    color: hsl(var(--primary-foreground));
  }

  .memorall-chat-container .memorall-co-agent-hover-context-selector {
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10.5px;
    line-height: 1.35;
    opacity: 0.68;
    overflow-wrap: anywhere;
    color: hsl(var(--primary-foreground));
  }

  .memorall-chat-container .memorall-co-agent-hover-context-text {
    margin-top: 7px;
    border-top: 1px solid hsl(var(--primary-foreground) / 0.18);
    padding-top: 7px;
    font-size: 11.5px;
    line-height: 1.45;
    opacity: 0.78;
    overflow-wrap: anywhere;
    color: hsl(var(--primary-foreground));
  }

  .memorall-chat-container .memorall-message-content--assistant {
    width: 100%;
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-assistant-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }

  .memorall-chat-container .memorall-openui-notice {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--muted) / 0.32);
    padding: 10px;
  }

  .memorall-chat-container .memorall-openui-notice__icon {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: 6px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
  }

  .memorall-chat-container .memorall-openui-notice__text {
    min-width: 0;
    color: hsl(var(--foreground));
    font-size: 12px;
    font-weight: 650;
    line-height: 1.35;
  }

  .memorall-chat-container .memorall-openui-notice__button {
    display: inline-flex;
    height: 32px;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    padding: 0 10px;
    white-space: nowrap;
  }

  .memorall-chat-container .memorall-openui-notice__button:hover {
    background: hsl(var(--muted));
  }

  .memorall-chat-container .memorall-openui-content {
    width: 100%;
    max-width: 100%;
    overflow: hidden;
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-openui-content input,
  .memorall-chat-container .memorall-openui-content textarea,
  .memorall-chat-container .memorall-openui-content select {
    border: 1px solid hsl(var(--input));
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    outline: none;
  }

  .memorall-chat-container .memorall-openui-content textarea {
    min-height: 80px;
    resize: vertical;
  }

  .memorall-chat-container .memorall-openui-content input[type="checkbox"],
  .memorall-chat-container .memorall-openui-content input[type="radio"] {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: 1px solid hsl(var(--border));
    accent-color: hsl(var(--primary));
  }

  .memorall-chat-container .memorall-markdown {
    color: hsl(var(--foreground));
    font-size: 14px;
    line-height: 1.65;
  }

  .memorall-chat-container .memorall-markdown > *:first-child {
    margin-top: 0;
  }

  .memorall-chat-container .memorall-markdown > *:last-child {
    margin-bottom: 0;
  }

  .memorall-chat-container .memorall-markdown p,
  .memorall-chat-container .memorall-markdown ul,
  .memorall-chat-container .memorall-markdown ol,
  .memorall-chat-container .memorall-markdown blockquote,
  .memorall-chat-container .memorall-markdown pre,
  .memorall-chat-container .memorall-markdown table {
    margin: 0 0 12px;
  }

  .memorall-chat-container .memorall-markdown h1,
  .memorall-chat-container .memorall-markdown h2,
  .memorall-chat-container .memorall-markdown h3 {
    margin: 18px 0 8px;
    color: hsl(var(--foreground));
    font-weight: 700;
    line-height: 1.25;
  }

  .memorall-chat-container .memorall-markdown h1 {
    font-size: 20px;
  }

  .memorall-chat-container .memorall-markdown h2 {
    font-size: 17px;
  }

  .memorall-chat-container .memorall-markdown h3 {
    font-size: 15px;
  }

  .memorall-chat-container .memorall-markdown ul,
  .memorall-chat-container .memorall-markdown ol {
    padding-left: 22px;
  }

  .memorall-chat-container .memorall-markdown li {
    margin: 4px 0;
    padding-left: 2px;
  }

  .memorall-chat-container .memorall-markdown a {
    color: hsl(211 90% 56%);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .memorall-chat-container .memorall-markdown blockquote {
    border-left: 3px solid hsl(var(--border));
    color: hsl(var(--muted-foreground));
    padding-left: 12px;
  }

  .memorall-chat-container .memorall-markdown-inline-code {
    border: 1px solid hsl(var(--border));
    border-radius: 5px;
    background: hsl(var(--muted) / 0.75);
    color: hsl(var(--foreground));
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    padding: 1px 5px;
  }

  .memorall-chat-container .memorall-markdown-codeblock {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--muted) / 0.55);
    padding: 12px;
  }

  .memorall-chat-container .memorall-markdown-codeblock code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    white-space: pre;
  }

  .memorall-chat-container .memorall-markdown-table-wrap {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
  }

  .memorall-chat-container .memorall-markdown table {
    width: 100%;
    border-collapse: collapse;
    margin: 0;
  }

  .memorall-chat-container .memorall-markdown th,
  .memorall-chat-container .memorall-markdown td {
    border-bottom: 1px solid hsl(var(--border));
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }

  .memorall-chat-container .memorall-markdown th {
    background: hsl(var(--muted) / 0.75);
    font-weight: 650;
  }

  .memorall-chat-container .memorall-markdown tr:last-child td {
    border-bottom: 0;
  }

  .memorall-chat-container .memorall-markdown img {
    max-width: 100%;
    height: auto;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
  }

  .memorall-chat-container .memorall-markdown-checkbox {
    display: inline-flex;
    width: 14px;
    height: 14px;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    background: hsl(var(--muted) / 0.45);
    color: hsl(var(--foreground));
    font-size: 11px;
    line-height: 1;
    margin-right: 6px;
  }

  .memorall-chat-container .memorall-tool-summary-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .memorall-chat-container .memorall-tool-summary {
    width: 100%;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--muted) / 0.35);
    padding: 9px 10px;
  }

  .memorall-chat-container .memorall-tool-summary-main {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    list-style: none;
    cursor: default;
  }

  .memorall-chat-container details.memorall-tool-summary .memorall-tool-summary-main {
    cursor: pointer;
  }

  .memorall-chat-container .memorall-tool-summary-main::-webkit-details-marker {
    display: none;
  }

  .memorall-chat-container .memorall-tool-summary-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 999px;
    background: hsl(142 70% 45%);
  }

  .memorall-chat-container .memorall-tool-summary-dot--active {
    background: hsl(211 90% 56%);
    box-shadow: 0 0 0 3px hsl(211 90% 56% / 0.16);
  }

  .memorall-chat-container .memorall-tool-summary-title {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 650;
  }

  .memorall-chat-container .memorall-tool-summary-status {
    flex-shrink: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--background));
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    line-height: 1;
    padding: 4px 7px;
  }

  .memorall-chat-container .memorall-tool-summary-description {
    margin-top: 6px;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    line-height: 1.45;
  }

  .memorall-chat-container .memorall-tool-summary-code {
    max-height: 180px;
    overflow: auto;
    margin: 8px 0 0;
    border-radius: 6px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    padding: 8px;
    white-space: pre-wrap;
  }

  .memorall-chat-container .memorall-artifact-card {
    width: 100%;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--card));
  }

  .memorall-chat-container .memorall-artifact-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid hsl(var(--border));
    padding: 9px 10px;
  }

  .memorall-chat-container .memorall-artifact-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 650;
  }

  .memorall-chat-container .memorall-artifact-open {
    flex-shrink: 0;
    border: 1px solid hsl(var(--border));
    border-radius: 7px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    cursor: pointer;
    font-size: 12px;
    padding: 5px 8px;
  }

  .memorall-chat-container .memorall-artifact-frame {
    display: block;
    width: 100%;
    height: 300px;
    border: 0;
    background: white;
  }

  .memorall-chat-container .memorall-artifact-frame--url {
    height: 240px;
    border-top: 1px solid hsl(var(--border));
  }

  .memorall-chat-container .memorall-artifact-url-text {
    overflow-wrap: anywhere;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    padding: 10px;
  }

  .memorall-chat-container .memorall-empty-state {
    display: flex;
    min-height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 18px;
    text-align: center;
  }

  .memorall-chat-container .memorall-empty-logo {
    display: flex;
    width: 48px;
    height: 48px;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--muted));
    margin-bottom: 12px;
  }

  .memorall-chat-container .memorall-empty-kicker {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0;
    margin-bottom: 6px;
  }

  .memorall-chat-container .memorall-empty-title {
    margin: 0 0 8px;
    color: hsl(var(--foreground));
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
  }

  .memorall-chat-container .memorall-empty-description {
    max-width: 320px;
    margin: 0;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    line-height: 1.55;
  }

  .memorall-chat-container .memorall-suggested-prompts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 16px;
  }

  .memorall-chat-container .memorall-suggested-prompt,
  .memorall-chat-container .memorall-context-cta {
    min-height: 34px;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    padding: 8px 10px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .memorall-chat-container .memorall-suggested-prompt:hover,
  .memorall-chat-container .memorall-context-cta:hover {
    border-color: hsl(var(--primary) / 0.35);
    background: hsl(var(--muted));
  }

  .memorall-chat-container .memorall-context-cta {
    margin-top: 12px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
  }

  .memorall-chat-container .memorall-composer {
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border));
    background: hsl(var(--background));
    padding: 10px;
  }

  .memorall-chat-container .memorall-prompt-input {
    position: relative;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
  }

  .memorall-chat-container .memorall-prompt-input:focus-within {
    border-color: hsl(var(--ring));
  }

  .memorall-chat-container .memorall-prompt-textarea {
    display: block;
    width: 100%;
    min-height: 64px;
    max-height: 144px;
    resize: none;
    border: 0;
    background: transparent;
    color: hsl(var(--foreground));
    font-size: 13px;
    line-height: 1.45;
    outline: none;
    padding: 10px 12px;
  }

  .memorall-chat-container .memorall-prompt-textarea:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .memorall-chat-container .memorall-prompt-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: 1px solid hsl(var(--border));
    padding: 8px;
  }

  .memorall-chat-container .memorall-composer-row {
    display: flex;
    min-width: 0;
    width: 100%;
    align-items: center;
    gap: 8px;
  }

  .memorall-chat-container .memorall-composer-scroll {
    min-width: 0;
    flex: 1 1 auto;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .memorall-chat-container .memorall-composer-scroll::-webkit-scrollbar {
    display: none;
  }

  .memorall-chat-container .memorall-prompt-tools {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .memorall-chat-container .memorall-select-wrap {
    min-width: 0;
    flex-shrink: 0;
  }

  .memorall-chat-container .memorall-select {
    max-width: 156px;
    min-height: 34px;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-size: 12px;
    line-height: 1.2;
    outline: none;
    padding: 0 28px 0 10px;
  }

  .memorall-chat-container .memorall-select:focus {
    border-color: hsl(var(--ring));
  }

  .memorall-chat-container .memorall-submit-button {
    display: inline-flex;
    min-width: 58px;
    height: 36px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 0;
    border-radius: 8px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    padding: 0 12px;
    transition:
      opacity 150ms ease,
      transform 150ms ease;
  }

  .memorall-chat-container .memorall-submit-button:not(:disabled):hover {
    transform: translateY(-1px);
  }

  .memorall-chat-container .memorall-submit-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .memorall-chat-container .memorall-context-section {
    flex-shrink: 0;
    max-height: min(300px, 38vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    border-top: 1px solid hsl(var(--border));
    background: hsl(var(--muted) / 0.24);
    padding: 12px 14px;
  }

  .memorall-chat-container .memorall-context-reveal {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
    border-top: 1px solid hsl(var(--border));
    background: hsl(var(--muted) / 0.18);
    padding: 8px 12px;
  }

  .memorall-chat-container .memorall-context-reveal-button,
  .memorall-chat-container .memorall-context-reveal-smart-button {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 650;
    line-height: 1;
    padding: 0 10px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }

  .memorall-chat-container .memorall-context-reveal-smart-button {
    flex-shrink: 0;
    border-color: hsl(var(--border));
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-weight: 700;
    padding: 0 12px;
  }

  .memorall-chat-container .memorall-context-reveal-button:hover,
  .memorall-chat-container .memorall-context-reveal-smart-button:hover {
    border-color: hsl(var(--border));
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-context-reveal-smart-button:hover {
    border-color: hsl(var(--primary) / 0.28);
    background: hsl(var(--muted));
  }

  .memorall-chat-container .memorall-context-reveal-icon {
    width: 15px;
    height: 15px;
  }

  .memorall-chat-container .memorall-context-section::-webkit-scrollbar {
    width: 8px;
  }

  .memorall-chat-container .memorall-context-section::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: hsl(var(--muted-foreground) / 0.24);
    background-clip: content-box;
  }

  .memorall-chat-container .memorall-context-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }

  .memorall-chat-container .memorall-context-title-wrap {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .memorall-chat-container .memorall-context-toggle,
  .memorall-chat-container .memorall-context-preview-button {
    display: inline-flex;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  .memorall-chat-container .memorall-context-toggle:hover,
  .memorall-chat-container .memorall-context-preview-button:hover {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-context-toggle-icon,
  .memorall-chat-container .memorall-smart-select-icon {
    width: 15px;
    height: 15px;
  }

  .memorall-chat-container .memorall-context-title {
    overflow: hidden;
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .memorall-chat-container .memorall-context-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
  }

  .memorall-chat-container .memorall-smart-select-button {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    padding: 0 12px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .memorall-chat-container .memorall-smart-select-button:hover {
    border-color: hsl(var(--primary) / 0.28);
    background: hsl(var(--muted));
  }

  .memorall-chat-container .memorall-context-group {
    margin-top: 10px;
  }

  .memorall-chat-container .memorall-context-group:first-of-type {
    margin-top: 0;
  }

  .memorall-chat-container .memorall-context-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .memorall-chat-container .memorall-context-grid--attached {
    grid-template-columns: 1fr;
  }

  .memorall-chat-container .memorall-context-tile {
    display: flex;
    min-width: 0;
    min-height: 48px;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    background: hsl(var(--background));
    padding: 8px 8px 8px 10px;
  }

  .memorall-chat-container .memorall-context-tile--attached {
    background: hsl(var(--muted) / 0.34);
  }

  .memorall-chat-container .memorall-context-attach-button {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 0;
    background: transparent;
    color: hsl(var(--foreground));
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
    padding: 0;
    text-align: left;
  }

  .memorall-chat-container .memorall-context-attach-button:hover .memorall-context-label {
    color: hsl(var(--primary));
  }

  .memorall-chat-container .memorall-context-label,
  .memorall-chat-container .memorall-context-attached-label-wrap {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .memorall-chat-container .memorall-context-attached-label-wrap {
    flex: 1 1 auto;
    font-size: 12px;
    font-weight: 700;
  }

  .memorall-chat-container .memorall-context-attach-text {
    flex-shrink: 0;
    color: hsl(var(--muted-foreground));
    font-size: 11px;
    font-weight: 600;
  }

  .memorall-chat-container .memorall-attached-title {
    margin-bottom: 8px;
    color: hsl(var(--muted-foreground));
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-section {
    max-height: min(250px, 34vh);
    padding: 10px 12px;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-header {
    margin-bottom: 8px;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-grid {
    gap: 7px;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-tile {
    min-height: 44px;
    padding: 7px 7px 7px 9px;
  }

  @media (max-width: 720px) {
    .memorall-chat-container .memorall-chat-shell--panel,
    .memorall-chat-container .memorall-chat-shell--popup {
      top: 8px;
      right: 8px;
      bottom: 8px;
      left: 8px;
      width: auto;
      height: auto;
      max-width: none;
      border: 1px solid hsl(var(--border));
      border-radius: 8px;
    }

    .memorall-chat-container .memorall-chat-header-inner {
      min-height: 50px;
      padding: 6px 8px;
    }

    .memorall-chat-container .memorall-model-chip {
      max-width: 42%;
    }

    .memorall-chat-container .memorall-icon-button {
      width: 44px;
      height: 44px;
    }

    .memorall-chat-container .memorall-composer-row {
      align-items: flex-end;
    }

    .memorall-chat-container .memorall-select {
      max-width: 132px;
    }

    .memorall-chat-container .memorall-context-section {
      max-height: min(230px, 32vh);
      padding: 10px 12px;
    }

    .memorall-chat-container .memorall-context-reveal {
      padding: 7px 12px;
    }

    .memorall-chat-container .memorall-context-reveal-button {
      min-height: 32px;
      padding: 0 9px;
    }

    .memorall-chat-container .memorall-context-reveal-smart-button {
      min-height: 32px;
      padding: 0 10px;
    }

    .memorall-chat-container .memorall-context-header {
      gap: 8px;
      margin-bottom: 8px;
    }

    .memorall-chat-container .memorall-context-title {
      font-size: 12px;
    }

    .memorall-chat-container .memorall-smart-select-button {
      min-height: 36px;
      padding: 0 10px;
      font-size: 12px;
    }

    .memorall-chat-container .memorall-context-grid {
      gap: 7px;
    }

    .memorall-chat-container .memorall-context-tile {
      min-height: 44px;
      padding: 7px 7px 7px 9px;
    }

    .memorall-chat-container .memorall-context-attach-button {
      gap: 6px;
      font-size: 12px;
    }

    .memorall-chat-container .memorall-context-attach-text {
      font-size: 10px;
    }

    .memorall-chat-container .memorall-context-preview-button {
      width: 28px;
      height: 28px;
    }
  }


  /* Restored: still referenced by the panel shell and the minimised button. */
  @keyframes slideInFromRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /*
   * "Still working" affordance. The old UI only showed a spinner while an
   * assistant message was completely empty, so as soon as any text or tool row
   * appeared there was nothing left saying the run was still going.
   */
  .memorall-chat-container .memorall-working {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    font-size: 12px;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
  }

  .memorall-chat-container .memorall-working-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .memorall-chat-container .memorall-working-dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: hsl(211 90% 56%);
    animation: memorallWorkingDot 1200ms ease-in-out infinite;
  }

  .memorall-chat-container .memorall-working-dot:nth-child(2) {
    animation-delay: 160ms;
  }

  .memorall-chat-container .memorall-working-dot:nth-child(3) {
    animation-delay: 320ms;
  }

  .memorall-chat-container .memorall-working-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes memorallWorkingDot {
    0%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    50% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  /* The running tool row should read as alive, not as a static bullet. */
  .memorall-chat-container .memorall-tool-summary-dot--active {
    animation: memorallPulseRing 1600ms ease-out infinite;
  }

  @keyframes memorallPulseRing {
    0% {
      box-shadow: 0 0 0 0 hsl(211 90% 56% / 0.45);
    }
    70% {
      box-shadow: 0 0 0 6px hsl(211 90% 56% / 0);
    }
    100% {
      box-shadow: 0 0 0 0 hsl(211 90% 56% / 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .memorall-chat-container .memorall-chat-shell,
    .memorall-chat-container .memorall-chat-minimized-button,
    .memorall-chat-container .memorall-working-dot,
    .memorall-chat-container .memorall-tool-summary-dot--active {
      animation: none;
    }

    .memorall-chat-container .memorall-working-dot {
      opacity: 0.75;
    }
  }

  /* What is riding along with the next message, shown on the composer itself. */
  .memorall-chat-container .memorall-composer-context {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    padding: 0 2px 8px;
  }

  .memorall-chat-container .memorall-composer-context-label {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.01em;
    color: hsl(var(--muted-foreground));
    flex-shrink: 0;
  }

  .memorall-chat-container .memorall-composer-context-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .memorall-chat-container .memorall-composer-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 3px 4px 3px 9px;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--muted) / 0.6);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.5;
    color: hsl(var(--foreground));
  }

  .memorall-chat-container .memorall-composer-chip-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .memorall-chat-container .memorall-composer-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    padding: 0;
  }

  .memorall-chat-container .memorall-composer-chip-remove:hover {
    background: hsl(var(--foreground) / 0.1);
    color: hsl(var(--foreground));
  }
`;
