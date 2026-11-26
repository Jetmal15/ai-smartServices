import { useId } from 'react'
import { cn } from '../../lib/cn.js'
import { controlClasses } from '../../lib/styles.js'
import Field from './Field.jsx'

export default function Input({ label, error, hint, icon: Icon, trailing, className, id, required, ...props }) {
  const autoId = useId()
  const inputId = id ?? autoId
  return (
    <Field id={inputId} label={label} error={error} hint={hint} required={required}>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
        )}
        <input
          id={inputId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(controlClasses(Boolean(error)), Icon && 'pl-10', trailing && 'pr-11', className)}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>}
      </div>
    </Field>
  )
}
