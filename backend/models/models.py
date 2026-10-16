from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, UniqueConstraint, Float, Boolean, BigInteger
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

# ==============================================================================
# --- [BLOCO: MÓDULO DE GESTÃO DE RH - CARGOS, TURNOS & ESCALAS] ---
# ==============================================================================

class RHRole(Base):
    __tablename__ = "rh_roles"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    base_salary = Column(Float, default=0.0) # Salário do cargo vigente hoje (isonomia salarial)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    salary_changes = relationship("RHSalaryChange", back_populates="role", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint('organization_id', 'name', name='uq_org_role_name'),
    )

    organization = relationship("Organization")


class RHWorkShift(Base):
    """
    Template de Escala/Turno com breakdown de horários.
    Ex: Abertura (07:00-12:00 / 13:00-16:00 = 8h líquidas)
    """
    __tablename__ = "rh_work_shifts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False) # Ex: "Abertura de Loja"
    code = Column(String, nullable=False) # Ex: "ABRE", "FECHA"
    start_time = Column(String, nullable=False) # Ex: "07:00"
    lunch_start = Column(String, nullable=True) # Ex: "12:00"
    lunch_end = Column(String, nullable=True) # Ex: "13:00"
    end_time = Column(String, nullable=False) # Ex: "16:00"
    net_hours = Column(Float, nullable=False, default=8.0) # Horas trabalhadas líquidas
    description = Column(String, nullable=True) # Ex: "07:00 às 12:00 (almoço) 13:00 às 16:00"
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('organization_id', 'code', name='uq_org_shift_code'),
    )

    organization = relationship("Organization")


class RHEmployee(Base):
    __tablename__ = "rh_employees"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    role_id = Column(Integer, ForeignKey("rh_roles.id"), nullable=True)
    role = Column(String, nullable=True) # Texto de fallback para retrocompatibilidade
    default_shift_id = Column(Integer, ForeignKey("rh_work_shifts.id"), nullable=True)
    default_daily_transport_tickets = Column(Integer, default=2) # Quantidade padrão de passagens/dia (ex: 2 ou 4)
    daily_transport_cost = Column(Float, default=9.40) # Mantido para compatibilidade
    daily_meal_cost = Column(Float, default=25.00) # Valor individual de 1 refeição/dia
    weekly_contract_hours = Column(Float, default=44.0) # Regime semanal contratual (ex: 44h, 40h)
    weekly_actual_hours = Column(Float, default=48.0) # Regime praticado
    work_days_per_week = Column(Integer, default=6) # 5 ou 6 dias de trabalho por semana
    base_salary = Column(Float, default=0.0) # Salário base mensal (folha de pagamento)
    dependents = Column(Integer, default=0) # Dependentes para dedução do IRRF
    admission_date = Column(Date, nullable=True) # Data de admissão (tempo de casa / triênio)
    overtime_policy = Column(String, nullable=True) # Destino das horas extras (None = padrão da empresa)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization")
    role_obj = relationship("RHRole")
    default_shift = relationship("RHWorkShift")
    schedule_days = relationship("RHScheduleDay", back_populates="employee", cascade="all, delete-orphan")
    work_days = relationship("RHWorkDay", back_populates="employee", cascade="all, delete-orphan")
    payroll_entries = relationship("RHPayrollEntry", back_populates="employee", cascade="all, delete-orphan")


class RHSalaryChange(Base):
    """Histórico salarial do cargo: salário vigente a partir da data (sem data = salário inicial)."""
    __tablename__ = "rh_role_salary_changes"

    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("rh_roles.id"), nullable=False, index=True)
    effective_date = Column(Date, nullable=True)
    salary = Column(Float, nullable=False)
    reason = Column(String, nullable=True) # Ex: "Dissídio 2026", "Promoção"
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    role = relationship("RHRole", back_populates="salary_changes")


class RHBankHours(Base):
    """Banco de horas mensal por colaborador: saldo anterior, movimento do mês, horas pagas e saldo final."""
    __tablename__ = "rh_bank_hours"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("rh_employees.id"), nullable=False, index=True)
    policy = Column(String, nullable=True) # Decisão do mês (None = padrão do colaborador/empresa)
    previous_balance_minutes = Column(Integer, default=0)
    month_balance_minutes = Column(Integer, default=0)
    paid_minutes = Column(Integer, default=0)
    balance_minutes = Column(Integer, default=0) # Saldo após o mês
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('schedule_id', 'employee_id', name='uq_bank_hours_schedule_employee'),
    )


class RHPayrollItem(Base):
    """Rubrica da folha de pagamento: receita (provento) ou despesa (desconto)."""
    __tablename__ = "rh_payroll_items"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    code = Column(String, nullable=False) # Ex: "001", "HE50"
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False) # RECEITA ou DESPESA
    calc_type = Column(String, default="FIXED") # FIXED (valor) ou PERCENT (% do salário base)
    default_value = Column(Float, default=0.0)
    recurring = Column(Boolean, default=False) # Lançada automaticamente para todos no cálculo da folha
    incide_inss = Column(Boolean, default=True)
    incide_irrf = Column(Boolean, default=True)
    incide_fgts = Column(Boolean, default=True)
    system_key = Column(String, nullable=True) # Rubricas automáticas do sistema (SALARIO, HE50, INSS...)
    affects_net = Column(Boolean, default=True) # False para itens informativos (FGTS, VA)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization")
    entries = relationship("RHPayrollEntry", back_populates="item")


class RHPayrollEntry(Base):
    """Lançamento de uma rubrica para um colaborador em uma folha mensal."""
    __tablename__ = "rh_payroll_entries"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("rh_employees.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("rh_payroll_items.id"), nullable=False, index=True)
    reference = Column(String, nullable=True) # Ex: "12h30", "2 dias", "7,5%"
    amount = Column(Float, nullable=False, default=0.0)
    source = Column(String, default="MANUAL") # MANUAL ou AUTO
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    employee = relationship("RHEmployee", back_populates="payroll_entries")
    item = relationship("RHPayrollItem", back_populates="entries")


class RHSettings(Base):
    __tablename__ = "rh_settings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), unique=True, nullable=False)
    max_consecutive_sundays = Column(Integer, default=2)
    transport_ticket_unit_price = Column(Float, default=4.70) # Tarifa única universal da passagem
    default_transport_cost = Column(Float, default=9.40) # Fallback 2 passagens
    default_meal_cost = Column(Float, default=25.00)
    min_daily_hours_for_meal = Column(Float, default=6.0)
    weekly_bank_overtime_hours = Column(Float, default=4.0)
    compensatory_days_per_month = Column(Integer, default=2)
    time_rounding_minutes = Column(Integer, default=0) # 0 (sem arredondar), 5, 10, 15, 30, 60
    time_rounding_mode = Column(String, default="NEAREST") # NEAREST, DOWN, UP
    clt_tolerance_enabled = Column(Boolean, default=True) # Art. 58 §1º CLT
    hours_display_format = Column(String, default="HHMM") # HHMM ou DECIMAL
    absence_dsr_mode = Column(String, default="ONE") # Desconto de DSR por falta: NONE, ONE ou SCHEDULE
    overtime_policy = Column(String, default="PAY") # PAY, PAY_NORMAL, FIXED_PLUS_BANK ou BANK
    overtime_rate = Column(Float, default=50.0) # Acréscimo da hora extra (%)
    overtime_fixed_value = Column(Float, default=0.0) # Valor fixo por hora no modo valor fixo + folga
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organization = relationship("Organization")


class RHHoliday(Base):
    __tablename__ = "rh_holidays"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    date = Column(String, nullable=False) # Formato YYYY-MM-DD
    name = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('organization_id', 'date', name='uq_org_holiday_date'),
    )


class RHMonthlySchedule(Base):
    __tablename__ = "rh_monthly_schedules"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False) # 1 a 12
    status = Column(String, default="DRAFT") # DRAFT, PUBLISHED, CLOSED
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('organization_id', 'year', 'month', name='uq_org_schedule_month'),
    )

    days = relationship("RHScheduleDay", back_populates="schedule", cascade="all, delete-orphan")
    work_days = relationship("RHWorkDay", back_populates="schedule", cascade="all, delete-orphan")
    benefit_adjustments = relationship("RHBenefitAdjustment", back_populates="schedule", cascade="all, delete-orphan")


class RHScheduleDay(Base):
    __tablename__ = "rh_schedule_days"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("rh_employees.id", ondelete="CASCADE"), nullable=False)
    schedule_type = Column(String, nullable=False) # 'TRANSPORTE' ou 'ALIMENTACAO'
    day = Column(Integer, nullable=False) # 1 a 31
    status = Column(String, nullable=False, default="OFF") # 'X', 'BH', 'F', 'FE', 'OFF'
    shift_id = Column(Integer, ForeignKey("rh_work_shifts.id"), nullable=True)
    shift = Column(String, nullable=True) # 'ABRE' (07h-16h), 'FECHA' (09h-19h), ou customizado
    tickets_count = Column(Integer, default=2) # Quantidade de vales para o dia (ex: 2 ou 4)
    daily_hours = Column(Float, default=8.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('schedule_id', 'employee_id', 'schedule_type', 'day', name='uq_schedule_emp_type_day'),
    )

    schedule = relationship("RHMonthlySchedule", back_populates="days")
    employee = relationship("RHEmployee", back_populates="schedule_days")
    shift_obj = relationship("RHWorkShift")


# ==============================================================================
# --- [BLOCO: NOVA JORNADA UNIFICADA DIÁRIA & AJUSTES AVULSOS] ---
# ==============================================================================

class RHWorkDay(Base):
    __tablename__ = "rh_work_days"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("rh_employees.id", ondelete="CASCADE"), nullable=False)
    day = Column(Integer, nullable=False) # 1 a 31
    # Status padrão: TRABALHO, DSR, FOLGA, FERIADO, FERIAS, FOLGA_BH, FALTA, ATESTADO
    status = Column(String, nullable=False, default="TRABALHO")
    shift_id = Column(Integer, ForeignKey("rh_work_shifts.id"), nullable=True)
    shift = Column(String, nullable=True) # Código do turno (ex: ABRE, FECHA)
    start_time = Column(String, nullable=True) # "07:00"
    lunch_start = Column(String, nullable=True) # "12:00"
    lunch_end = Column(String, nullable=True) # "13:00"
    end_time = Column(String, nullable=True) # "16:00"
    raw_minutes = Column(Integer, default=480) # Minutos brutos calculados (ex: 480 min = 8h)
    worked_minutes = Column(Integer, default=480) # Minutos apurados após tolerância
    vt_tickets_override = Column(Integer, nullable=True) # NULL: calculado, 0: sem VT, N: override
    va_override = Column(Boolean, nullable=True) # NULL: calculado, True: concedido, False: removido
    benefit_note = Column(String, nullable=True) # Observação/justificativa do ajuste de benefício
    is_manual = Column(Boolean, default=False) # Proteção contra sobrescrita acidental em preenchimento em lote
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('schedule_id', 'employee_id', 'day', name='uq_rh_work_day'),
    )

    schedule = relationship("RHMonthlySchedule", back_populates="work_days")
    employee = relationship("RHEmployee", back_populates="work_days")
    shift_obj = relationship("RHWorkShift")


class RHBenefitAdjustment(Base):
    __tablename__ = "rh_benefit_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id", ondelete="CASCADE"), nullable=False)
    employee_id = Column(Integer, ForeignKey("rh_employees.id", ondelete="CASCADE"), nullable=False)
    benefit_type = Column(String, nullable=False) # 'VT' ou 'VA'
    quantity = Column(Float, nullable=False) # Ex: +3 passagens ou -1 VA
    reason = Column(String, nullable=True) # Motivo do ajuste avulso
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    schedule = relationship("RHMonthlySchedule", back_populates="benefit_adjustments")
    employee = relationship("RHEmployee")


