import { COMPLAINT_STATUS } from './constants.js'

/** The normal path of a complaint, in order. */
export const STATUS_FLOW = ['submitted', 'under_review', 'in_progress', 'resolved', 'closed']

/** Allowed status moves. KEEP IN SYNC with TRANSITIONS in functions/complaint-api/src/handler.js (a test checks this). */
export const TRANSITIONS = {
  submitted: ['under_review', 'in_progress', 'closed'],
  under_review: ['in_progress', 'resolved', 'closed'],
  in_progress: ['under_review', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: [],
}

/**
 * The progress tracker: one step per status with its state relative to the complaint's current status.
 *   done     – earlier in the flow (a skipped step is still "done", just without a date)
 *   current  – where the complaint is now
 *   upcoming – not reached (also after a re-open)
 * `at` is when the complaint most recently entered that status (from the history), or null.
 */
export function buildProgress(status, history = []) {
  const currentIndex = Math.max(STATUS_FLOW.indexOf(status), 0)
  return STATUS_FLOW.map((step, index) => {
    // Remark-only entries do not change the status, so they never move the date a step was reached.
    const entry = [...history].reverse().find((item) => item.status === step && item.type !== 'remark')
    return {
      status: step,
      label: COMPLAINT_STATUS[step].label,
      state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
      at: entry?.at ?? null,
    }
  })
}

/** Short text for the timeline: "Submitted", or "Under Review (from Submitted)". */
export const describeChange = (entry) =>
  entry.type === 'remark'
    ? 'Remark added'
    : entry.previousStatus
    ? `${COMPLAINT_STATUS[entry.status]?.label ?? entry.status} (from ${COMPLAINT_STATUS[entry.previousStatus]?.label ?? entry.previousStatus})`
    : (COMPLAINT_STATUS[entry.status]?.label ?? entry.status)
