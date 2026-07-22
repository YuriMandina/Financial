from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
import models.models as models
from core.database import SessionLocal
from models.models import SyncSnapshot
from core.deps import current_org, get_current_user_and_set_org

router = APIRouter()

@router.get("/api/snapshots")
def listar_snapshots(current_user: models.User = Depends(get_current_user_and_set_org)):
    db = SessionLocal()
    try:
        snaps = db.query(SyncSnapshot.id, SyncSnapshot.cache_key, SyncSnapshot.tipo_relatorio, SyncSnapshot.data_referencia, SyncSnapshot.created_at).all()
        lista = []
        for s in snaps:
            lista.append({
                "id": s.id,
                "cache_key": s.cache_key,
                "tipo_relatorio": s.tipo_relatorio,
                "data_referencia": s.data_referencia,
                "created_at": s.created_at.strftime("%d/%m/%Y %H:%M:%S")
            })
        return lista
    finally:
        db.close()

@router.delete("/api/snapshots/{snap_id}")
def deletar_snapshot(snap_id: int, current_user: models.User = Depends(get_current_user_and_set_org)):
    current_org.set(current_user.organization)
    db = SessionLocal()
    try:
        snap = db.query(SyncSnapshot).filter(SyncSnapshot.id == snap_id).first()
        if snap:
            db.delete(snap)
            db.commit()
            return {"status": "ok", "mensagem": "Snapshot removido com sucesso"}
        return JSONResponse(status_code=404, content={"detail": "Snapshot não encontrado"})
    finally:
        db.close()
