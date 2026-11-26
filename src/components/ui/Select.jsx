import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn.js'
import { controlClasses } from '../../lib/styles.js'
import Field from './Field.jsx'

/** `options` is an array of strings or { value, label } objects. */
export default function Select({ label, error, hint, options = [], placeholder, className, id, required, ...props }) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <Field id={selectId} label={label} error={error} hint={hint} required={required}>
      <div className="relative">
        <select
          id={selectId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          className={cn(controlClasses(Boolean(error)), 'appearance-none pr-10', className)}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => {
            const { value, label: text } = typeof option === 'string' ? { value: option, label: option } : option
            return (
              <option key={value} value={value}>
                {text}
              </option>
            )
          })}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
    </Field>
  )
}
