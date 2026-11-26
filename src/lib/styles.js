import { cn } from './cn.js'

/** Shared look for Input, Select, and Textarea. */
export const controlClasses = (hasError = false) =>
  cn(
    'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-xs transition',
    'placeholder:text-slate-400 focus:outline-hidden focus:ring-2',
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  )
