import type { FilmRoll } from '@/services/api/inventory.service'

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sem criar Date (evita deslocamento de timezone)
export function formatReceiptDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  if (!year || !month || !day) return isoDate
  return `${day}/${month}/${year}`
}

// Nome amigável da bobina: "Poliester G20" (tonalidade só quando houver, ex.: PPF não tem)
export function formatFilmRollName(
  roll: Pick<FilmRoll, 'film_type_name' | 'tonality' | 'visual_id'>
): string {
  if (!roll.film_type_name) return roll.visual_id
  return roll.tonality ? `${roll.film_type_name} ${roll.tonality}` : roll.film_type_name
}

// Aceita number OU string — alguns campos Decimal do backend chegam como STRING
// (Pydantic v2), então nunca `.toFixed` direto. `null`/`undefined`/`''`/NaN → "—".
export function formatMeters(meters: number | string | null | undefined): string {
  if (meters == null || meters === '') return '—'
  const n = typeof meters === 'number' ? meters : Number(meters)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1).replace('.', ',')}m`
}
