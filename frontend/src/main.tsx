import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {PublicChat} from './components/PublicChat.tsx';
import {Landing} from './components/Landing.tsx';
import {Signup} from './components/Onboarding.tsx';
import './index.css';
import { applyTheme, initialTheme } from './theme';

const landing = /^\/landing\/?$/.test(window.location.pathname);
const registro = /^\/registro\/?$/.test(window.location.pathname);
applyTheme(landing ? 'light' : initialTheme());   // la landing es siempre clara (su diseño no depende del modo oscuro)

// /landing es la página de presentación; /chat/{slug} es la página pública de chat (RF-29); cualquier otra ruta es el panel.
const chat = window.location.pathname.match(/^\/chat\/([^/]+)\/?$/);
const embed = new URLSearchParams(window.location.search).get('embed') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {landing ? <Landing /> : registro ? <Signup /> : chat ? <PublicChat slug={decodeURIComponent(chat[1])} embed={embed} /> : <App />}
  </StrictMode>,
);
