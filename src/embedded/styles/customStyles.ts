export const customStyles = `
  :host {
    /* Ensure the shadow DOM inherits font settings */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  }

  /* CSS custom properties for shadcn/ui theming */
  .memorall-chat-container {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --primary: 0 0% 9%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 89.8%;
    --input: 0 0% 89.8%;
    --ring: 0 0% 3.9%;
    --radius: 0.5rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  }

  /* Force all child elements to inherit proper styling */
  .memorall-chat-container *,
  .memorall-chat-container *::before,
  .memorall-chat-container *::after {
    font-family: inherit !important;
    box-sizing: border-box !important;
  }

  /* Override default text colors for all elements */
  .memorall-chat-container {
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container *:not([class*="text-"]) {
    color: inherit !important;
  }

  .memorall-chat-container div,
  .memorall-chat-container span,
  .memorall-chat-container p,
  .memorall-chat-container h1,
  .memorall-chat-container h2,
  .memorall-chat-container h3,
  .memorall-chat-container h4,
  .memorall-chat-container h5,
  .memorall-chat-container h6,
  .memorall-chat-container button,
  .memorall-chat-container input,
  .memorall-chat-container textarea,
  .memorall-chat-container label,
  .memorall-chat-container summary {
    color: hsl(var(--foreground)) !important;
  }

  /* Override form element styles specifically */
  .memorall-chat-container input,
  .memorall-chat-container textarea {
    background-color: transparent !important;
    border: none !important;
    outline: none !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container input::placeholder,
  .memorall-chat-container textarea::placeholder {
    color: hsl(var(--muted-foreground)) !important;
  }

  /* Override Tailwind color classes with specific values and high specificity */
  .memorall-chat-container .bg-background {
    background-color: hsl(0 0% 100%) !important;
  }

  .memorall-chat-container .text-foreground {
    color: hsl(0 0% 3.9%) !important;
  }

  .memorall-chat-container .text-muted-foreground {
    color: hsl(0 0% 45.1%) !important;
  }

  .memorall-chat-container .bg-muted {
    background-color: hsl(0 0% 96.1%) !important;
  }

  .memorall-chat-container .bg-muted\/50 {
    background-color: hsl(0 0% 96.1% / 0.5) !important;
  }

  .memorall-chat-container .bg-muted\/30 {
    background-color: hsl(0 0% 96.1% / 0.3) !important;
  }

  .memorall-chat-container .bg-primary {
    background-color: hsl(0 0% 9%) !important;
  }

  .memorall-chat-container .text-primary {
    color: hsl(0 0% 9%) !important;
  }

  .memorall-chat-container .text-primary-foreground {
    color: hsl(0 0% 98%) !important;
  }

  .memorall-chat-container .bg-primary\/10 {
    background-color: hsl(0 0% 9% / 0.1) !important;
  }

  .memorall-chat-container .bg-primary\/90 {
    background-color: hsl(0 0% 9% / 0.9) !important;
  }

  .memorall-chat-container .border {
    border-color: hsl(0 0% 89.8%) !important;
  }

  .memorall-chat-container .border-border {
    border-color: hsl(0 0% 89.8%) !important;
  }

  .memorall-chat-container .border-primary\/20 {
    border-color: hsl(0 0% 9% / 0.2) !important;
  }

  .memorall-chat-container .hover\\:bg-accent:hover {
    background-color: hsl(0 0% 96.1%) !important;
  }

  .memorall-chat-container .hover\\:text-accent-foreground:hover {
    color: hsl(0 0% 9%) !important;
  }

  .memorall-chat-container .hover\\:bg-muted:hover {
    background-color: hsl(0 0% 96.1%) !important;
  }

  .memorall-chat-container .hover\\:bg-primary\\\/90:hover {
    background-color: hsl(0 0% 9% / 0.9) !important;
  }

  .memorall-chat-container .hover\\:text-foreground:hover {
    color: hsl(0 0% 3.9%) !important;
  }

  /* Specific color overrides for orange status */
  .memorall-chat-container .bg-orange-50 {
    background-color: hsl(33 100% 96%) !important;
  }

  .memorall-chat-container .border-orange-200 {
    border-color: hsl(33 94% 82%) !important;
  }

  .memorall-chat-container .bg-orange-400 {
    background-color: hsl(33 91% 56%) !important;
  }

  .memorall-chat-container .text-orange-600 {
    color: hsl(33 91% 40%) !important;
  }

  /* Green status colors */
  .memorall-chat-container .bg-green-500 {
    background-color: hsl(142 76% 36%) !important;
  }

  /* Red status colors */
  .memorall-chat-container .bg-red-500 {
    background-color: hsl(0 84% 60%) !important;
  }

  /* Black background with opacity */
  .memorall-chat-container .bg-black\\\/30 {
    background-color: rgba(0, 0, 0, 0.3) !important;
  }

  /* Layout and positioning overrides */
  .memorall-chat-container .fixed {
    position: fixed !important;
  }

  .memorall-chat-container .relative {
    position: relative !important;
  }

  .memorall-chat-container .absolute {
    position: absolute !important;
  }

  .memorall-chat-container .inset-0 {
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    left: 0 !important;
  }

  .memorall-chat-container .right-0 {
    right: 0 !important;
  }

  .memorall-chat-container .top-0 {
    top: 0 !important;
  }

  .memorall-chat-container .bottom-2 {
    bottom: 0.5rem !important;
  }

  .memorall-chat-container .right-2 {
    right: 0.5rem !important;
  }

  .memorall-chat-container .h-full {
    height: 100% !important;
  }

  .memorall-chat-container .w-full {
    width: 100% !important;
  }

  .memorall-chat-container .max-w-\\[30\\%\\] {
    max-width: 30% !important;
  }

  .memorall-chat-container .min-w-\\[400px\\] {
    min-width: 400px !important;
  }

  .memorall-chat-container .max-w-\\[85\\%\\] {
    max-width: 85% !important;
  }

  .memorall-chat-container .flex {
    display: flex !important;
  }

  .memorall-chat-container .flex-col {
    flex-direction: column !important;
  }

  .memorall-chat-container .flex-1 {
    flex: 1 1 0% !important;
  }

  .memorall-chat-container .flex-shrink-0 {
    flex-shrink: 0 !important;
  }

  .memorall-chat-container .items-center {
    align-items: center !important;
  }

  .memorall-chat-container .items-start {
    align-items: flex-start !important;
  }

  .memorall-chat-container .items-end {
    align-items: flex-end !important;
  }

  .memorall-chat-container .justify-center {
    justify-content: center !important;
  }

  .memorall-chat-container .justify-between {
    justify-content: space-between !important;
  }

  .memorall-chat-container .overflow-hidden {
    overflow: hidden !important;
  }

  .memorall-chat-container .overflow-y-auto {
    overflow-y: auto !important;
  }

  .memorall-chat-container .z-\\[999999\\] {
    z-index: 999999 !important;
  }

  /* Spacing overrides */
  .memorall-chat-container .p-2 {
    padding: 0.5rem !important;
  }

  .memorall-chat-container .p-3 {
    padding: 0.75rem !important;
  }

  .memorall-chat-container .px-3 {
    padding-left: 0.75rem !important;
    padding-right: 0.75rem !important;
  }

  .memorall-chat-container .px-4 {
    padding-left: 1rem !important;
    padding-right: 1rem !important;
  }

  .memorall-chat-container .py-1 {
    padding-top: 0.25rem !important;
    padding-bottom: 0.25rem !important;
  }

  .memorall-chat-container .py-2 {
    padding-top: 0.5rem !important;
    padding-bottom: 0.5rem !important;
  }

  .memorall-chat-container .py-3 {
    padding-top: 0.75rem !important;
    padding-bottom: 0.75rem !important;
  }

  .memorall-chat-container .py-4 {
    padding-top: 1rem !important;
    padding-bottom: 1rem !important;
  }

  .memorall-chat-container .py-8 {
    padding-top: 2rem !important;
    padding-bottom: 2rem !important;
  }

  .memorall-chat-container .gap-1 {
    gap: 0.25rem !important;
  }

  .memorall-chat-container .gap-2 {
    gap: 0.5rem !important;
  }

  .memorall-chat-container .gap-3 {
    gap: 0.75rem !important;
  }

  .memorall-chat-container .space-y-2 > * + * {
    margin-top: 0.5rem !important;
  }

  .memorall-chat-container .space-y-3 > * + * {
    margin-top: 0.75rem !important;
  }

  .memorall-chat-container .space-y-4 > * + * {
    margin-top: 1rem !important;
  }

  .memorall-chat-container .ml-1 {
    margin-left: 0.25rem !important;
  }

  .memorall-chat-container .ml-auto {
    margin-left: auto !important;
  }

  .memorall-chat-container .pl-5 {
    padding-left: 1.25rem !important;
  }

  .memorall-chat-container .mb-2 {
    margin-bottom: 0.5rem !important;
  }

  .memorall-chat-container .mb-3 {
    margin-bottom: 0.75rem !important;
  }

  .memorall-chat-container .mt-1 {
    margin-top: 0.25rem !important;
  }

  .memorall-chat-container .mt-2 {
    margin-top: 0.5rem !important;
  }

  /* Typography overrides */
  .memorall-chat-container .text-xs {
    font-size: 0.75rem !important;
    line-height: 1rem !important;
  }

  .memorall-chat-container .text-sm {
    font-size: 0.875rem !important;
    line-height: 1.25rem !important;
  }

  .memorall-chat-container .font-medium {
    font-weight: 500 !important;
  }

  .memorall-chat-container .font-semibold {
    font-weight: 600 !important;
  }

  .memorall-chat-container .leading-relaxed {
    line-height: 1.625 !important;
  }

  .memorall-chat-container .text-center {
    text-align: center !important;
  }

  .memorall-chat-container .truncate {
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  /* Border and radius overrides */
  .memorall-chat-container .border-0 {
    border-width: 0 !important;
  }

  .memorall-chat-container .border-t {
    border-top-width: 1px !important;
    border-top-style: solid !important;
  }

  .memorall-chat-container .border-b {
    border-bottom-width: 1px !important;
    border-bottom-style: solid !important;
  }

  .memorall-chat-container .border-l {
    border-left-width: 1px !important;
    border-left-style: solid !important;
  }

  .memorall-chat-container .rounded {
    border-radius: 0.25rem !important;
  }

  .memorall-chat-container .rounded-lg {
    border-radius: 0.5rem !important;
  }

  .memorall-chat-container .rounded-full {
    border-radius: 9999px !important;
  }

  .memorall-chat-container .rounded-md {
    border-radius: 0.375rem !important;
  }

  /* Shadow overrides */
  .memorall-chat-container .shadow-sm {
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
  }

  .memorall-chat-container .shadow-2xl {
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
  }

  /* Sizing overrides */
  .memorall-chat-container .w-1\\.5 {
    width: 0.375rem !important;
  }

  .memorall-chat-container .h-1\\.5 {
    height: 0.375rem !important;
  }

  .memorall-chat-container .w-2 {
    width: 0.5rem !important;
  }

  .memorall-chat-container .h-2 {
    height: 0.5rem !important;
  }

  .memorall-chat-container .w-3 {
    width: 0.75rem !important;
  }

  .memorall-chat-container .h-3 {
    height: 0.75rem !important;
  }

  .memorall-chat-container .w-4 {
    width: 1rem !important;
  }

  .memorall-chat-container .h-4 {
    height: 1rem !important;
  }

  .memorall-chat-container .w-8 {
    width: 2rem !important;
  }

  .memorall-chat-container .h-8 {
    height: 2rem !important;
  }

  .memorall-chat-container .w-12 {
    width: 3rem !important;
  }

  .memorall-chat-container .h-12 {
    height: 3rem !important;
  }

  .memorall-chat-container .min-h-\\[50px\\] {
    min-height: 50px !important;
  }

  .memorall-chat-container .max-h-32 {
    max-height: 8rem !important;
  }

  /* Interactive states */
  .memorall-chat-container .cursor-pointer {
    cursor: pointer !important;
  }

  .memorall-chat-container .cursor-not-allowed {
    cursor: not-allowed !important;
  }

  .memorall-chat-container .pointer-events-none {
    pointer-events: none !important;
  }

  .memorall-chat-container .user-select-none {
    user-select: none !important;
  }

  /* Animation overrides */
  .memorall-chat-container .animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
  }

  .memorall-chat-container .animate-spin {
    animation: spin 1s linear infinite !important;
  }

  .memorall-chat-container .transition-colors {
    transition-property: color, background-color, border-color, text-decoration-color, fill, stroke !important;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1) !important;
    transition-duration: 150ms !important;
  }

  .memorall-chat-container .transition-transform {
    transition-property: transform !important;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1) !important;
    transition-duration: 150ms !important;
  }

  /* Transform overrides */
  .memorall-chat-container .group-open\\:rotate-90 {
    --tw-rotate: 90deg !important;
    transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)) !important;
  }

  .memorall-chat-container details[open] .group-open\\:rotate-90 {
    --tw-rotate: 90deg !important;
    transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)) !important;
  }

  /* Reset and disable styles */
  .memorall-chat-container .resize-none {
    resize: none !important;
  }

  .memorall-chat-container .bg-transparent {
    background-color: transparent !important;
  }

  .memorall-chat-container .placeholder\\:text-muted-foreground::placeholder {
    color: hsl(var(--muted-foreground)) !important;
  }

  .memorall-chat-container .focus\\:outline-none:focus {
    outline: 2px solid transparent !important;
    outline-offset: 2px !important;
  }

  .memorall-chat-container .focus-visible\\:outline-none:focus-visible {
    outline: 2px solid transparent !important;
    outline-offset: 2px !important;
  }

  .memorall-chat-container .focus-visible\\:ring-2:focus-visible {
    --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color) !important;
    --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color) !important;
    box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow) !important;
  }

  .memorall-chat-container .focus-visible\\:ring-ring:focus-visible {
    --tw-ring-color: hsl(var(--ring)) !important;
  }

  .memorall-chat-container .disabled\\:cursor-not-allowed:disabled {
    cursor: not-allowed !important;
  }

  .memorall-chat-container .disabled\\:pointer-events-none:disabled {
    pointer-events: none !important;
  }

  .memorall-chat-container .disabled\\:opacity-50:disabled {
    opacity: 0.5 !important;
  }

  /* Object fit for images */
  .memorall-chat-container .object-contain {
    object-fit: contain !important;
  }

  /* Task/Action component styles */
  .memorall-chat-container details {
    margin: 0 !important;
    padding: 0 !important;
  }

  .memorall-chat-container details summary {
    list-style: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .memorall-chat-container details summary::-webkit-details-marker {
    display: none !important;
  }

  .memorall-chat-container details summary::-moz-list-bullet {
    list-style-type: none !important;
  }

  /* Markdown content styles */
  .memorall-chat-container strong {
    font-weight: 600 !important;
  }

  .memorall-chat-container em {
    font-style: italic !important;
  }

  .memorall-chat-container code {
    font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Fira Mono", "Droid Sans Mono", "Consolas", monospace !important;
  }

  /* Group state handling for task components */
  .memorall-chat-container details[open] .group-open\\:rotate-90 {
    transform: rotate(90deg) !important;
  }

  /* Keyframe animations */
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

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

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* Animation classes with specific values */
  .memorall-chat-container .animate-in {
    animation-fill-mode: both !important;
  }

  .memorall-chat-container .fade-in {
    animation-name: fadeIn !important;
  }

  .memorall-chat-container .slide-in-from-right {
    animation-name: slideInFromRight !important;
  }

  .memorall-chat-container .duration-200 {
    animation-duration: 200ms !important;
  }

  .memorall-chat-container .duration-300 {
    animation-duration: 300ms !important;
  }

  /* Memorall embedded chat shell */
  .memorall-chat-container .memorall-embedded-root {
    position: fixed !important;
    inset: 0 !important;
    z-index: 999999 !important;
    pointer-events: none !important;
    font-family: inherit !important;
  }

  .memorall-chat-container .memorall-chat-shell {
    position: fixed !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    border-color: hsl(var(--border)) !important;
    box-shadow:
      0 18px 56px rgba(0, 0, 0, 0.22),
      0 2px 12px rgba(0, 0, 0, 0.12) !important;
    pointer-events: auto !important;
    animation: slideInFromRight 220ms ease-out both !important;
  }

  .memorall-chat-container .memorall-chat-shell--panel {
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: clamp(380px, 32vw, 520px) !important;
    max-width: calc(100vw - 16px) !important;
    border-left: 1px solid hsl(var(--border)) !important;
  }

  .memorall-chat-container .memorall-chat-shell--popup {
    right: 12px !important;
    bottom: 12px !important;
    width: min(420px, calc(100vw - 24px)) !important;
    height: min(640px, calc(100vh - 24px)) !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
  }

  .memorall-chat-container .memorall-embedded-root--minimized {
    pointer-events: none !important;
  }

  .memorall-chat-container .memorall-chat-minimized-button {
    position: fixed !important;
    right: 18px !important;
    bottom: 18px !important;
    width: 54px !important;
    height: 54px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 999px !important;
    background: hsl(var(--background) / 0.96) !important;
    color: hsl(var(--foreground)) !important;
    box-shadow:
      0 16px 40px rgba(0, 0, 0, 0.22),
      0 2px 8px rgba(0, 0, 0, 0.12) !important;
    backdrop-filter: blur(12px) !important;
    cursor: pointer !important;
    pointer-events: auto !important;
    animation: slideInFromRight 180ms ease-out both !important;
  }

  .memorall-chat-container .memorall-chat-minimized-button:hover {
    transform: translateY(-1px) !important;
    background: hsl(var(--muted)) !important;
  }

  .memorall-chat-container .memorall-chat-minimized-button:focus-visible {
    outline: 2px solid hsl(var(--ring)) !important;
    outline-offset: 2px !important;
  }

  .memorall-chat-container .memorall-chat-minimized-logo {
    width: 30px !important;
    height: 30px !important;
    object-fit: contain !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart {
    top: 12px !important;
    right: 12px !important;
    bottom: auto !important;
    width: min(420px, calc(100vw - 24px)) !important;
    height: auto !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background) / 0.96) !important;
    backdrop-filter: blur(12px) !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-header-inner {
    min-height: 48px !important;
    padding: 8px 14px !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-title {
    max-width: 100% !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-header-actions {
    display: none !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-chat-brand {
    display: none !important;
  }

  .memorall-chat-container .memorall-chat-shell--smart .memorall-model-chip {
    max-width: none !important;
    flex: 1 1 auto !important;
  }

  .memorall-chat-container .memorall-smart-select-notice {
    padding: 14px !important;
  }

  .memorall-chat-container .memorall-smart-select-notice-card {
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--muted) / 0.22) !important;
    padding: 16px !important;
  }

  .memorall-chat-container .memorall-smart-select-notice-title {
    color: hsl(var(--foreground)) !important;
    font-size: 16px !important;
    font-weight: 700 !important;
    line-height: 1.25 !important;
  }

  .memorall-chat-container .memorall-smart-select-notice-text {
    margin: 8px 0 0 !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 14px !important;
    line-height: 1.6 !important;
  }

  .memorall-chat-container .memorall-smart-select-cancel-button {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    min-height: 36px !important;
    margin-top: 14px !important;
    border: 0 !important;
    border-radius: 8px !important;
    background: hsl(0 84% 60%) !important;
    color: white !important;
    padding: 8px 14px !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    cursor: pointer !important;
  }

  .memorall-chat-container .memorall-smart-select-cancel-button:hover {
    background: hsl(0 72% 51%) !important;
  }

  .memorall-chat-container .memorall-chat-header {
    flex-shrink: 0 !important;
    border-bottom: 1px solid hsl(var(--border)) !important;
    background: hsl(var(--background) / 0.96) !important;
    backdrop-filter: blur(10px) !important;
  }

  .memorall-chat-container .memorall-chat-header-inner {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 10px !important;
    min-height: 52px !important;
    padding: 8px 12px !important;
  }

  .memorall-chat-container .memorall-chat-title {
    display: flex !important;
    min-width: 0 !important;
    flex: 1 1 auto !important;
    align-items: center !important;
    gap: 10px !important;
  }

  .memorall-chat-container .memorall-chat-logo,
  .memorall-chat-container .memorall-empty-logo-image {
    width: 24px !important;
    height: 24px !important;
    object-fit: contain !important;
    flex-shrink: 0 !important;
  }

  .memorall-chat-container .memorall-chat-brand {
    flex-shrink: 0 !important;
    color: hsl(var(--foreground)) !important;
    font-size: 14px !important;
    font-weight: 650 !important;
    line-height: 1 !important;
  }

  .memorall-chat-container .memorall-model-chip {
    display: inline-flex !important;
    min-width: 0 !important;
    max-width: 100% !important;
    flex: 1 1 auto !important;
    align-items: center !important;
    gap: 6px !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 999px !important;
    padding: 4px 8px !important;
    background: hsl(var(--muted) / 0.55) !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 11px !important;
    line-height: 1.2 !important;
  }

  .memorall-chat-container .memorall-model-dot {
    width: 6px !important;
    height: 6px !important;
    flex-shrink: 0 !important;
    border-radius: 999px !important;
    background: hsl(142 70% 45%) !important;
  }

  .memorall-chat-container .memorall-model-chip--empty .memorall-model-dot {
    background: hsl(0 84% 60%) !important;
  }

  .memorall-chat-container .memorall-model-name {
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  .memorall-chat-container .memorall-header-actions,
  .memorall-chat-container .memorall-composer-actions {
    display: flex !important;
    flex-shrink: 0 !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .memorall-chat-container .memorall-icon-button {
    display: inline-flex !important;
    width: 40px !important;
    height: 40px !important;
    flex-shrink: 0 !important;
    align-items: center !important;
    justify-content: center !important;
    border: 0 !important;
    border-radius: 8px !important;
    background: transparent !important;
    color: hsl(var(--muted-foreground)) !important;
    cursor: pointer !important;
    transition:
      background-color 150ms ease,
      color 150ms ease,
      transform 150ms ease !important;
  }

  .memorall-chat-container .memorall-icon-button:hover {
    background: hsl(var(--muted)) !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-icon-button--active {
    background: hsl(var(--primary) / 0.12) !important;
    color: hsl(var(--primary)) !important;
  }

  .memorall-chat-container .memorall-icon-button:focus-visible,
  .memorall-chat-container .memorall-submit-button:focus-visible,
  .memorall-chat-container .memorall-suggested-prompt:focus-visible,
  .memorall-chat-container .memorall-context-cta:focus-visible {
    outline: 2px solid hsl(var(--ring)) !important;
    outline-offset: 2px !important;
  }

  .memorall-chat-container .memorall-icon-button--compact {
    width: 34px !important;
    height: 34px !important;
  }

  .memorall-chat-container .memorall-icon-button--danger:hover {
    background: hsl(0 84% 60%) !important;
    color: white !important;
  }

  .memorall-chat-container .memorall-icon {
    width: 16px !important;
    height: 16px !important;
  }

  .memorall-chat-container .memorall-conversation-content {
    min-height: 100% !important;
    overflow-y: auto !important;
    padding: 18px 16px !important;
  }

  .memorall-chat-container .memorall-message {
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
  }

  .memorall-chat-container .memorall-message--user {
    align-items: flex-end !important;
  }

  .memorall-chat-container .memorall-message--assistant {
    align-items: flex-start !important;
  }

  .memorall-chat-container .memorall-message-content {
    max-width: 100% !important;
    overflow-wrap: anywhere !important;
    font-size: 13px !important;
    line-height: 1.55 !important;
  }

  .memorall-chat-container .memorall-message-content--user {
    max-width: 86% !important;
    border: 1px solid hsl(var(--primary) / 0.18) !important;
    border-radius: 8px !important;
    background: hsl(var(--primary)) !important;
    color: hsl(var(--primary-foreground)) !important;
    padding: 10px 12px !important;
    text-align: left !important;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08) !important;
  }

  .memorall-chat-container .memorall-submit-button *,
  .memorall-chat-container .memorall-user-text {
    color: hsl(var(--primary-foreground)) !important;
  }

  .memorall-chat-container .memorall-user-text--with-context {
    overflow-wrap: anywhere !important;
    line-height: 1.45 !important;
  }

  .memorall-chat-container .memorall-user-context {
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-user-text-card {
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-user-context-card {
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--card)) !important;
    color: hsl(var(--card-foreground)) !important;
  }

  .memorall-chat-container .memorall-user-context-card-header {
    background: hsl(var(--card)) !important;
    color: hsl(var(--card-foreground)) !important;
  }

  .memorall-chat-container .memorall-user-context-card-header:hover,
  .memorall-chat-container .memorall-user-context-icon-button:hover {
    background: hsl(var(--accent)) !important;
  }

  .memorall-chat-container .memorall-user-context-card-title,
  .memorall-chat-container .memorall-user-context-pre {
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-user-context-card-subtitle,
  .memorall-chat-container .memorall-user-context-card-icon {
    color: hsl(var(--muted-foreground)) !important;
  }

  .memorall-chat-container .memorall-user-context-expanded {
    background: hsl(var(--muted) / 0.3) !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context {
    margin-top: 8px !important;
    border: 1px solid hsl(var(--primary-foreground) / 0.32) !important;
    border-radius: 8px !important;
    background: transparent !important;
    color: hsl(var(--primary-foreground)) !important;
    padding: 8px 9px !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-header {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
    margin-bottom: 6px !important;
    font-size: 11px !important;
    font-weight: 750 !important;
    letter-spacing: 0 !important;
    opacity: 0.86 !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-dot {
    width: 7px !important;
    height: 7px !important;
    border-radius: 999px !important;
    background: hsl(var(--primary-foreground)) !important;
    flex: 0 0 auto !important;
    opacity: 0.78 !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-label {
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1.35 !important;
    overflow-wrap: anywhere !important;
    color: hsl(var(--primary-foreground)) !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-selector {
    margin-top: 4px !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 10.5px !important;
    line-height: 1.35 !important;
    opacity: 0.68 !important;
    overflow-wrap: anywhere !important;
    color: hsl(var(--primary-foreground)) !important;
  }

  .memorall-chat-container .memorall-co-agent-hover-context-text {
    margin-top: 7px !important;
    border-top: 1px solid hsl(var(--primary-foreground) / 0.18) !important;
    padding-top: 7px !important;
    font-size: 11.5px !important;
    line-height: 1.45 !important;
    opacity: 0.78 !important;
    overflow-wrap: anywhere !important;
    color: hsl(var(--primary-foreground)) !important;
  }

  .memorall-chat-container .memorall-message-content--assistant {
    width: 100% !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-assistant-content {
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    width: 100% !important;
  }

  .memorall-chat-container .memorall-openui-notice {
    display: grid !important;
    grid-template-columns: auto 1fr auto !important;
    align-items: center !important;
    gap: 10px !important;
    width: 100% !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--muted) / 0.32) !important;
    padding: 10px !important;
  }

  .memorall-chat-container .memorall-openui-notice__icon {
    display: inline-flex !important;
    width: 24px !important;
    height: 24px !important;
    align-items: center !important;
    justify-content: center !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 6px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    font-size: 16px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
  }

  .memorall-chat-container .memorall-openui-notice__text {
    min-width: 0 !important;
    color: hsl(var(--foreground)) !important;
    font-size: 12px !important;
    font-weight: 650 !important;
    line-height: 1.35 !important;
  }

  .memorall-chat-container .memorall-openui-notice__button {
    display: inline-flex !important;
    height: 32px !important;
    align-items: center !important;
    justify-content: center !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    padding: 0 10px !important;
    white-space: nowrap !important;
  }

  .memorall-chat-container .memorall-openui-notice__button:hover {
    background: hsl(var(--muted)) !important;
  }

  .memorall-chat-container .memorall-openui-content {
    width: 100% !important;
    max-width: 100% !important;
    overflow: hidden !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-openui-content input,
  .memorall-chat-container .memorall-openui-content textarea,
  .memorall-chat-container .memorall-openui-content select {
    border: 1px solid hsl(var(--input)) !important;
    background-color: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    outline: none !important;
  }

  .memorall-chat-container .memorall-openui-content textarea {
    min-height: 80px !important;
    resize: vertical !important;
  }

  .memorall-chat-container .memorall-openui-content input[type="checkbox"],
  .memorall-chat-container .memorall-openui-content input[type="radio"] {
    width: 1rem !important;
    height: 1rem !important;
    flex-shrink: 0 !important;
    border: 1px solid hsl(var(--border)) !important;
    accent-color: hsl(var(--primary)) !important;
  }

  .memorall-chat-container .memorall-markdown {
    color: hsl(var(--foreground)) !important;
    font-size: 14px !important;
    line-height: 1.65 !important;
  }

  .memorall-chat-container .memorall-markdown > *:first-child {
    margin-top: 0 !important;
  }

  .memorall-chat-container .memorall-markdown > *:last-child {
    margin-bottom: 0 !important;
  }

  .memorall-chat-container .memorall-markdown p,
  .memorall-chat-container .memorall-markdown ul,
  .memorall-chat-container .memorall-markdown ol,
  .memorall-chat-container .memorall-markdown blockquote,
  .memorall-chat-container .memorall-markdown pre,
  .memorall-chat-container .memorall-markdown table {
    margin: 0 0 12px !important;
  }

  .memorall-chat-container .memorall-markdown h1,
  .memorall-chat-container .memorall-markdown h2,
  .memorall-chat-container .memorall-markdown h3 {
    margin: 18px 0 8px !important;
    color: hsl(var(--foreground)) !important;
    font-weight: 700 !important;
    line-height: 1.25 !important;
  }

  .memorall-chat-container .memorall-markdown h1 {
    font-size: 20px !important;
  }

  .memorall-chat-container .memorall-markdown h2 {
    font-size: 17px !important;
  }

  .memorall-chat-container .memorall-markdown h3 {
    font-size: 15px !important;
  }

  .memorall-chat-container .memorall-markdown ul,
  .memorall-chat-container .memorall-markdown ol {
    padding-left: 22px !important;
  }

  .memorall-chat-container .memorall-markdown li {
    margin: 4px 0 !important;
    padding-left: 2px !important;
  }

  .memorall-chat-container .memorall-markdown a {
    color: hsl(211 90% 56%) !important;
    text-decoration: underline !important;
    text-underline-offset: 2px !important;
  }

  .memorall-chat-container .memorall-markdown blockquote {
    border-left: 3px solid hsl(var(--border)) !important;
    color: hsl(var(--muted-foreground)) !important;
    padding-left: 12px !important;
  }

  .memorall-chat-container .memorall-markdown-inline-code {
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 5px !important;
    background: hsl(var(--muted) / 0.75) !important;
    color: hsl(var(--foreground)) !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 0.88em !important;
    padding: 1px 5px !important;
  }

  .memorall-chat-container .memorall-markdown-codeblock {
    max-width: 100% !important;
    overflow-x: auto !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--muted) / 0.55) !important;
    padding: 12px !important;
  }

  .memorall-chat-container .memorall-markdown-codeblock code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 12px !important;
    white-space: pre !important;
  }

  .memorall-chat-container .memorall-markdown-table-wrap {
    max-width: 100% !important;
    overflow-x: auto !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
  }

  .memorall-chat-container .memorall-markdown table {
    width: 100% !important;
    border-collapse: collapse !important;
    margin: 0 !important;
  }

  .memorall-chat-container .memorall-markdown th,
  .memorall-chat-container .memorall-markdown td {
    border-bottom: 1px solid hsl(var(--border)) !important;
    padding: 8px 10px !important;
    text-align: left !important;
    vertical-align: top !important;
  }

  .memorall-chat-container .memorall-markdown th {
    background: hsl(var(--muted) / 0.75) !important;
    font-weight: 650 !important;
  }

  .memorall-chat-container .memorall-markdown tr:last-child td {
    border-bottom: 0 !important;
  }

  .memorall-chat-container .memorall-markdown img {
    max-width: 100% !important;
    height: auto !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
  }

  .memorall-chat-container .memorall-markdown-checkbox {
    display: inline-flex !important;
    width: 14px !important;
    height: 14px !important;
    align-items: center !important;
    justify-content: center !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 4px !important;
    background: hsl(var(--muted) / 0.45) !important;
    color: hsl(var(--foreground)) !important;
    font-size: 11px !important;
    line-height: 1 !important;
    margin-right: 6px !important;
  }

  .memorall-chat-container .memorall-tool-summary-list {
    display: flex !important;
    flex-direction: column !important;
    gap: 8px !important;
    width: 100% !important;
  }

  .memorall-chat-container .memorall-tool-summary {
    width: 100% !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--muted) / 0.35) !important;
    padding: 9px 10px !important;
  }

  .memorall-chat-container .memorall-tool-summary-main {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    min-width: 0 !important;
    list-style: none !important;
    cursor: default !important;
  }

  .memorall-chat-container details.memorall-tool-summary .memorall-tool-summary-main {
    cursor: pointer !important;
  }

  .memorall-chat-container .memorall-tool-summary-main::-webkit-details-marker {
    display: none !important;
  }

  .memorall-chat-container .memorall-tool-summary-dot {
    width: 7px !important;
    height: 7px !important;
    flex-shrink: 0 !important;
    border-radius: 999px !important;
    background: hsl(142 70% 45%) !important;
  }

  .memorall-chat-container .memorall-tool-summary-dot--active {
    background: hsl(211 90% 56%) !important;
    box-shadow: 0 0 0 3px hsl(211 90% 56% / 0.16) !important;
  }

  .memorall-chat-container .memorall-tool-summary-title {
    min-width: 0 !important;
    flex: 1 1 auto !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    font-size: 12px !important;
    font-weight: 650 !important;
  }

  .memorall-chat-container .memorall-tool-summary-status {
    flex-shrink: 0 !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 999px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 11px !important;
    line-height: 1 !important;
    padding: 4px 7px !important;
  }

  .memorall-chat-container .memorall-tool-summary-description {
    margin-top: 6px !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 12px !important;
    line-height: 1.45 !important;
  }

  .memorall-chat-container .memorall-tool-summary-code {
    max-height: 180px !important;
    overflow: auto !important;
    margin: 8px 0 0 !important;
    border-radius: 6px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 11px !important;
    padding: 8px !important;
    white-space: pre-wrap !important;
  }

  .memorall-chat-container .memorall-artifact-card {
    width: 100% !important;
    overflow: hidden !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--card)) !important;
  }

  .memorall-chat-container .memorall-artifact-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 10px !important;
    border-bottom: 1px solid hsl(var(--border)) !important;
    padding: 9px 10px !important;
  }

  .memorall-chat-container .memorall-artifact-title {
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    font-size: 12px !important;
    font-weight: 650 !important;
  }

  .memorall-chat-container .memorall-artifact-open {
    flex-shrink: 0 !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 7px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    padding: 5px 8px !important;
  }

  .memorall-chat-container .memorall-artifact-frame {
    display: block !important;
    width: 100% !important;
    height: 300px !important;
    border: 0 !important;
    background: white !important;
  }

  .memorall-chat-container .memorall-artifact-frame--url {
    height: 240px !important;
    border-top: 1px solid hsl(var(--border)) !important;
  }

  .memorall-chat-container .memorall-artifact-url-text {
    overflow-wrap: anywhere !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 12px !important;
    padding: 10px !important;
  }

  .memorall-chat-container .memorall-empty-state {
    display: flex !important;
    min-height: 100% !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 28px 18px !important;
    text-align: center !important;
  }

  .memorall-chat-container .memorall-empty-logo {
    display: flex !important;
    width: 48px !important;
    height: 48px !important;
    align-items: center !important;
    justify-content: center !important;
    overflow: hidden !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 999px !important;
    background: hsl(var(--muted)) !important;
    margin-bottom: 12px !important;
  }

  .memorall-chat-container .memorall-empty-kicker {
    max-width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    letter-spacing: 0 !important;
    margin-bottom: 6px !important;
  }

  .memorall-chat-container .memorall-empty-title {
    margin: 0 0 8px !important;
    color: hsl(var(--foreground)) !important;
    font-size: 18px !important;
    font-weight: 700 !important;
    line-height: 1.25 !important;
  }

  .memorall-chat-container .memorall-empty-description {
    max-width: 320px !important;
    margin: 0 !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 12px !important;
    line-height: 1.55 !important;
  }

  .memorall-chat-container .memorall-suggested-prompts {
    display: flex !important;
    flex-wrap: wrap !important;
    justify-content: center !important;
    gap: 8px !important;
    margin-top: 16px !important;
  }

  .memorall-chat-container .memorall-suggested-prompt,
  .memorall-chat-container .memorall-context-cta {
    min-height: 34px !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    line-height: 1.2 !important;
    padding: 8px 10px !important;
    transition:
      background-color 150ms ease,
      border-color 150ms ease !important;
  }

  .memorall-chat-container .memorall-suggested-prompt:hover,
  .memorall-chat-container .memorall-context-cta:hover {
    border-color: hsl(var(--primary) / 0.35) !important;
    background: hsl(var(--muted)) !important;
  }

  .memorall-chat-container .memorall-context-cta {
    margin-top: 12px !important;
    background: hsl(var(--primary)) !important;
    color: hsl(var(--primary-foreground)) !important;
  }

  .memorall-chat-container .memorall-composer {
    flex-shrink: 0 !important;
    border-top: 1px solid hsl(var(--border)) !important;
    background: hsl(var(--background)) !important;
    padding: 10px !important;
  }

  .memorall-chat-container .memorall-prompt-input {
    position: relative !important;
    overflow: hidden !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03) !important;
  }

  .memorall-chat-container .memorall-prompt-input:focus-within {
    border-color: hsl(var(--ring)) !important;
  }

  .memorall-chat-container .memorall-prompt-textarea {
    display: block !important;
    width: 100% !important;
    min-height: 64px !important;
    max-height: 144px !important;
    resize: none !important;
    border: 0 !important;
    background: transparent !important;
    color: hsl(var(--foreground)) !important;
    font-size: 13px !important;
    line-height: 1.45 !important;
    outline: none !important;
    padding: 10px 12px !important;
  }

  .memorall-chat-container .memorall-prompt-textarea:disabled {
    cursor: not-allowed !important;
    opacity: 0.55 !important;
  }

  .memorall-chat-container .memorall-prompt-toolbar {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
    border-top: 1px solid hsl(var(--border)) !important;
    padding: 8px !important;
  }

  .memorall-chat-container .memorall-composer-row {
    display: flex !important;
    min-width: 0 !important;
    width: 100% !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .memorall-chat-container .memorall-composer-scroll {
    min-width: 0 !important;
    flex: 1 1 auto !important;
    overflow-x: auto !important;
    scrollbar-width: none !important;
  }

  .memorall-chat-container .memorall-composer-scroll::-webkit-scrollbar {
    display: none !important;
  }

  .memorall-chat-container .memorall-prompt-tools {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
  }

  .memorall-chat-container .memorall-select-wrap {
    min-width: 0 !important;
    flex-shrink: 0 !important;
  }

  .memorall-chat-container .memorall-select {
    max-width: 156px !important;
    min-height: 34px !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    font-size: 12px !important;
    line-height: 1.2 !important;
    outline: none !important;
    padding: 0 28px 0 10px !important;
  }

  .memorall-chat-container .memorall-select:focus {
    border-color: hsl(var(--ring)) !important;
  }

  .memorall-chat-container .memorall-submit-button {
    display: inline-flex !important;
    min-width: 58px !important;
    height: 36px !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 6px !important;
    border: 0 !important;
    border-radius: 8px !important;
    background: hsl(var(--primary)) !important;
    color: hsl(var(--primary-foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    padding: 0 12px !important;
    transition:
      opacity 150ms ease,
      transform 150ms ease !important;
  }

  .memorall-chat-container .memorall-submit-button:not(:disabled):hover {
    transform: translateY(-1px) !important;
  }

  .memorall-chat-container .memorall-submit-button:disabled {
    cursor: not-allowed !important;
    opacity: 0.5 !important;
  }

  .memorall-chat-container .memorall-context-section {
    flex-shrink: 0 !important;
    max-height: min(300px, 38vh) !important;
    overflow-y: auto !important;
    overscroll-behavior: contain !important;
    border-top: 1px solid hsl(var(--border)) !important;
    background: hsl(var(--muted) / 0.24) !important;
    padding: 12px 14px !important;
  }

  .memorall-chat-container .memorall-context-reveal {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
    flex-shrink: 0 !important;
    border-top: 1px solid hsl(var(--border)) !important;
    background: hsl(var(--muted) / 0.18) !important;
    padding: 8px 12px !important;
  }

  .memorall-chat-container .memorall-context-reveal-button,
  .memorall-chat-container .memorall-context-reveal-smart-button {
    display: inline-flex !important;
    min-height: 34px !important;
    align-items: center !important;
    gap: 8px !important;
    border: 1px solid transparent !important;
    border-radius: 8px !important;
    background: transparent !important;
    color: hsl(var(--muted-foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 650 !important;
    line-height: 1 !important;
    padding: 0 10px !important;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease !important;
  }

  .memorall-chat-container .memorall-context-reveal-smart-button {
    flex-shrink: 0 !important;
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    font-weight: 700 !important;
    padding: 0 12px !important;
  }

  .memorall-chat-container .memorall-context-reveal-button:hover,
  .memorall-chat-container .memorall-context-reveal-smart-button:hover {
    border-color: hsl(var(--border)) !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-context-reveal-smart-button:hover {
    border-color: hsl(var(--primary) / 0.28) !important;
    background: hsl(var(--muted)) !important;
  }

  .memorall-chat-container .memorall-context-reveal-icon {
    width: 15px !important;
    height: 15px !important;
  }

  .memorall-chat-container .memorall-context-section::-webkit-scrollbar {
    width: 8px !important;
  }

  .memorall-chat-container .memorall-context-section::-webkit-scrollbar-thumb {
    border: 2px solid transparent !important;
    border-radius: 999px !important;
    background: hsl(var(--muted-foreground) / 0.24) !important;
    background-clip: content-box !important;
  }

  .memorall-chat-container .memorall-context-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 10px !important;
    margin-bottom: 10px !important;
  }

  .memorall-chat-container .memorall-context-title-wrap {
    display: flex !important;
    min-width: 0 !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .memorall-chat-container .memorall-context-toggle,
  .memorall-chat-container .memorall-context-preview-button {
    display: inline-flex !important;
    width: 30px !important;
    height: 30px !important;
    flex-shrink: 0 !important;
    align-items: center !important;
    justify-content: center !important;
    border: 0 !important;
    border-radius: 8px !important;
    background: transparent !important;
    color: hsl(var(--muted-foreground)) !important;
    cursor: pointer !important;
    transition:
      background-color 150ms ease,
      color 150ms ease !important;
  }

  .memorall-chat-container .memorall-context-toggle:hover,
  .memorall-chat-container .memorall-context-preview-button:hover {
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
  }

  .memorall-chat-container .memorall-context-toggle-icon,
  .memorall-chat-container .memorall-smart-select-icon {
    width: 15px !important;
    height: 15px !important;
  }

  .memorall-chat-container .memorall-context-title {
    overflow: hidden !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 12px !important;
    font-weight: 650 !important;
    line-height: 1.2 !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  .memorall-chat-container .memorall-context-actions {
    display: flex !important;
    flex-shrink: 0 !important;
    align-items: center !important;
    gap: 8px !important;
  }

  .memorall-chat-container .memorall-smart-select-button {
    display: inline-flex !important;
    min-height: 36px !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 7px !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    color: hsl(var(--foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1 !important;
    padding: 0 12px !important;
    transition:
      background-color 150ms ease,
      border-color 150ms ease !important;
  }

  .memorall-chat-container .memorall-smart-select-button:hover {
    border-color: hsl(var(--primary) / 0.28) !important;
    background: hsl(var(--muted)) !important;
  }

  .memorall-chat-container .memorall-context-group {
    margin-top: 10px !important;
  }

  .memorall-chat-container .memorall-context-group:first-of-type {
    margin-top: 0 !important;
  }

  .memorall-chat-container .memorall-context-grid {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }

  .memorall-chat-container .memorall-context-grid--attached {
    grid-template-columns: 1fr !important;
  }

  .memorall-chat-container .memorall-context-tile {
    display: flex !important;
    min-width: 0 !important;
    min-height: 48px !important;
    align-items: center !important;
    gap: 6px !important;
    overflow: hidden !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 8px !important;
    background: hsl(var(--background)) !important;
    padding: 8px 8px 8px 10px !important;
  }

  .memorall-chat-container .memorall-context-tile--attached {
    background: hsl(var(--muted) / 0.34) !important;
  }

  .memorall-chat-container .memorall-context-attach-button {
    display: flex !important;
    min-width: 0 !important;
    flex: 1 1 auto !important;
    align-items: center !important;
    justify-content: space-between !important;
    gap: 8px !important;
    border: 0 !important;
    background: transparent !important;
    color: hsl(var(--foreground)) !important;
    cursor: pointer !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    line-height: 1.2 !important;
    padding: 0 !important;
    text-align: left !important;
  }

  .memorall-chat-container .memorall-context-attach-button:hover .memorall-context-label {
    color: hsl(var(--primary)) !important;
  }

  .memorall-chat-container .memorall-context-label,
  .memorall-chat-container .memorall-context-attached-label-wrap {
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  .memorall-chat-container .memorall-context-attached-label-wrap {
    flex: 1 1 auto !important;
    font-size: 12px !important;
    font-weight: 700 !important;
  }

  .memorall-chat-container .memorall-context-attach-text {
    flex-shrink: 0 !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 11px !important;
    font-weight: 600 !important;
  }

  .memorall-chat-container .memorall-attached-title {
    margin-bottom: 8px !important;
    color: hsl(var(--muted-foreground)) !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    letter-spacing: 0 !important;
    text-transform: uppercase !important;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-section {
    max-height: min(250px, 34vh) !important;
    padding: 10px 12px !important;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-header {
    margin-bottom: 8px !important;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-grid {
    gap: 7px !important;
  }

  .memorall-chat-container .memorall-chat-shell--popup .memorall-context-tile {
    min-height: 44px !important;
    padding: 7px 7px 7px 9px !important;
  }

  @media (max-width: 720px) {
    .memorall-chat-container .memorall-chat-shell--panel,
    .memorall-chat-container .memorall-chat-shell--popup {
      top: 8px !important;
      right: 8px !important;
      bottom: 8px !important;
      left: 8px !important;
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      border: 1px solid hsl(var(--border)) !important;
      border-radius: 8px !important;
    }

    .memorall-chat-container .memorall-chat-header-inner {
      min-height: 50px !important;
      padding: 6px 8px !important;
    }

    .memorall-chat-container .memorall-model-chip {
      max-width: 42% !important;
    }

    .memorall-chat-container .memorall-icon-button {
      width: 44px !important;
      height: 44px !important;
    }

    .memorall-chat-container .memorall-composer-row {
      align-items: flex-end !important;
    }

    .memorall-chat-container .memorall-select {
      max-width: 132px !important;
    }

    .memorall-chat-container .memorall-context-section {
      max-height: min(230px, 32vh) !important;
      padding: 10px 12px !important;
    }

    .memorall-chat-container .memorall-context-reveal {
      padding: 7px 12px !important;
    }

    .memorall-chat-container .memorall-context-reveal-button {
      min-height: 32px !important;
      padding: 0 9px !important;
    }

    .memorall-chat-container .memorall-context-reveal-smart-button {
      min-height: 32px !important;
      padding: 0 10px !important;
    }

    .memorall-chat-container .memorall-context-header {
      gap: 8px !important;
      margin-bottom: 8px !important;
    }

    .memorall-chat-container .memorall-context-title {
      font-size: 12px !important;
    }

    .memorall-chat-container .memorall-smart-select-button {
      min-height: 36px !important;
      padding: 0 10px !important;
      font-size: 12px !important;
    }

    .memorall-chat-container .memorall-context-grid {
      gap: 7px !important;
    }

    .memorall-chat-container .memorall-context-tile {
      min-height: 44px !important;
      padding: 7px 7px 7px 9px !important;
    }

    .memorall-chat-container .memorall-context-attach-button {
      gap: 6px !important;
      font-size: 12px !important;
    }

    .memorall-chat-container .memorall-context-attach-text {
      font-size: 10px !important;
    }

    .memorall-chat-container .memorall-context-preview-button {
      width: 28px !important;
      height: 28px !important;
    }
  }

  @media (prefers-color-scheme: dark) {
    .memorall-chat-container {
      --background: 0 0% 3.9%;
      --foreground: 0 0% 98%;
      --card: 0 0% 3.9%;
      --card-foreground: 0 0% 98%;
      --popover: 0 0% 3.9%;
      --popover-foreground: 0 0% 98%;
      --primary: 0 0% 98%;
      --primary-foreground: 0 0% 9%;
      --secondary: 0 0% 14.9%;
      --secondary-foreground: 0 0% 98%;
      --muted: 0 0% 14.9%;
      --muted-foreground: 0 0% 63.9%;
      --accent: 0 0% 14.9%;
      --accent-foreground: 0 0% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 0 0% 98%;
      --border: 0 0% 14.9%;
      --input: 0 0% 14.9%;
      --ring: 0 0% 83.1%;
    }

    /* Dark mode color overrides */
    .memorall-chat-container .bg-background {
      background-color: hsl(0 0% 3.9%) !important;
    }

    .memorall-chat-container .text-foreground {
      color: hsl(0 0% 98%) !important;
    }

    .memorall-chat-container .text-muted-foreground {
      color: hsl(0 0% 63.9%) !important;
    }

    .memorall-chat-container .bg-muted {
      background-color: hsl(0 0% 14.9%) !important;
    }

    .memorall-chat-container .bg-muted\/50 {
      background-color: hsl(0 0% 14.9% / 0.5) !important;
    }

    .memorall-chat-container .bg-muted\/30 {
      background-color: hsl(0 0% 14.9% / 0.3) !important;
    }

    .memorall-chat-container .bg-primary {
      background-color: hsl(0 0% 98%) !important;
    }

    .memorall-chat-container .text-primary {
      color: hsl(0 0% 98%) !important;
    }

    .memorall-chat-container .text-primary-foreground {
      color: hsl(0 0% 9%) !important;
    }

    .memorall-chat-container .bg-primary\/10 {
      background-color: hsl(0 0% 98% / 0.1) !important;
    }

    .memorall-chat-container .bg-primary\/90 {
      background-color: hsl(0 0% 98% / 0.9) !important;
    }

    .memorall-chat-container .border {
      border-color: hsl(0 0% 14.9%) !important;
    }

    .memorall-chat-container .border-border {
      border-color: hsl(0 0% 14.9%) !important;
    }

    .memorall-chat-container .border-primary\/20 {
      border-color: hsl(0 0% 98% / 0.2) !important;
    }

    .memorall-chat-container .hover\\:bg-accent:hover {
      background-color: hsl(0 0% 14.9%) !important;
    }

    .memorall-chat-container .hover\\:text-accent-foreground:hover {
      color: hsl(0 0% 98%) !important;
    }

    .memorall-chat-container .hover\\:bg-muted:hover {
      background-color: hsl(0 0% 14.9%) !important;
    }

    .memorall-chat-container .hover\\:bg-primary\\\/90:hover {
      background-color: hsl(0 0% 98% / 0.9) !important;
    }

    .memorall-chat-container .hover\\:text-foreground:hover {
      color: hsl(0 0% 98%) !important;
    }

    /* Dark mode specific color overrides */
    .memorall-chat-container .bg-orange-950 {
      background-color: hsl(33 100% 5%) !important;
    }

    .memorall-chat-container .border-orange-800 {
      border-color: hsl(33 91% 20%) !important;
    }

    .memorall-chat-container .text-orange-400 {
      color: hsl(33 91% 56%) !important;
    }

    /* Dark mode default text color overrides */
    .memorall-chat-container {
      color: hsl(var(--foreground)) !important;
    }

    .memorall-chat-container div,
    .memorall-chat-container span,
    .memorall-chat-container p,
    .memorall-chat-container h1,
    .memorall-chat-container h2,
    .memorall-chat-container h3,
    .memorall-chat-container h4,
    .memorall-chat-container h5,
    .memorall-chat-container h6,
    .memorall-chat-container button,
    .memorall-chat-container input,
    .memorall-chat-container textarea,
    .memorall-chat-container label,
    .memorall-chat-container summary {
      color: hsl(var(--foreground)) !important;
    }

    .memorall-chat-container input::placeholder,
    .memorall-chat-container textarea::placeholder {
      color: hsl(var(--muted-foreground)) !important;
    }

    .memorall-chat-container .memorall-message-content--user {
      background: hsl(var(--primary)) !important;
      color: hsl(var(--primary-foreground)) !important;
    }

    .memorall-chat-container .memorall-submit-button *,
    .memorall-chat-container .memorall-user-text {
      color: hsl(var(--primary-foreground)) !important;
    }

    .memorall-chat-container .memorall-user-text--with-context {
      overflow-wrap: anywhere !important;
      line-height: 1.45 !important;
    }

    .memorall-chat-container .memorall-user-context {
      color: hsl(var(--foreground)) !important;
    }

    .memorall-chat-container .memorall-user-text-card {
      border-color: hsl(var(--border)) !important;
      background: hsl(var(--background)) !important;
      color: hsl(var(--foreground)) !important;
    }

    .memorall-chat-container .memorall-user-context-card {
      border-color: hsl(var(--border)) !important;
      background: hsl(var(--card)) !important;
      color: hsl(var(--card-foreground)) !important;
    }

    .memorall-chat-container .memorall-user-context-card-header {
      background: hsl(var(--card)) !important;
      color: hsl(var(--card-foreground)) !important;
    }

    .memorall-chat-container .memorall-user-context-card-title,
    .memorall-chat-container .memorall-user-context-pre {
      color: hsl(var(--foreground)) !important;
    }

    .memorall-chat-container .memorall-user-context-card-subtitle,
    .memorall-chat-container .memorall-user-context-card-icon {
      color: hsl(var(--muted-foreground)) !important;
    }

    .memorall-chat-container .memorall-user-context-expanded {
      background: hsl(var(--muted) / 0.3) !important;
      color: hsl(var(--foreground)) !important;
    }
  }
`;
