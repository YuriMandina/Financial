from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from database import Base

class SyncSnapshot(Base):
    __tablename__ = "sync_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String, index=True, unique=True, nullable=False)
    tipo_relatorio = Column(String, index=True, nullable=False)
    data_referencia = Column(String, index=True, nullable=False)
    dados = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
