from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Float, Boolean, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from core.database import Base

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    omie_app_key = Column(String, nullable=True)
    omie_app_secret = Column(String, nullable=True)
    session_timeout_minutes = Column(Integer, default=120)
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
    is_active = Column(Boolean, default=True)
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

class BoningFamily(Base):
    __tablename__ = "boning_families"
    id = Column(Integer, primary_key=True, index=True)
    omie_id = Column(BigInteger, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    is_active_for_boning = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
class BoningProduct(Base):
    __tablename__ = "boning_products"
    id = Column(Integer, primary_key=True, index=True)
    omie_id = Column(BigInteger, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    family_id = Column(Integer, ForeignKey("boning_families.id"), nullable=True)
    unit_price = Column(Float, nullable=False)
    is_standard_cut = Column(Boolean, default=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    family = relationship("BoningFamily")

class BoningTemplate(Base):
    __tablename__ = "boning_templates"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    family_id = Column(Integer, ForeignKey("boning_families.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    items = relationship("BoningTemplateItem", back_populates="template", cascade="all, delete-orphan")
    samples = relationship("BoningTemplateSample", back_populates="template", cascade="all, delete-orphan")
    family = relationship("BoningFamily")

class BoningTemplateItem(Base):
    __tablename__ = "boning_template_items"
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("boning_templates.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("boning_products.id"), nullable=False)
    expected_yield_percentage = Column(Float, nullable=False)
    
    template = relationship("BoningTemplate", back_populates="items")
    product = relationship("BoningProduct")

class BoningProcess(Base):
    __tablename__ = "boning_processes"
    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    carcass_weight = Column(Float, nullable=False)
    carcass_cost_per_kg = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    mode = Column(String, nullable=False) # "MANUAL" or "TEMPLATE"
    template_id = Column(Integer, ForeignKey("boning_templates.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    items = relationship("BoningProcessItem", back_populates="process", cascade="all, delete-orphan")
    template = relationship("BoningTemplate")

class BoningProcessItem(Base):
    __tablename__ = "boning_process_items"
    id = Column(Integer, primary_key=True, index=True)
    process_id = Column(Integer, ForeignKey("boning_processes.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("boning_products.id"), nullable=False)
    actual_weight = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False) # Price at the time of process
    vpl = Column(Float, nullable=False)
    participation_percentage = Column(Float, nullable=False)
    allocated_cost = Column(Float, nullable=False)
    unit_cost = Column(Float, nullable=False)
    
    process = relationship("BoningProcess", back_populates="items")
    product = relationship("BoningProduct")

class BoningTemplateSample(Base):
    __tablename__ = "boning_template_samples"
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("boning_templates.id"), nullable=False)
    date = Column(String, nullable=False)
    carcass_weight = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    template = relationship("BoningTemplate", back_populates="samples")
    items = relationship("BoningTemplateSampleItem", back_populates="sample", cascade="all, delete-orphan")

class BoningTemplateSampleItem(Base):
    __tablename__ = "boning_template_sample_items"
    id = Column(Integer, primary_key=True, index=True)
    sample_id = Column(Integer, ForeignKey("boning_template_samples.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("boning_products.id"), nullable=False)
    weight = Column(Float, nullable=False)
    percentage = Column(Float, nullable=False)
    
    sample = relationship("BoningTemplateSample", back_populates="items")
    product = relationship("BoningProduct")

class OmieJobQueue(Base):
    __tablename__ = "omie_jobs_queue"
    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    task_id = Column(String, index=True, nullable=False)
    action_type = Column(String, nullable=False)
    payload = Column(JSONB, nullable=False)
    status = Column(String, default="PENDING")
    error_msg = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
