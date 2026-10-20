from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, UniqueConstraint, Float, Boolean, BigInteger, JSON, LargeBinary, Text
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
    # Dados cadastrais da empresa (documentos como a folha de ponto):
    # {razao_social, nome_fantasia, cnpj, inscricao_estadual, endereco, cidade, uf, cep, telefone, email, responsavel}
    company = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
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
    # Papel no Módulo de Inventário: NULL/'GERENTE' = acesso completo; 'CONTADOR' = apenas contagem
    inventory_role = Column(String, nullable=True)
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
    is_active_for_inventory = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
class BoningProduct(Base):
    __tablename__ = "boning_products"
    id = Column(Integer, primary_key=True, index=True)
    omie_id = Column(BigInteger, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    family_id = Column(Integer, ForeignKey("boning_families.id"), nullable=True)
    unit_price = Column(Float, nullable=False)
    is_standard_cut = Column(Boolean, default=False)
    # Cadastro usado pelo Módulo de Inventário (sincronizado da Omie)
    code = Column(String, nullable=True)  # Código do produto exibido na Omie (campo "codigo"); omie_id é o ID interno
    ean = Column(String, nullable=True, index=True)
    unit = Column(String, nullable=True)
    ncm = Column(String, nullable=True)
    is_inventory_default = Column(Boolean, default=True)
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
    # Ficha cadastral: {pessoal, documentos, contato, contrato, bancarios, dependentes[], saude, uniforme, observacoes}
    profile = Column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
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
    adjustments_minutes = Column(Integer, default=0) # Créditos - débitos manuais do mês
    balance_minutes = Column(Integer, default=0) # Saldo após o mês
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('schedule_id', 'employee_id', name='uq_bank_hours_schedule_employee'),
    )


class RHSalaryAdvance(Base):
    """Decisão do mês de pagar (ou não) o adiantamento salarial ao colaborador."""
    __tablename__ = "rh_salary_advances"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("rh_employees.id"), nullable=False, index=True)
    enabled = Column(Boolean, default=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('schedule_id', 'employee_id', name='uq_salary_advance_schedule_employee'),
    )


class RHBankHoursEntry(Base):
    """Lançamento manual no banco de horas: pagamento (parcial) de horas, crédito ou débito."""
    __tablename__ = "rh_bank_hours_entries"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("rh_monthly_schedules.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("rh_employees.id"), nullable=False, index=True)
    kind = Column(String, nullable=False) # PAYMENT, CREDIT ou DEBIT
    minutes = Column(Integer, nullable=False) # Sempre positivo; o tipo define o sinal
    pay_mode = Column(String, nullable=True) # PAYMENT: PAY (com acréscimo) ou PAY_NORMAL
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


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
    overtime_policy = Column(String, default="BANK") # PAY, PAY_NORMAL, FIXED_PLUS_BANK ou BANK
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


# ==============================================================================
# --- [BLOCO: MÓDULO DE INVENTÁRIO - BALANÇO DE ESTOQUE POR FAMÍLIA] ---
# ==============================================================================

class ProductPackaging(Base):
    """Embalagem de um produto (ex: CX com 12 un, DUN-14 próprio e tara para pesagem)."""
    __tablename__ = "inventory_product_packagings"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("boning_products.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)  # Ex: CX, FD, BANDEJA
    factor = Column(Float, nullable=False, default=1.0)  # Unidades do produto por embalagem
    ean = Column(String, nullable=True, index=True)  # DUN-14 / EAN da embalagem
    tare_kg = Column(Float, nullable=False, default=0.0)  # Tara para produtos pesados
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("BoningProduct")


class InventoryCount(Base):
    """Inventário (balanço) de uma família de produtos em uma data de corte."""
    __tablename__ = "inventory_counts"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    family_id = Column(Integer, ForeignKey("boning_families.id"), nullable=False, index=True)
    cutoff_date = Column(Date, nullable=False)
    omie_local_code = Column(BigInteger, nullable=True)  # Local de estoque Omie (NULL = padrão)
    status = Column(String, nullable=False, default="RASCUNHO", index=True)
    notes = Column(Text, nullable=True)
    recount_pct = Column(Float, nullable=False, default=5.0)
    recount_value = Column(Float, nullable=False, default=50.0)
    cmc_tolerance_pct = Column(Float, nullable=False, default=30.0)
    snapshot_at = Column(DateTime(timezone=True), nullable=True)
    snapshot_hash = Column(String, nullable=True)
    omie_task_id = Column(String, nullable=True)  # Task de snapshot/efetivação/reversão em andamento
    effectivation_seq = Column(Integer, nullable=False, default=1)  # Incrementa a cada reversão (novo cod_int_ajuste)
    last_error = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    effective_at = Column(DateTime(timezone=True), nullable=True)
    concluded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    family = relationship("BoningFamily")
    created_by = relationship("User", foreign_keys=[created_by_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])
    items = relationship("InventoryCountItem", back_populates="count", cascade="all, delete-orphan",
                         foreign_keys="InventoryCountItem.count_id", order_by="InventoryCountItem.product_name")
    documents = relationship("InventoryDocument", back_populates="count", cascade="all, delete-orphan")


class InventoryCountItem(Base):
    """Produto no escopo do inventário: snapshot do sistema, total contado e conferência."""
    __tablename__ = "inventory_count_items"

    id = Column(Integer, primary_key=True, index=True)
    count_id = Column(Integer, ForeignKey("inventory_counts.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("boning_products.id"), nullable=False)
    omie_id = Column(BigInteger, nullable=False)
    product_name = Column(String, nullable=False)  # Congelado na criação para o relatório
    product_code = Column(String, nullable=True)  # Código do produto na Omie (congelado na criação)
    unit = Column(String, nullable=True)
    ean = Column(String, nullable=True)
    # --- Snapshot da Omie na data de corte ---
    system_qty = Column(Float, nullable=True)
    system_value = Column(Float, nullable=True)
    cmc = Column(Float, nullable=True)
    reference_cost = Column(Float, nullable=True)  # Último custo de compra (ou informado pela gerência)
    # --- Contagem ---
    current_round = Column(Integer, nullable=False, default=1)
    counted_qty = Column(Float, nullable=False, default=0.0)  # Soma dos lançamentos da rodada atual
    confirmed_zero = Column(Boolean, nullable=False, default=False)
    count_status = Column(String, nullable=False, default="PENDENTE")
    # --- Conferência ---
    reference_cost_source = Column(String, nullable=True)  # OMIE ou MANUAL
    adjustment_case = Column(String, nullable=True)  # A, B, C ou D
    justification = Column(Text, nullable=True)
    pair_item_id = Column(Integer, ForeignKey("inventory_count_items.id", ondelete="SET NULL"), nullable=True)
    cmc_correction_approved = Column(Boolean, nullable=False, default=False)
    # --- Conferência pós-efetivação (saldo/CMC lidos da Omie após o ajuste) ---
    verified_qty = Column(Float, nullable=True)
    verified_cmc = Column(Float, nullable=True)
    verify_status = Column(String, nullable=True)  # OK ou DIVERGENTE
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    count = relationship("InventoryCount", back_populates="items", foreign_keys=[count_id])
    reasons = relationship("InventoryItemReason", back_populates="item", cascade="all, delete-orphan",
                           order_by="InventoryItemReason.id")
    product = relationship("BoningProduct")
    entries = relationship("InventoryCountEntry", back_populates="item", cascade="all, delete-orphan",
                           order_by="InventoryCountEntry.id")
    adjustment = relationship("InventoryAdjustment", back_populates="item", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("count_id", "product_id", name="uq_inventory_item_product"),
    )


class InventoryItemReason(Base):
    """Distribuição da divergência do item entre motivos (ex: 2 un avaria + 3 un não identificadas)."""
    __tablename__ = "inventory_item_reasons"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_count_items.id", ondelete="CASCADE"), nullable=False, index=True)
    reason = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("InventoryCountItem", back_populates="reasons")


class InventoryCountEntry(Base):
    """Lançamento de contagem (append-only). Estornos marcam voided, nunca apagam."""
    __tablename__ = "inventory_count_entries"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_count_items.id", ondelete="CASCADE"), nullable=False, index=True)
    client_uuid = Column(String, nullable=False, unique=True, index=True)  # Idempotência do sync offline
    round = Column(Integer, nullable=False, default=1)
    mode = Column(String, nullable=False)  # UN, EMB ou PESO
    packaging_id = Column(Integer, ForeignKey("inventory_product_packagings.id", ondelete="SET NULL"), nullable=True)
    raw_qty = Column(Float, nullable=False)  # Unidades, nº de embalagens ou peso bruto
    factor = Column(Float, nullable=False, default=1.0)
    tare_total = Column(Float, nullable=False, default=0.0)
    quantity = Column(Float, nullable=False)  # Quantidade líquida na unidade do produto
    expression = Column(String, nullable=True)  # Expressão digitada (ex: 12*12+6)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    device_id = Column(String, nullable=True)
    counted_at = Column(DateTime(timezone=True), nullable=True)  # Horário do aparelho
    voided = Column(Boolean, nullable=False, default=False)
    voided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    voided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("InventoryCountItem", back_populates="entries")
    user = relationship("User", foreign_keys=[user_id])


class InventoryAdjustment(Base):
    """Ajuste de estoque enviado à Omie para um item (um por item)."""
    __tablename__ = "inventory_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("inventory_count_items.id", ondelete="CASCADE"), nullable=False, unique=True)
    tipo = Column(String, nullable=False)  # ENT, SAI ou SLD
    motivo = Column(String, nullable=False)  # INV, PER ou CMC
    quantity = Column(Float, nullable=False)
    unit_value = Column(Float, nullable=False)
    cod_int_ajuste = Column(String, nullable=False, unique=True)
    omie_ajuste_id = Column(BigInteger, nullable=True)
    status = Column(String, nullable=False, default="PENDING")  # PENDING, DONE, FAILED, REVERTED
    error_msg = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    done_at = Column(DateTime(timezone=True), nullable=True)

    item = relationship("InventoryCountItem", back_populates="adjustment")


class InventoryDocument(Base):
    """Documentos do inventário: relatório gerado e via assinada digitalizada."""
    __tablename__ = "inventory_documents"

    id = Column(Integer, primary_key=True, index=True)
    count_id = Column(Integer, ForeignKey("inventory_counts.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String, nullable=False)  # RELATORIO ou VIA_ASSINADA
    filename = Column(String, nullable=False)
    content_type = Column(String, nullable=False)
    content = Column(LargeBinary, nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    count = relationship("InventoryCount", back_populates="documents")


