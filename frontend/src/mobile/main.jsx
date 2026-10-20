import React from 'react';
import ReactDOM from 'react-dom/client';
import MobileApp from './MobileApp';
import '../index.css';

// --- [BLOCO: Tratamento de Erros Inesperados] ---
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-rose-300">
          <h1 className="text-lg font-semibold mb-2">Erro inesperado</h1>
          <pre className="text-xs whitespace-pre-wrap">{String(this.state.error)}</pre>
          <p className="text-sm text-slate-400 mt-4">Os lançamentos pendentes continuam salvos no aparelho.</p>
          <button className="mt-4 px-4 h-11 rounded-xl bg-slate-800" onClick={() => window.location.reload()}>Reabrir</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MobileApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
