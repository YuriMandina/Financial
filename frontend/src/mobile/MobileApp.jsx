/* global __APP_VERSION_CODE__ */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, apkUrl, clearSession, getDeviceId, getToken, getUser } from './api';
import { SyncBadge, Toasts } from './components';
import { findByCode, itemCountStatus, itemEditable, newUuid, syncOutbox } from './counting';
import { isOnline, onBackButton, onNetworkChange, scanBarcode, scannerAvailable, vibrate } from './native';
import { cacheCount, cacheCountList, getCachedCount, getCachedCountList, outboxStore } from './offline';
import LoginScreen from './screens/LoginScreen';
import CountsScreen from './screens/CountsScreen';
import ItemsScreen from './screens/ItemsScreen';
import ItemScreen from './screens/ItemScreen';

const SYNC_INTERVAL_MS = 20000;
const TOAST_MS = 3000;
const COUNTING_STATUSES = ['EM_CONTAGEM', 'CONFERENCIA'];

export default function MobileApp() {
  // --- [BLOCO: Estado da Sessão e Navegação] ---
  const [user, setUser] = useState(() => (getToken() ? getUser() : null));
  const [loginNotice, setLoginNotice] = useState(null);
  const [screen, setScreen] = useState({ name: 'counts' });
  const [counts, setCounts] = useState([]);
  const [countsFromCache, setCountsFromCache] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [count, setCount] = useState(null);
  const [countFromCache, setCountFromCache] = useState(false);
  const [refreshingCount, setRefreshingCount] = useState(false);
  const [itemsFilter, setItemsFilter] = useState('TODOS');
  const [pending, setPending] = useState([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [toasts, setToasts] = useState([]);
  const syncingRef = useRef(false);
  const screenRef = useRef(screen);

  useEffect(() => { screenRef.current = screen; }, [screen]);

  // --- [BLOCO: Avisos Flutuantes] ---
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((tone, text, { action = null, persist = tone === 'error' } = {}) => {
    const id = newUuid();
    setToasts((prev) => [...prev.slice(-2), { id, tone, text, action }]);
    if (!persist) setTimeout(() => dismissToast(id), TOAST_MS);
    if (tone === 'error') vibrate('error');
  }, [dismissToast]);

  const handleAuthError = useCallback((err) => {
    if (err?.status === 401) {
      clearSession();
      setUser(null);
      setLoginNotice('Sessão expirada. Entre novamente: os lançamentos pendentes continuam salvos no aparelho.');
      return true;
    }
    return false;
  }, []);

  const reloadPending = useCallback(async () => setPending(await outboxStore.listPending()), []);

  // --- [BLOCO: Carregamento de Inventários (online com fallback offline)] ---
  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const data = await api.listCounts();
      const list = (data.inventarios || []).filter((c) => COUNTING_STATUSES.includes(c.status));
      setCounts(list);
      setCountsFromCache(false);
      setOnline(true);
      setLastUpdate(new Date());
      await cacheCountList(list);
    } catch (err) {
      if (handleAuthError(err)) return;
      setCounts((await getCachedCountList()) || []);
      setCountsFromCache(true);
      if (err.offline) setOnline(false);
    } finally {
      setLoadingCounts(false);
    }
  }, [handleAuthError]);

  const loadCount = useCallback(async (countId) => {
    try {
      const data = await api.getCountForCounting(countId);
      await cacheCount(data);
      setCount(data);
      setCountFromCache(false);
      setOnline(true);
      return data;
    } catch (err) {
      if (handleAuthError(err)) return null;
      const cached = await getCachedCount(countId);
      if (!cached) throw err;
      setCount(cached);
      setCountFromCache(true);
      if (err.offline) setOnline(false);
      return cached;
    }
  }, [handleAuthError]);

  // --- [BLOCO: Sincronização] ---
  const syncNow = useCallback(async () => {
    if (syncingRef.current || !getToken()) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const summary = await syncOutbox(outboxStore, api);
      setOnline(true);
      if (summary.rejected) pushToast('error', `${summary.rejected} lançamento(s) rejeitado(s) pelo servidor. Veja no item.`);
      if (count && (summary.sent || countFromCache)) await loadCount(count.id);
    } catch (err) {
      if (!handleAuthError(err) && err.offline) setOnline(false);
    } finally {
      await reloadPending();
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [count, countFromCache, handleAuthError, loadCount, pushToast, reloadPending]);

  useEffect(() => {
    if (!user) return undefined;
    loadCounts();
    reloadPending();
    scannerAvailable().then(setScanEnabled);
    isOnline().then(setOnline);
    api.appVersion().then((info) => {
      if (info?.version_code > __APP_VERSION_CODE__) {
        pushToast('info', `Nova versão ${info.version_name} disponível.`, { action: { label: 'Baixar', href: apkUrl() }, persist: true });
      }
    }).catch(() => {});
    const stop = onNetworkChange((connected) => { setOnline(connected); if (connected) syncNow(); });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => { if (pending.some((e) => e.status !== 'rejected')) syncNow(); }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [user, pending, syncNow]);

  // --- [BLOCO: Navegação e Botão Voltar do Android] ---
  const goToCounts = useCallback(() => { setScreen({ name: 'counts' }); loadCounts(); }, [loadCounts]);
  const goToItems = useCallback(() => setScreen({ name: 'items' }), []);

  useEffect(() => onBackButton(() => {
    const current = screenRef.current.name;
    if (current === 'item') { goToItems(); return true; }
    if (current === 'items') { goToCounts(); return true; }
    return false; // lista de inventários: minimiza o app
  }), [goToCounts, goToItems]);

  // --- [BLOCO: Ações de Contagem] ---
  const openCount = async (countId) => {
    try {
      const data = await loadCount(countId);
      setItemsFilter(data?.status === 'CONFERENCIA' ? 'RECONTAGEM' : 'TODOS');
      setScreen({ name: 'items' });
    } catch {
      pushToast('error', 'Inventário indisponível offline: abra-o uma vez com conexão.');
    }
  };

  const refreshCount = async () => {
    setRefreshingCount(true);
    try {
      await syncNow();
      await loadCount(count.id);
    } catch {
      pushToast('error', 'Não foi possível atualizar agora.');
    } finally {
      setRefreshingCount(false);
    }
  };

  const openItem = (itemId, packaging) => setScreen({ name: 'item', itemId, packaging });

  const addEntry = async (payload) => {
    const { quantity, ...entry } = payload;
    await outboxStore.add({
      ...entry,
      quantity,
      client_uuid: newUuid(),
      count_id: count.id,
      device_id: getDeviceId(),
      counted_at: new Date().toISOString(),
    });
    vibrate('ok');
    await reloadPending();
    syncNow();
  };

  const voidEntry = async (entry) => {
    await api.voidEntry(entry.id);
    await loadCount(count.id);
    pushToast('ok', 'Lançamento estornado.');
  };

  const removePending = async (uuid) => {
    await outboxStore.remove(uuid);
    await reloadPending();
  };

  const confirmZero = async (itemId, confirmed) => {
    await api.confirmZero(itemId, confirmed);
    await loadCount(count.id);
  };

  const scan = async () => {
    try {
      const code = await scanBarcode((msg) => (msg ? pushToast('info', msg, { persist: true }) : setToasts([])));
      if (!code) return;
      const hit = findByCode(count.items, code);
      if (hit) {
        vibrate('ok');
        openItem(hit.item.id, hit.packaging);
      } else {
        pushToast('error', `Código ${code} não pertence a este inventário.`);
      }
    } catch (err) {
      pushToast('error', `Leitor indisponível: ${err.message}`);
    }
  };

  // Próximo item ainda não contado (na ordem da lista), a partir do item atual
  const nextPending = () => {
    const items = count.items;
    const start = items.findIndex((i) => i.id === screen.itemId);
    for (let step = 1; step <= items.length; step += 1) {
      const candidate = items[(start + step) % items.length];
      if (itemEditable(count, candidate) && itemCountStatus(candidate, pending) !== 'CONTADO') {
        openItem(candidate.id, null);
        return;
      }
    }
    pushToast('ok', 'Todos os itens deste inventário já foram contados.');
  };

  const logout = () => {
    clearSession();
    setUser(null);
    setScreen({ name: 'counts' });
  };

  // --- [BLOCO: Renderização] ---
  const toastLayer = <Toasts toasts={toasts} onDismiss={dismissToast} />;

  if (!user) {
    return <LoginScreen notice={loginNotice} onLoggedIn={(u) => { setLoginNotice(null); setUser(u); }} />;
  }

  const countPending = count ? pending.filter((e) => e.count_id === count.id) : pending;
  const badge = (
    <SyncBadge online={online} syncing={syncing} onSync={syncNow}
      pending={countPending.filter((e) => e.status !== 'rejected').length}
      rejected={countPending.filter((e) => e.status === 'rejected').length} />
  );

  if (screen.name === 'item' && count) {
    const item = count.items.find((i) => i.id === screen.itemId);
    if (item) {
      return (
        <>
          <ItemScreen key={item.id} count={count} item={item} pending={countPending} initialPackaging={screen.packaging}
            online={online} syncBadge={badge} scanEnabled={scanEnabled} onBack={goToItems}
            onAdd={addEntry} onVoid={voidEntry} onRemovePending={removePending}
            onConfirmZero={(confirmed) => confirmZero(item.id, confirmed)}
            onScanNext={scan} onNextPending={nextPending} onToast={pushToast} />
          {toastLayer}
        </>
      );
    }
  }

  if (screen.name === 'items' && count) {
    return (
      <>
        <ItemsScreen count={count} pending={countPending} fromCache={countFromCache} refreshing={refreshingCount}
          syncBadge={badge} scanEnabled={scanEnabled} filter={itemsFilter} onFilterChange={setItemsFilter}
          onBack={goToCounts} onOpenItem={openItem} onScan={scan} onRefresh={refreshCount} />
        {toastLayer}
      </>
    );
  }

  return (
    <>
      <CountsScreen user={user} counts={counts} loading={loadingCounts} fromCache={countsFromCache} lastUpdate={lastUpdate}
        syncBadge={badge} onOpen={openCount} onRefresh={loadCounts} onLogout={logout} />
      {toastLayer}
    </>
  );
}
