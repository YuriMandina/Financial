# --- [BLOCO: Cache de Banco de Dados] ---
import pandas as pd
from core.database import SessionLocal
from models.models import SyncSnapshot
from core.deps import current_org

def obter_global_db(cache_key, tipo_relatorio, fetch_fn, *args, data_ref="Global", force_sync=False, return_metadata=False, task_id=None, **kwargs):
    db = SessionLocal()
    try:
        snap = db.query(SyncSnapshot).filter(SyncSnapshot.cache_key == cache_key, SyncSnapshot.organization_id == current_org.get().id).first()
        
        if snap and not force_sync:
            return (snap.dados, snap.created_at) if return_metadata else snap.dados
            
        if snap and force_sync:
            db.delete(snap)
            db.commit()
            
        if task_id:
            kwargs['task_id'] = task_id
            
        dados = fetch_fn(*args, **kwargs)
        if dados is not None:
            novo_snap = SyncSnapshot(
                cache_key=cache_key,
                tipo_relatorio=tipo_relatorio,
                data_referencia=data_ref,
                dados=dados,
                organization_id=current_org.get().id
            )
            db.add(novo_snap)
            db.commit()
            db.refresh(novo_snap)
            return (dados, novo_snap.created_at) if return_metadata else dados
        return (None, None) if return_metadata else None
    finally:
        db.close()

def obter_fatiado_db(data_inicio, data_fim, tipo_relatorio, cache_key_prefix, fetch_fn, extract_date_fn, task_id=None, force_sync=False):
    db = SessionLocal()
    try:
        dt_inicio = pd.to_datetime(data_inicio)
        dt_fim = pd.to_datetime(data_fim)
        todas_datas = pd.date_range(dt_inicio, dt_fim)
        datas_str = [d.strftime("%Y-%m-%d") for d in todas_datas]
        
        chaves_buscadas = [f"{cache_key_prefix}_{d}" for d in datas_str]
        
        salvos = db.query(SyncSnapshot).filter(
            SyncSnapshot.tipo_relatorio == tipo_relatorio,
            SyncSnapshot.cache_key.in_(chaves_buscadas)
        ).all()
        
        if force_sync and salvos:
            for snap in salvos:
                db.delete(snap)
            db.commit()
            salvos = []
        
        datas_salvas = {snap.data_referencia: snap.dados for snap in salvos}
        datas_faltantes = [d for d in todas_datas if d.strftime("%Y-%m-%d") not in datas_salvas]
        
        todos_dados = []
        for d in datas_salvas.values():
            todos_dados.extend(d)
            
        if datas_faltantes:
            min_f = min(datas_faltantes)
            max_f = max(datas_faltantes)
            
            if task_id:
                novos_dados = fetch_fn(min_f.strftime("%Y-%m-%d"), max_f.strftime("%Y-%m-%d"), task_id=task_id)
            else:
                novos_dados = fetch_fn(min_f.strftime("%Y-%m-%d"), max_f.strftime("%Y-%m-%d"))
            
            dados_por_dia = {d.strftime("%Y-%m-%d"): [] for d in datas_faltantes}
            
            for item in novos_dados:
                item_date = extract_date_fn(item)
                if item_date in dados_por_dia:
                    dados_por_dia[item_date].append(item)
                    
            for dia_str, itens in dados_por_dia.items():
                cache_key = f"{cache_key_prefix}_{dia_str}"
                snap = SyncSnapshot(
                    cache_key=cache_key,
                    tipo_relatorio=tipo_relatorio,
                    data_referencia=dia_str,
                    dados=itens,
                    organization_id=current_org.get().id
                )
                db.add(snap)
                todos_dados.extend(itens)
                
            db.commit()
            
        return todos_dados
    finally:
        db.close()
