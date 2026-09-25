import { MessageSquareText, Wrench, type LucideIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface NoteSource {
  label: string
  text: string | null
  icon: LucideIcon
  tone: 'consultant' | 'installer'
}

const toneClass = {
  consultant: 'text-blue-600 dark:text-blue-400',
  installer: 'text-amber-600 dark:text-amber-400',
} as const

function NoteLine({ source }: { source: NoteSource }) {
  const Icon = source.icon
  const has = !!source.text
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', has ? toneClass[source.tone] : 'text-muted-foreground/40')} />
      <span className={cn('truncate text-xs', has ? 'text-foreground' : 'text-muted-foreground/60')}>
        {source.text ?? '—'}
      </span>
    </span>
  )
}

interface NotesCellProps {
  consultant: string | null
  installer: string | null
}

export function NotesCell({ consultant, installer }: NotesCellProps) {
  const sources: NoteSource[] = [
    { label: 'Briefing do Consultor', text: consultant, icon: MessageSquareText, tone: 'consultant' },
    { label: 'Relato Técnico do Instalador', text: installer, icon: Wrench, tone: 'installer' },
  ]

  if (!consultant && !installer) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Ver anotações — Briefing do Consultor: ${consultant ? 'preenchido' : 'vazio'}; Relato Técnico do Instalador: ${installer ? 'preenchido' : 'vazio'}`}
          className="flex w-[240px] flex-col gap-0.5 rounded-md px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {sources.map((s) => (
            <NoteLine key={s.tone} source={s} />
          ))}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-96 p-0">
        <div className="max-h-72 divide-y overflow-y-auto">
          {sources.map((s) => {
            const Icon = s.icon
            return (
              <section key={s.tone} className="space-y-1 p-3">
                <h4 className={cn('flex items-center gap-1.5 text-xs font-semibold', toneClass[s.tone])}>
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {s.label}
                </h4>
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {s.text ?? <span className="italic text-muted-foreground">Sem anotação.</span>}
                </p>
              </section>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
