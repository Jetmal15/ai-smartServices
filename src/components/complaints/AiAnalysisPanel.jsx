import { useEffect, useState } from 'react'
import { Bot, Check, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Alert, Badge, Button, Card } from '../ui/index.js'
import { COMPLAINT_PRIORITY } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/format.js'
import { useAuth } from '../../hooks/useAuth.js'
import * as complaintService from '../../services/complaintService.js'

const POLL_MS = 3000
const POLL_TRIES = 10

const priorityBadge = (priority) =>
  priority ? <Badge variant={COMPLAINT_PRIORITY[priority]?.variant ?? 'neutral'}>{COMPLAINT_PRIORITY[priority]?.label ?? priority}</Badge> : <span className="text-slate-400">–</span>

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{children}</dd>
    </div>
  )
}

/**
 * The AI analysis of a complaint, for department staff and administrators. Everything shown is a SUGGESTION produced on the
 * server (by the AI provider, or by the rule-based fallback when the AI is unavailable). Nothing is applied automatically:
 * a person reviews it, may apply the suggested priority, and only an administrator can move a complaint to another department.
 * `onChanged({ complaint, history, notes, ai })` receives the refreshed complaint after every change.
 */
export default function AiAnalysisPanel({ complaint, ai, canReassign = false, onChanged }) {
  const { handleAuthError } = useAuth()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmMove, setConfirmMove] = useState(false)
  const [waiting, setWaiting] = useState(false) // an analysis was requested and we are waiting for its result
  const [baseline, setBaseline] = useState(null)

  const status = ai?.status ?? 'none'
  const inProgress = status === 'pending' || waiting

  // While an analysis is running, look for the result every few seconds (it finishes in the background on the server).
  useEffect(() => {
    if (!inProgress) return undefined
    let cancelled = false
    let tries = 0
    const timer = setInterval(async () => {
      tries += 1
      try {
        const fresh = await complaintService.getComplaint(complaint.id)
        if (cancelled) return
        const done = fresh.ai && fresh.ai.status !== 'pending' && (fresh.ai.generatedAt !== baseline || fresh.ai.status === 'failed')
        if (done || tries >= POLL_TRIES) {
          setWaiting(false)
          onChanged(fresh)
        }
      } catch {
        if (!cancelled && tries >= POLL_TRIES) setWaiting(false)
      }
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [inProgress, complaint.id, baseline, onChanged])

  const run = async (kind, action, after) => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      const result = await action()
      onChanged(result)
      after?.(result)
    } catch (caught) {
      if (complaintService.isSessionError(caught) && handleAuthError(caught)) return
      setError(complaintService.toComplaintError(caught).message)
    } finally {
      setBusy('')
    }
  }

  const rerun = () =>
    run('analyze', () => complaintService.requestAiAnalysis(complaint.id), () => {
      setBaseline(ai?.generatedAt ?? null)
      setWaiting(true)
    })
  const review = (decision) => run(decision, () => complaintService.reviewAiAnalysis({ complaintId: complaint.id, decision }))
  const applyPriority = () => run('priority', () => complaintService.applyAiPriority(complaint.id))
  const move = () => run('move', () => complaintService.reassignComplaint({ complaintId: complaint.id, categoryId: ai.suggestedCategory.id }), () => setConfirmMove(false))

  const reviewed = ai?.reviewStatus && ai.reviewStatus !== 'pending'
  const canRerun = (ai?.attempts ?? 0) < (ai?.maxAttempts ?? 10)
  const showPriorityAction = status === 'completed' && ai.priority && !ai.matches?.priority
  const showMoveAction = canReassign && status === 'completed' && ai.suggestedCategory && !(ai.matches?.category && ai.matches?.department)

  return (
    <Card className="space-y-5" aria-labelledby="ai-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ai-heading" className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
            AI analysis
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            These are suggestions only. A person decides: nothing changes automatically.
          </p>
        </div>
        {status === 'completed' && (
          <Badge variant={ai.source === 'ai' ? 'success' : 'warning'}>{ai.source === 'ai' ? 'AI-generated' : 'Rule-based fallback'}</Badge>
        )}
      </div>

      {error && <Alert variant="warning">{error}</Alert>}

      {inProgress && (
        <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Analysis in progress… this usually takes a few seconds.
        </p>
      )}

      {!inProgress && (status === 'none' || status === 'unavailable') && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Bot className="h-4 w-4" aria-hidden="true" />
            {status === 'none' ? 'No analysis yet.' : 'The analysis could not be loaded.'}
          </p>
          <Button variant="outline" size="sm" icon={RefreshCw} loading={busy === 'analyze'} onClick={rerun}>
            Run analysis
          </Button>
        </div>
      )}

      {!inProgress && status === 'failed' && (
        <div className="space-y-3">
          <Alert variant="warning">{ai.errorMessage || 'The analysis could not be completed.'}</Alert>
          {canRerun && (
            <Button variant="outline" size="sm" icon={RefreshCw} loading={busy === 'analyze'} onClick={rerun}>
              Try again
            </Button>
          )}
        </div>
      )}

      {status === 'completed' && (
        <>
          {ai.source === 'fallback' && ai.errorMessage && (
            <Alert variant="warning" title="The AI was not used for this complaint">
              {ai.errorMessage} The suggestions below come from simple keyword rules and are less reliable.
            </Alert>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
            <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{ai.summary}</p>
          </div>

          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Suggested category">
              {ai.suggestedCategory ? (
                <span className="inline-flex items-center gap-1.5">
                  {ai.suggestedCategory.name}
                  {ai.matches?.category && <Check className="h-4 w-4 text-emerald-600" aria-label="Same as the current category" />}
                </span>
              ) : (
                <span className="text-slate-400">No suggestion</span>
              )}
            </Field>
            <Field label="Suggested department">
              {ai.suggestedDepartment ? (
                <span className="inline-flex items-center gap-1.5">
                  {ai.suggestedDepartment.name}
                  {ai.matches?.department && <Check className="h-4 w-4 text-emerald-600" aria-label="Same as the current department" />}
                </span>
              ) : (
                <span className="text-slate-400">No suggestion</span>
              )}
            </Field>
            <Field label="Suggested priority">
              <span className="inline-flex items-center gap-2">
                {priorityBadge(ai.priority)}
                <span className="text-xs font-normal text-slate-500">
                  currently {COMPLAINT_PRIORITY[complaint.priority]?.label ?? complaint.priority}
                </span>
              </span>
            </Field>
            <Field label="Tone">{ai.sentiment ? ai.sentiment[0].toUpperCase() + ai.sentiment.slice(1) : '–'}</Field>
            <Field label="Confidence">{typeof ai.confidence === 'number' ? `${Math.round(ai.confidence * 100)}%` : '–'}</Field>
            <Field label="Keywords">
              {ai.keywords.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {ai.keywords.map((word) => (
                    <Badge key={word} variant="neutral">{word}</Badge>
                  ))}
                </span>
              ) : (
                '–'
              )}
            </Field>
          </dl>

          {ai.reason && <p className="text-sm text-slate-600"><span className="font-medium text-slate-800">Why: </span>{ai.reason}</p>}

          <p className="text-xs text-slate-500">
            {ai.source === 'ai' ? `Model: ${ai.model}` : 'Built-in keyword rules'} · {formatDateTime(ai.generatedAt)} · analysed {ai.attempts} time{ai.attempts === 1 ? '' : 's'}
          </p>

          {reviewed && (
            <p className="flex items-center gap-2 text-sm text-slate-700" role="status">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              {ai.reviewStatus === 'accepted' ? 'Reviewed and accepted' : 'Reviewed and dismissed'}
              {ai.reviewedByName ? ` by ${ai.reviewedByName}` : ''} · {formatDateTime(ai.reviewedAt)}
            </p>
          )}

          {confirmMove && ai.suggestedCategory && (
            <Alert variant="warning" title="Move this complaint?">
              <p>It will be moved to {ai.suggestedCategory.name} ({ai.suggestedDepartment?.name}). The student is told it was forwarded, and the current department loses access.</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" loading={busy === 'move'} onClick={move}>Confirm move</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmMove(false)}>Cancel</Button>
              </div>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {showPriorityAction && (
              <Button size="sm" loading={busy === 'priority'} onClick={applyPriority}>
                Use this priority ({COMPLAINT_PRIORITY[ai.priority]?.label})
              </Button>
            )}
            {showMoveAction && (
              <Button size="sm" variant="outline" onClick={() => setConfirmMove(true)}>
                Move to suggested category
              </Button>
            )}
            {!reviewed && (
              <>
                <Button size="sm" variant="outline" icon={Check} loading={busy === 'accepted'} onClick={() => review('accepted')}>
                  Mark as reviewed
                </Button>
                <Button size="sm" variant="outline" icon={X} loading={busy === 'dismissed'} onClick={() => review('dismissed')}>
                  Dismiss
                </Button>
              </>
            )}
            {canRerun && (
              <Button size="sm" variant="outline" icon={RefreshCw} loading={busy === 'analyze'} onClick={rerun}>
                Run analysis again
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
