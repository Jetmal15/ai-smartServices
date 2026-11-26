import { AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import Button from './Button.jsx'

export default function ErrorMessage({ title = 'Something went wrong', message, onRetry, className }) {
  return (
    <div role="alert" className={cn('flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4', className)}>
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-800">{title}</p>
        {message && <p className="mt-0.5 text-sm text-red-700">{message}</p>}
        {onRetry && (
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-3">
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}
