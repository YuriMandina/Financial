from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Float
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from database import Base

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    omie_app_key = Column(String, nullable=True)
    omie_app_secret = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="organization")
    invitations = relationship("Invitation", back_populates="organization")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization", back_populates="users")

class Invitation(Base):
    __tablename__ = "invitations"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    token = Column(String, unique=True, index=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    status = Column(String, default="PENDING")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization", back_populates="invitations")

class SyncSnapshot(Base):
    __tablename__ = "sync_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String, index=True, nullable=False)
    tipo_relatorio = Column(String, index=True, nullable=False)
    data_referencia = Column(String, index=True, nullable=False)
    dados = Column(JSONB, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('organization_id', 'cache_key', name='uq_org_cache_key'),
    )

class PaymentReceipt(Base):
    __tablename__ = "payment_receipts"

    id = Column(Integer, primary_key=True, index=True)
    cliente = Column(String, nullable=False)
    banco = Column(String, nullable=True)
    data_pagamento = Column(String, nullable=False)
    total_original = Column(Float, nullable=False)
    total_desconto = Column(Float, nullable=False)
    total_juros = Column(Float, nullable=False)
    total_pago = Column(Float, nullable=False)
    notas = Column(JSONB, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

