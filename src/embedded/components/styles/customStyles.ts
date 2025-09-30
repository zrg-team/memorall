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
  }
`;
