import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/globals.css';
import App from './src/App';

// Standalone page wrapper component
const StandaloneApp: React.FC = () => {
  return (
    <div style={{ 
      width: '100%', 
      height: '100vh', 
      overflow: 'hidden',
      background: 'white'
    }}>
      <App />
    </div>
  );
};

// Initialize standalone page
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<StandaloneApp />);
} else {
  console.error('Root element not found in standalone page');
}