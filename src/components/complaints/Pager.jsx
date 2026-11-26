import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/index.js'

export default function Pager({ page, pageSize, total, onChange }) {
  if (total <= pageSize) return null
  const pages = Math.ceil(total / pageSize)
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
      <span>
        Page {page + 1} of {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" icon={ChevronLeft} disabled={page === 0} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
