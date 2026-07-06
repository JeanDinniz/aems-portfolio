import { DEPARTMENT_COLORS, DEPARTMENT_FALLBACK_COLOR, CATEGORY_COLORS, CATEGORY_FALLBACK_COLOR } from '@/constants/departments'
import { DEPARTMENTS_MAP } from '@/constants/service-orders'
import { SERVICE_CATEGORY_LABELS } from '@/services/api/services.service'

interface DepartmentBadgeProps {
  department: string
  className?: string
}

interface CategoryBadgeProps {
  category: string
  className?: string
}

export function DepartmentBadge({ department, className }: DepartmentBadgeProps) {
  const colors = DEPARTMENT_COLORS[department] ?? DEPARTMENT_FALLBACK_COLOR
  const label = DEPARTMENTS_MAP[department as keyof typeof DEPARTMENTS_MAP] ?? department
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${colors}${className ? ` ${className}` : ''}`}>
      {label}
    </span>
  )
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const colors = CATEGORY_COLORS[category] ?? CATEGORY_FALLBACK_COLOR
  const label = (SERVICE_CATEGORY_LABELS as Record<string, string>)[category] ?? category
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors}${className ? ` ${className}` : ''}`}>
      {label}
    </span>
  )
}
