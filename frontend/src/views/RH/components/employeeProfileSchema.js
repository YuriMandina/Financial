// ==============================================================================
// --- [FICHA CADASTRAL DO COLABORADOR: SEÇÕES, CAMPOS E MÁSCARAS] ---
// Usado pelo formulário de cadastro e pela ficha impressa (mesma fonte de campos).
// ==============================================================================

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

const opts = (list) => list.map((v) => ({ value: v, label: v }));

// Motivos do desligamento (mesmas chaves de TERMINATION_REASONS no backend)
export const TERMINATION_REASON_LABELS = {
  PEDIDO: 'Pedido de demissão',
  SEM_JUSTA_CAUSA: 'Dispensa sem justa causa',
  JUSTA_CAUSA: 'Dispensa por justa causa',
  FIM_EXPERIENCIA: 'Término do contrato de experiência',
  FIM_PRAZO: 'Término do contrato por prazo determinado',
  ACORDO: 'Acordo (art. 484-A)',
  FALECIMENTO: 'Falecimento'
};

export const TERMINATION_REASON_OPTIONS = Object.entries(TERMINATION_REASON_LABELS)
  .map(([value, label]) => ({ value, label }));

// --- Máscaras ---------------------------------------------------------------------
const digits = (v, max) => String(v || '').replace(/\D/g, '').slice(0, max);

export const MASKS = {
  cpf: (v) => digits(v, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2'),
  cep: (v) => digits(v, 8).replace(/(\d{5})(\d)/, '$1-$2'),
  phone: (v) => {
    const d = digits(v, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  },
  pis: (v) => digits(v, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{5})(\d)/, '$1.$2')
    .replace(/(\d{2})(\d)$/, '$1-$2')
};

export const isValidCpf = (value) => {
  const cpf = digits(value, 11);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
};

// --- Seções -------------------------------------------------------------------------
// Campo: { key, label, type: text|date|select|textarea|email, options, mask, span (1-4), sensitive, showIf(sec) }

export const PROFILE_SECTIONS = [
  {
    key: 'contrato',
    label: 'Contrato (complemento)',
    fields: [
      { key: 'matricula', label: 'Matrícula', span: 1 },
      {
        key: 'tipo_contrato', label: 'Tipo de Contrato', type: 'select', span: 1,
        options: opts(['CLT - Prazo indeterminado', 'CLT - Experiência', 'CLT - Prazo determinado', 'Temporário', 'Aprendiz', 'Estágio', 'Intermitente'])
      },
      { key: 'experiencia_fim', label: 'Fim da Experiência', type: 'date', span: 1 },
      { key: 'setor', label: 'Setor / Departamento', span: 1 },
      { key: 'observacoes', label: 'Observações Internas', type: 'textarea', span: 4 }
    ]
  },
  {
    key: 'pessoal',
    label: 'Dados Pessoais',
    fields: [
      { key: 'nome_social', label: 'Nome Social', span: 2 },
      { key: 'data_nascimento', label: 'Data de Nascimento', type: 'date', span: 1 },
      { key: 'sexo', label: 'Sexo', type: 'select', span: 1, options: opts(['Masculino', 'Feminino']) },
      {
        key: 'estado_civil', label: 'Estado Civil', type: 'select', span: 1,
        options: opts(['Solteiro(a)', 'Casado(a)', 'União estável', 'Divorciado(a)', 'Separado(a)', 'Viúvo(a)'])
      },
      {
        key: 'raca_cor', label: 'Raça/Cor', type: 'select', span: 1, sensitive: true,
        options: opts(['Branca', 'Preta', 'Parda', 'Amarela', 'Indígena', 'Não informado'])
      },
      {
        key: 'grau_instrucao', label: 'Grau de Instrução', type: 'select', span: 2,
        options: opts([
          'Analfabeto', 'Fundamental incompleto', 'Fundamental completo', 'Médio incompleto', 'Médio completo',
          'Superior incompleto', 'Superior completo', 'Pós-graduação', 'Mestrado', 'Doutorado'
        ])
      },
      { key: 'nacionalidade', label: 'Nacionalidade', span: 1 },
      { key: 'naturalidade_cidade', label: 'Naturalidade (Cidade)', span: 2 },
      { key: 'naturalidade_uf', label: 'UF', type: 'select', span: 1, options: opts(UFS) },
      { key: 'nome_mae', label: 'Nome da Mãe', span: 2 },
      { key: 'nome_pai', label: 'Nome do Pai', span: 2 },
      { key: 'pcd', label: 'Pessoa com Deficiência', type: 'select', span: 1, sensitive: true, options: opts(['Não', 'Sim']) },
      {
        key: 'pcd_tipo', label: 'Tipo de Deficiência', type: 'select', span: 1, sensitive: true,
        options: opts(['Física', 'Auditiva', 'Visual', 'Intelectual', 'Mental', 'Reabilitado']),
        showIf: (sec) => sec.pcd === 'Sim'
      }
    ]
  },
  {
    key: 'documentos',
    label: 'Documentos',
    fields: [
      { key: 'cpf', label: 'CPF', mask: 'cpf', span: 1 },
      { key: 'pis', label: 'PIS/PASEP/NIT', mask: 'pis', span: 1 },
      { key: 'rg_numero', label: 'RG', span: 1 },
      { key: 'rg_orgao', label: 'Órgão Emissor', span: 1 },
      { key: 'rg_uf', label: 'UF do RG', type: 'select', span: 1, options: opts(UFS) },
      { key: 'rg_emissao', label: 'Emissão do RG', type: 'date', span: 1 },
      { key: 'ctps_numero', label: 'CTPS Número', span: 1 },
      { key: 'ctps_serie', label: 'CTPS Série', span: 1 },
      { key: 'ctps_uf', label: 'UF da CTPS', type: 'select', span: 1, options: opts(UFS) },
      { key: 'titulo_numero', label: 'Título de Eleitor', span: 1 },
      { key: 'titulo_zona', label: 'Zona', span: 1 },
      { key: 'titulo_secao', label: 'Seção', span: 1 },
      { key: 'reservista', label: 'Certificado de Reservista', span: 2 },
      { key: 'cnh_numero', label: 'CNH', span: 1 },
      {
        key: 'cnh_categoria', label: 'Categoria CNH', type: 'select', span: 1,
        options: opts(['A', 'B', 'AB', 'C', 'D', 'E', 'AC', 'AD', 'AE'])
      },
      { key: 'cnh_validade', label: 'Validade CNH', type: 'date', span: 1 },
      { key: 'conselho_registro', label: 'Registro em Conselho', span: 3 }
    ]
  },
  {
    key: 'contato',
    label: 'Contato e Endereço',
    fields: [
      { key: 'celular', label: 'Celular / WhatsApp', mask: 'phone', span: 1 },
      { key: 'telefone', label: 'Telefone Fixo', mask: 'phone', span: 1 },
      { key: 'email', label: 'E-mail', type: 'email', span: 2 },
      { key: 'cep', label: 'CEP', mask: 'cep', span: 1 },
      { key: 'logradouro', label: 'Logradouro', span: 2 },
      { key: 'numero', label: 'Número', span: 1 },
      { key: 'complemento', label: 'Complemento', span: 1 },
      { key: 'bairro', label: 'Bairro', span: 1 },
      { key: 'cidade', label: 'Cidade', span: 1 },
      { key: 'uf', label: 'UF', type: 'select', span: 1, options: opts(UFS) },
      { key: 'emergencia_nome', label: 'Contato de Emergência', span: 2 },
      { key: 'emergencia_parentesco', label: 'Parentesco', span: 1 },
      { key: 'emergencia_telefone', label: 'Telefone de Emergência', mask: 'phone', span: 1 }
    ]
  },
  {
    key: 'bancarios',
    label: 'Dados Bancários',
    fields: [
      { key: 'banco', label: 'Banco', span: 2 },
      { key: 'agencia', label: 'Agência', span: 1 },
      { key: 'conta', label: 'Conta', span: 1 },
      { key: 'tipo_conta', label: 'Tipo de Conta', type: 'select', span: 1, options: opts(['Corrente', 'Poupança', 'Salário']) },
      {
        key: 'pix_tipo', label: 'Tipo de Chave PIX', type: 'select', span: 1,
        options: opts(['CPF', 'Celular', 'E-mail', 'Chave aleatória'])
      },
      { key: 'pix_chave', label: 'Chave PIX', span: 2 }
    ]
  },
  {
    key: 'dependentes',
    label: 'Dependentes',
    list: true,
    fields: [
      { key: 'nome', label: 'Nome', span: 2 },
      { key: 'cpf', label: 'CPF', mask: 'cpf', span: 1 },
      { key: 'nascimento', label: 'Nascimento', type: 'date', span: 1 },
      {
        key: 'parentesco', label: 'Parentesco', type: 'select', span: 1,
        options: opts(['Filho(a)', 'Enteado(a)', 'Cônjuge', 'Companheiro(a)', 'Pai/Mãe', 'Outro'])
      },
      { key: 'irrf', label: 'Dependente IRRF', type: 'checkbox', span: 1 },
      { key: 'salario_familia', label: 'Salário-Família', type: 'checkbox', span: 1 }
    ]
  },
  {
    key: 'saude',
    label: 'Saúde e SST',
    fields: [
      { key: 'aso_admissional_data', label: 'ASO Admissional', type: 'date', span: 1 },
      {
        key: 'aso_resultado', label: 'Resultado do ASO', type: 'select', span: 1,
        options: opts(['Apto', 'Apto com restrição', 'Inapto'])
      },
      { key: 'proximo_periodico', label: 'Próximo Exame Periódico', type: 'date', span: 1 },
      {
        key: 'tipo_sanguineo', label: 'Tipo Sanguíneo', type: 'select', span: 1, sensitive: true,
        options: opts(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
      },
      { key: 'alergias', label: 'Alergias', type: 'textarea', span: 2, sensitive: true },
      { key: 'restricoes', label: 'Restrições / Observações Médicas', type: 'textarea', span: 2, sensitive: true }
    ]
  },
  {
    key: 'uniforme',
    label: 'Uniforme e EPI',
    fields: [
      { key: 'altura', label: 'Altura (m)', span: 1 },
      { key: 'peso', label: 'Peso (kg)', span: 1 },
      {
        key: 'camisa', label: 'Camisa / Jaleco', type: 'select', span: 1,
        options: opts(['PP', 'P', 'M', 'G', 'GG', 'XG', 'XXG', 'EXG'])
      },
      { key: 'calca', label: 'Calça (numeração)', span: 1 },
      { key: 'calcado', label: 'Calçado / Bota (nº)', span: 1 },
      { key: 'luva', label: 'Luva', type: 'select', span: 1, options: opts(['PP', 'P', 'M', 'G', 'XG']) },
      { key: 'avental', label: 'Avental', type: 'select', span: 1, options: opts(['P', 'M', 'G', 'GG', 'XG']) },
      { key: 'touca', label: 'Touca / Capacete', type: 'select', span: 1, options: opts(['P', 'M', 'G', 'Único']) },
      { key: 'observacoes', label: 'Observações de Uniforme e EPI', type: 'textarea', span: 4 }
    ]
  }
];

export const SECTION_BY_KEY = Object.fromEntries(PROFILE_SECTIONS.map((s) => [s.key, s]));

// Abas do cadastro (a aba Contrato reúne os campos existentes + o complemento de contrato)
export const PROFILE_TABS = [
  { key: 'contrato', label: 'Contrato' },
  { key: 'pessoal', label: 'Pessoais' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'contato', label: 'Contato' },
  { key: 'bancarios', label: 'Bancários' },
  { key: 'dependentes', label: 'Dependentes' },
  { key: 'saude', label: 'Saúde & SST' },
  { key: 'uniforme', label: 'Uniforme & EPI' }
];

// Campos essenciais para considerar a ficha completa
export const REQUIRED_PROFILE_FIELDS = [
  ['pessoal', 'data_nascimento'], ['pessoal', 'sexo'], ['pessoal', 'nome_mae'],
  ['documentos', 'cpf'], ['documentos', 'pis'], ['documentos', 'rg_numero'],
  ['contato', 'celular'], ['contato', 'cep'], ['contato', 'logradouro'], ['contato', 'cidade'],
  ['bancarios', 'banco'], ['bancarios', 'agencia'], ['bancarios', 'conta']
];

export const profileCompleteness = (profile = {}) => {
  const filled = REQUIRED_PROFILE_FIELDS.filter(([sec, key]) => String(profile?.[sec]?.[key] || '').trim()).length;
  return { filled, total: REQUIRED_PROFILE_FIELDS.length };
};

export const formatDateBR = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
