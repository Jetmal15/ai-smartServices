import { Check, MessageSquareText } from 'lucide-react'
import { COMPLAINT_STATUS } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/format.js'
import { buildProgress, describeChange } from '../../lib/tracking.js'

const DOT = {
  done: 'border-emerald-500 bg-emerald-500 text-white',
  current: 'border-brand-600 bg-brand-600 text-white ring-4 ring-brand-100',
  upcoming: 'border-slate-300 bg-white text-slate-400',
}

/** Progress tracker (where the complaint is in its life cycle) plus the status history with department remarks. */
export default function ComplaintTimeline({ status, history, showActor = false }) {
  const steps = buildProgress(status, history)
  const entries = [...history].reverse() // newest first

  return (
    <section aria-labelledby="tracking-heading" className="mt-8">
      <h2 id="tracking-heading" className="text-sm font-semibold text-slate-900">
        Progress
      </h2>

      <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Complaint progress">
        {steps.map((step, index) => (
          <li key={step.status} className="relative flex flex-col items-center text-center" aria-current={step.state === 'current' ? 'step' : undefined}>
            {index > 0 && <span aria-hidden="true" className={`absolute right-1/2 top-3.5 h-0.5 w-full ${step.state === 'upcoming' ? 'bg-slate-200' : 'bg-emerald-500'}`} />}
            <span className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold ${DOT[step.state]}`}>
              {step.state === 'done' ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
            </span>
            <span className={`mt-2 text-xs font-medium ${step.state === 'upcoming' ? 'text-slate-400' : 'text-slate-800'}`}>{step.label}</span>
            {step.at && step.state !== 'upcoming' && <span className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{formatDateTime(step.at)}</span>}
          </li>
        ))}
      </ol>

      <h3 className="mt-8 text-sm font-semibold text-slate-900">Status history</h3>
      <ol className="mt-3 space-y-4 border-l-2 border-slate-200 pl-5">
        {entries.map((entry, index) => (
          <li key={`${entry.at}-${entry.status}-${index}`} className="relative">
            <span aria-hidden="true" className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 ${index === 0 ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white'}`} />
            <p className="text-sm font-medium text-slate-900">
              {describeChange(entry)}
              {index === 0 && <span className="ml-2 text-xs font-normal text-brand-700">Current</span>}
            </p>
            <p className="text-xs text-slate-500">
              {formatDateTime(entry.at)} · {showActor && entry.actorName ? entry.actorName : entry.by}
            </p>
            {entry.remark && (
              <p className="mt-2 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="whitespace-pre-wrap break-words">
                  <span className="font-medium">Department remark: </span>
                  {entry.remark}
                </span>
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="sr-only">Current status: {COMPLAINT_STATUS[status]?.label ?? status}</p>
    </section>
  )
}
