/**
 * Data local (YYYY-MM-DD) sem passar por UTC — evita o shift de fuso do
 * `toISOString()` (que converte para UTC antes de cortar a data, podendo
 * voltar um dia perto da meia-noite em fusos negativos como o do Brasil).
 * Espelha o padrão `isoDay` de mobile/src/hooks/useHomeIndicators.ts.
 */
export function getLocalDateISO(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
