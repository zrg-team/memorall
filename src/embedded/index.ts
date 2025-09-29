// Main exports for embedded components
export * from "./types";
export * from "./content-extraction";
export * from "./messaging";

// Component creators
export { createEmbeddedTopicSelector } from "./components/TopicSelector";
export { createShadcnEmbeddedChatModal } from "./components/ShadcnEmbeddedChat";

// Re-export default components
export { default as TopicSelector } from "./components/TopicSelector";
export { default as ShadcnEmbeddedChat } from "./components/ShadcnEmbeddedChat";
