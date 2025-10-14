import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/globals.css';
import App from './src/App';

// Popup-specific wrapper component
const PopupApp: React.FC = () => {
  React.useEffect(() => {
    try {
      chrome.runtime?.sendMessage?.({ type: 'POPUP_READY' });
    } catch (e) {
      // ignore
    }
  }, []);

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

// Initialize popup with initial route detection before first render
const container = document.getElementById('root');
if (container) {
  const render = () => {
    const root = createRoot(container);
    root.render(<PopupApp />);
  };

  try {
    const area = (chrome.storage)?.session ?? (chrome.storage)?.local;
    if (area?.get) {
      area.get(['navigateTo'], (data: { navigateTo?: string }) => {
        try {
          const target = data?.navigateTo as string | undefined;
          if (target === 'knowledge-graph') {
            if (location.pathname !== '/knowledge-graph') {
              history.replaceState({}, '', '/knowledge-graph');
            }
            area?.remove?.('navigateTo');
          } else if (target === 'remember') {
            if (location.pathname !== '/remember') {
              history.replaceState({}, '', '/remember');
            }
            area?.remove?.('navigateTo');
          } else if (target === 'llm') {
            if (location.pathname !== '/llm') {
              history.replaceState({}, '', '/llm');
            }
            area?.remove?.('navigateTo');
          } else if (target === 'topics') {
            if (location.pathname !== '/topics') {
              history.replaceState({}, '', '/topics');
            }
            area?.remove?.('navigateTo');
          } else if (target === 'documents') {
            if (location.pathname !== '/documents') {
              history.replaceState({}, '', '/documents');
            }
            area?.remove?.('navigateTo');
          }
        } catch {}
        render();
      });
    } else {
      render();
    }
  } catch {
    render();
  }
} else {
  console.error('Root element not found in popup');
}
