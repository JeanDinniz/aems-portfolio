import type { AppointmentDisplayStatus } from '@/types/scheduling.types'
import { DEPARTMENT_COLORS } from '@/constants/departments'

export { DEPARTMENT_COLORS as DEPARTMENT_BADGE_COLORS }

export const APPOINTMENT_STATUS_CONFIG: Record<
  AppointmentDisplayStatus,
  {
    label: string
    color: string
    borderColor: string
    bgDot: string
    bgCard: string
  }
> = {
  atrasado:    { label: 'Atrasado',    color: '#EF4444', borderColor: 'border-l-red-500',    bgDot: 'bg-red-500',    bgCard: 'bg-red-50 dark:bg-red-900/20' },
  atencao:     { label: 'Atenção',     color: '#F59E0B', borderColor: 'border-l-amber-500',  bgDot: 'bg-amber-500',  bgCard: 'bg-amber-50 dark:bg-amber-900/20' },
  agendado:    { label: 'Agendado',    color: '#3B82F6', borderColor: 'border-l-blue-500',   bgDot: 'bg-blue-500',   bgCard: 'bg-blue-50 dark:bg-blue-900/20' },
  em_execucao: { label: 'Em execução', color: '#22C55E', borderColor: 'border-l-green-500',  bgDot: 'bg-green-500',  bgCard: 'bg-green-50 dark:bg-green-900/20' },
  duplicidade: { label: 'Duplicidade', color: '#F97316', borderColor: 'border-l-orange-500', bgDot: 'bg-orange-500', bgCard: 'bg-orange-50 dark:bg-orange-900/20' },
  finalizado:  { label: 'Finalizado',  color: '#A855F7', borderColor: 'border-l-purple-500', bgDot: 'bg-purple-500', bgCard: 'bg-purple-50 dark:bg-purple-900/20' },
  cancelado:   { label: 'Cancelado',   color: '#9CA3AF', borderColor: 'border-l-gray-400',   bgDot: 'bg-gray-400',   bgCard: 'bg-gray-100 dark:bg-zinc-800' },
}

export const DEPARTMENT_LABELS: Record<string, string> = {
  film:          'Película',
  security_film: 'Película de Segurança',
  ppf:      'PPF',
  bodywork: 'Funilaria',
  vn:       'VN',
  vd:       'VD',
  vu:       'VU',
  workshop: 'Oficina',
}

// Departamentos temporariamente ocultos no módulo de Agendamentos (criação, edição e filtro).
// Para reexibir, basta esvaziar esta lista. O backend continua aceitando todos.
export const HIDDEN_SCHEDULING_DEPARTMENTS = ['bodywork', 'vn', 'vd', 'vu', 'workshop']

export const VISIBLE_DEPARTMENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(DEPARTMENT_LABELS).filter(([value]) => !HIDDEN_SCHEDULING_DEPARTMENTS.includes(value))
)

// Departamentos exibidos no Agendamento respeitando a restrição do perfil de acesso.
// `allowed` vazio/ausente = comportamento padrão (todos os visíveis); caso contrário,
// exibe exatamente os departamentos permitidos pelo perfil.
export function visibleDepartmentEntries(allowed?: string[] | null): [string, string][] {
  if (!allowed || allowed.length === 0) {
    return Object.entries(VISIBLE_DEPARTMENT_LABELS)
  }
  return allowed.map((value) => [value, DEPARTMENT_LABELS[value] ?? value] as [string, string])
}


export const STATUS_PRIORITY: Record<AppointmentDisplayStatus, number> = {
  atrasado:    0,
  atencao:     1,
  agendado:    2,
  em_execucao: 3,
  duplicidade: 4,
  finalizado:  5,
  cancelado:   6,
}

export const FILM_TONALITY_OPTIONS = [
  { value: 'G05',    label: 'G05' },
  { value: 'G20',    label: 'G20' },
  { value: 'G35',    label: 'G35' },
  { value: 'G50',    label: 'G50' },
  { value: 'G75',    label: 'G75' },
  { value: 'Incolor', label: 'Incolor' },
]

// Serviços de Película Transparente: apenas G75 e Incolor são válidos
export const TRANSPARENT_FILM_CODES = ['WB']
export const TRANSPARENT_FILM_TONALITIES = ['G75', 'Incolor']

// Sugestões de região do carro para tonalidades por região (texto livre curto)
export const FILM_REGION_SUGGESTIONS = [
  'Portas dianteiras',
  'Portas traseiras',
  'Vidro traseiro',
  'Para-brisa',
  'Quebra-ventos',
  'Teto',
]

/**
 * Opções de tonalidade para um item.
 * Prioridade:
 *  1) availableTonalities (tonalidades configuradas no tipo de bobina / FilmType) — governa.
 *  2) fallback por departamento: "Incolor" só aparece em película de segurança
 *     (preservando a restrição de película transparente WB → G75/Incolor).
 */
export function getTonalityOptions(opts?: {
  serviceCode?: string | null
  department?: string | null
  availableTonalities?: string[] | null
}) {
  const { serviceCode, department, availableTonalities } = opts ?? {}

  // 1) Configurável por tipo de bobina
  if (availableTonalities && availableTonalities.length > 0) {
    return FILM_TONALITY_OPTIONS.filter((opt) => availableTonalities.includes(opt.value))
  }

  // 2) Fallback
  let options = FILM_TONALITY_OPTIONS
  if (serviceCode && TRANSPARENT_FILM_CODES.some((c) => serviceCode.startsWith(c))) {
    options = options.filter((opt) => TRANSPARENT_FILM_TONALITIES.includes(opt.value))
  }
  // "Incolor" só para película de segurança
  if (department !== 'security_film') {
    options = options.filter((opt) => opt.value !== 'Incolor')
  }
  return options
}
