// A small React 19 page in development mode, bundled by qa/p9/devtools-live.mjs (esbuild). React DevTools shows App > Counter in Components.
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';

function Counter({label}) {
  const [count, setCount] = useState(0);
  return <button id="counter" onClick={() => setCount(count + 1)}>{label}: {count}</button>;
}

function App() {
  return <main><h1>P9 React page</h1><Counter label="Clicks" /></main>;
}

createRoot(document.getElementById('root')).render(<App />);
