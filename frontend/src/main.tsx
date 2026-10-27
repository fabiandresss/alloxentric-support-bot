import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {PublicChat} from './components/PublicChat.tsx';
import './index.css';

// Redirección para demostración MVP de la landing page con el widget integrado
if (window.location.pathname === '/demo' || window.location.pathname === '/wellq') {
  window.location.replace('/wellq-landing.html');
}

// /chat/{slug} es la página pública de chat (RF-29); cualquier otra ruta es el panel.
const chat = window.location.pathname.match(/^\/chat\/([^/]+)\/?$/);
const embed = new URLSearchParams(window.location.search).get('embed') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {chat ? <PublicChat slug={decodeURIComponent(chat[1])} embed={embed} /> : <App />}
  </StrictMode>,
);
