import { useId } from 'react'
import { cn } from '../../lib/cn.js'
import { controlClasses } from '../../lib/styles.js'
import Field from './Field.jsx'

export default function Textarea({ label, error, hint, rows = 4, className, id, required, ...props }) {
  const autoId = useId()
  const areaId = id ?? autoId
  return (
    <Field id={areaId} label={label} error={error} hint={hint} required={required}>
      <textarea
        id={areaId}
        rows={rows}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${areaId}-error` : hint ? `${areaId}-hint` : undefined}
        className={cn(controlClasses(Boolean(error)), 'resize-y', className)}
        {...props}
      />
    </Field>
  )
}
