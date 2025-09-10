# Page Components

This directory contains page-level components and their associated hooks, organized by feature.

## Structure

```
pages/
├── chat/
│   ├── components/
│   │   ├── LoadingScreen.tsx    - Loading state component
│   │   ├── NoModelsScreen.tsx   - No models available state
│   │   ├── MessageRenderer.tsx  - Individual message rendering
│   │   └── ChatInput.tsx        - Chat input area
│   ├── hooks/
│   │   ├── useCurrentModel.ts   - Model state management
│   │   ├── useChat.ts          - Chat functionality
│   │   └── index.ts            - Hooks barrel export
│   └── index.ts                - Main barrel export
└── README.md                   - This file
```

## Usage

Import components and hooks from the page directory:

```tsx
import {
  LoadingScreen,
  NoModelsScreen,
  MessageRenderer,
  ChatInput,
  useCurrentModel,
  useChat
} from "@/components/pages/chat";
```

## Benefits

- **Separation of Concerns**: Components and hooks are separated by function
- **Reusability**: Components can be used in other contexts
- **Testability**: Smaller components are easier to test
- **Maintainability**: Easier to find and modify specific functionality
- **Code Organization**: Clear structure for page-level features