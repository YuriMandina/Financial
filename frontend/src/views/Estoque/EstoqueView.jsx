import React, { useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { createEstoqueApi } from './estoqueApi';
import { Alert, Tabs } from './components/ui';
import InventariosTab from './components/InventariosTab';
import InventarioDetalhe from './components/InventarioDetalhe';
import CadastroTab from './components/CadastroTab';
import PendenciasTab from './components/PendenciasTab';
import IndicadoresTab from './components/IndicadoresTab';
import { AppContagemButton } from './components/AppContagemModal';

export default function EstoqueView({ token, onTaskStart, refreshCounter }) {
  // --- [BLOCO: Estado e API] ---
  const api = useMemo(() => createEstoqueApi(token), [token]);
  const [tab, setTab] = useState('inventarios');
  const [openCountId, setOpenCountId] = useState(null);
  const [motivos, setMotivos] = useState(null);
  const [semFamilia, setSemFamilia] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.motivos().then(setMotivos).catch((e) => setError(e.message));
    api.pendencias().then((d) => setSemFamilia(d.sem_familia)).catch(() => {});
  }, [api]);

  return (
    <div className="flex-1 p-8 z-10 overflow-y-auto">
      {/* --- [BLOCO: Cabeçalho] --- */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center border border-slate-700">
          <Boxes size={24} className="text-slate-300" />
        </div>
        <div>
          <h2 className="text-3xl font-bold text-white mb-1">Inventário</h2>
          <p className="text-slate-400">Balanço de estoque por família com ajustes na Omie</p>
        </div>
        <div className="ml-auto">
          <AppContagemButton api={api} />
        </div>
      </div>

      {error && <div className="mb-4"><Alert onClose={() => setError(null)}>{error}</Alert></div>}

      {/* --- [BLOCO: Conteúdo] --- */}
      {openCountId && motivos ? (
        <InventarioDetalhe api={api} countId={openCountId} motivos={motivos} onTaskStart={onTaskStart}
          onBack={() => setOpenCountId(null)} />
      ) : (
        <div className="space-y-6">
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'inventarios', label: 'Inventários' },
            { key: 'cadastro', label: 'Cadastro' },
            { key: 'pendencias', label: 'Pendências de cadastro', badge: semFamilia },
            { key: 'indicadores', label: 'Indicadores' },
          ]} />
          {tab === 'inventarios' && (
            <InventariosTab api={api} refreshCounter={refreshCounter} onOpen={setOpenCountId} onOpenCadastro={() => setTab('cadastro')} />
          )}
          {tab === 'cadastro' && <CadastroTab api={api} />}
          {tab === 'pendencias' && <PendenciasTab api={api} onTaskStart={onTaskStart} onCountChange={setSemFamilia} />}
          {tab === 'indicadores' && <IndicadoresTab api={api} />}
        </div>
      )}
    </div>
  );
}
