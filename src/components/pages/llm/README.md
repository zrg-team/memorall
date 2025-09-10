# LLM Page Components

This directory contains the LLM page components and hooks, organized by functionality.

## Structure

```
llm/
├── components/
│   ├── MyModelsSection.tsx     - Local models management section
│   ├── AdvancedSection.tsx     - Main advanced download section
│   ├── ProgressSection.tsx     - Download progress display
│   ├── ProviderTabs.tsx        - Wllama/WebLLM provider tabs
│   ├── WllamaTab.tsx          - Wllama GGUF model configuration
│   ├── WebLLMTab.tsx          - WebLLM MLC model configuration
│   ├── ChatSection.tsx        - Test chat functionality
│   └── LogsSection.tsx        - Activity logs display
├── hooks/
│   ├── use-llm-state.ts       - All state management
│   ├── use-llm-actions.ts     - All action handlers
│   ├── use-progress-listener.ts - Progress event listeners
│   ├── use-repo-effect.ts     - Repository change effects
│   └── index.ts               - Hooks barrel export
├── index.ts                   - Main barrel export
└── README.md                  - This file
```

## Usage

Import components and hooks from the page directory:

```tsx
import {
  MyModelsSection,
  AdvancedSection,
  useLLMState,
  useLLMActions,
  useProgressListener,
  useRepoEffect
} from "@/components/pages/llm";
```

## Components

### MyModelsSection
Displays the user's local models using the YourModels component.

### AdvancedSection
Main section containing:
- Progress display
- Provider selection tabs
- Model configuration forms
- Load/unload controls
- Test chat interface
- Activity logs

### Individual Components
- **ProgressSection**: Shows download/loading progress with ETA
- **ProviderTabs**: Switch between Wllama (GGUF) and WebLLM (MLC)
- **WllamaTab**: Configure Hugging Face repository and GGUF files
- **WebLLMTab**: Select from available WebLLM models
- **ChatSection**: Test chat interface for loaded models
- **LogsSection**: Display activity and debug logs

## Hooks

### useLLMState
Manages all component state including:
- Model selection and configuration
- UI state (loading, status, logs)
- Download progress
- Chat functionality

### useLLMActions
Handles all actions:
- Model loading/unloading
- Repository file fetching
- WebLLM model fetching
- Chat generation
- Provider switching

### useProgressListener
Sets up event listeners for download progress updates.

### useRepoEffect
Handles repository changes and automatic file fetching.

## Benefits

- **Separation of Concerns**: State, actions, and UI are clearly separated
- **Reusability**: Components can be reused or rearranged
- **Maintainability**: Easy to find and modify specific functionality
- **Testability**: Smaller, focused components are easier to test
- **Performance**: Hooks optimize re-renders and event handling