/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly EXTENSION_PUBLIC_LLM_RUNNER_URL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
