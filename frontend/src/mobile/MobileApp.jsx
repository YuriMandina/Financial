/* global __APP_VERSION_CODE__ */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { api, apkUrl, clearSession, getDeviceId, getToken, getUser } from './api';
import { Banner, SyncBadge } from './components';
import { findByCode, newUuid, syncOutbox } from './counting';
import { isOnline, onNetworkChange, scanBarcode, scannerAvailable } from './native';
import { cacheCount, cacheCountList, getCachedCount, getCachedCountList, outboxStore } from './offline';
import LoginScreen from './screens/LoginScreen';
import CountsScreen from './screens/CountsScreen';
import ItemsScreen from './screens/ItemsScreen';
import ItemScreen from './screens/ItemScreen';

const SYNC_INTERVAL_MS = 20000;
const COUNTING_STATUSES = ['EM_CONTAGEM', 'CONFERENCIA'];

export default function MobileApp() {
  // --- [BLOCO: Estado da Sessão e Navegação] ---
  const [user, setUser] = useState(() => (getToken() ? getUser() : null));
  const [loginNotice, setLoginNotice] = useState(null);
  const [screen, setScreen] = useState({ name: 'counts' });
  const [counts, setCounts] = useState([]);
  const [countsFromCache, setCountsFromCache] = useState(false);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [count, setCount] = useState(null);
  const [countFromCache, setCountFromCache] = useState(false);
  const [pending, setPending] = useState([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scanEnabled, setScanEnabled] = useState(false);
  const [notice, setNotice] = useState(null);
  const [update, setUpdate] = useState(null);
  const syncingRef = useRef(false);

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
      if (summary.rejected) setNotice({ tone: 'error', text: `${summary.rejected} lançamento(s) rejeitado(s) pelo servidor. Veja no item.` });
      if (count && (summary.sent || countFromCache)) await loadCount(count.id);
    } catch (err) {
      if (!handleAuthError(err) && err.offline) setOnline(false);
    } finally {
      await reloadPending();
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [count, countFromCache, handleAuthError, loadCount, reloadPending]);

  useEffect(() => {
    if (!user) return undefined;
    loadCounts();
    reloadPending();
    scannerAvailable().then(setScanEnabled);
    isOnline().then(setOnline);
    api.appVersion().then((info) => {
      if (info?.version_code > __APP_VERSION_CODE__) setUpdate(info);
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

  // --- [BLOCO: Ações de Contagem] ---
  const openCount = async (countId) => {
    try {
      await loadCount(countId);
      setScreen({ name: 'items' });
    } catch {
      setNotice({ tone: 'error', text: 'Inventário indisponível offline: abra-o uma vez com conexão.' });
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
    await reloadPending();
    syncNow();
  };

  const voidEntry = async (entry) => {
    await api.voidEntry(entry.id);
    await loadCount(count.id);
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
      const code = await scanBarcode((msg) => setNotice(msg ? { tone: 'info', text: msg } : null));
      if (!code) return;
      const hit = findByCode(count.items, code);
      if (hit) openItem(hit.item.id, hit.packaging);
      else setNotice({ tone: 'error', text: `Código ${code} não pertence a este inventário.` });
    } catch (err) {
      setNotice({ tone: 'error', text: `Leitor indisponível: ${err.message}` });
    }
  };

  const logout = () => {
    clearSession();
    setUser(null);
    setScreen({ name: 'counts' });
  };

  // --- [BLOCO: Renderização] ---
  if (!user) {
    return <LoginScreen notice={loginNotice} onLoggedIn={(u) => { setLoginNotice(null); setUser(u); }} />;
  }

  const countPending = count ? pending.filter((e) => e.count_id === count.id) : pending;
  const badge = (
    <SyncBadge online={online} syncing={syncing} onSync={syncNow}
      pending={countPending.filter((e) => e.status !== 'rejected').length}
      rejected={countPending.filter((e) => e.status === 'rejected').length} />
  );

  const banners = (
    <>
      {update && (
        <Banner tone="info" onClose={() => setUpdate(null)}>
          Nova versão {update.version_name} disponível.{' '}
          <a href={apkUrl()} target="_blank" rel="noreferrer" className="underline font-semibold inline-flex items-center gap-1">
            <Download size={14} /> Baixar
          </a>
        </Banner>
      )}
      {notice && <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner>}
    </>
  );

  if (screen.name === 'item' && count) {
    const item = count.items.find((i) => i.id === screen.itemId);
    if (item) {
      return (
        <>
          {banners}
          <ItemScreen key={item.id} count={count} item={item} pending={countPending} initialPackaging={screen.packaging}
            online={online} syncBadge={badge} onBack={() => setScreen({ name: 'items' })}
            onAdd={addEntry} onVoid={voidEntry} onRemovePending={removePending}
            onConfirmZero={(confirmed) => confirmZero(item.id, confirmed)} />
        </>
      );
    }
  }

  if (screen.name === 'items' && count) {
    return (
      <>
        {banners}
        <ItemsScreen count={count} pending={countPending} fromCache={countFromCache} syncBadge={badge}
          scanEnabled={scanEnabled} onBack={() => { setScreen({ name: 'counts' }); loadCounts(); }}
          onOpenItem={openItem} onScan={scan} />
      </>
    );
  }

  return (
    <>
      {banners}
      <CountsScreen user={user} counts={counts} loading={loadingCounts} fromCache={countsFromCache}
        syncBadge={badge} onOpen={openCount} onRefresh={loadCounts} onLogout={logout} />
    </>
  );
}
