import { TriangleAlert } from 'lucide-react'

interface AlertBannerProps {
  atrasado: number
  atencao: number
}

export function AlertBanner({ atrasado, atencao }: AlertBannerProps) {
  if (atrasado === 0 && atencao === 0) return null

  const parts: string[] = []
  if (atrasado > 0) parts.push(`${atrasado} atrasado${atrasado > 1 ? 's' : ''}`)
  if (atencao > 0) parts.push(`${atencao} em atencao`)

  return (
    <div className="flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2.5 text-sm font-medium text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
      <TriangleAlert className="h-4 w-4 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
      <span>{parts.join(' • ')}</span>
    </div>
  )
}
