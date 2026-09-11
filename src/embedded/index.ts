// Main exports for embedded components
export * from "./types";
export * from "./content-extraction";
export * from "./messaging";

// Component creators
export { createEmbeddedTopicSelector } from "./pages/TopicSelector";
export { createEmbeddedChatModal } from "./pages/EmbeddedChat";
export { createCanvasSelectOverlay } from "./components/CanvasSelectOverlay";

// Re-export default components
export { default as TopicSelector } from "./pages/TopicSelector";
export { default as EmbeddedChat } from "./pages/EmbeddedChat";
