/** Development fixture preview; this is not a product entry point. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExplorerApp } from './ExplorerApp';
import { createFixtureApi } from './fixture-api';
const api = createFixtureApi();
createRoot(document.getElementById('root')!).render(<React.StrictMode><ExplorerApp api={api} /></React.StrictMode>);
