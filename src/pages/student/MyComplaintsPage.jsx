import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, PlusCircle, Search, SearchX, X } from 'lucide-react'
import ComplaintList from '../../components/complaints/ComplaintList.jsx'
import Pager from '../../components/complaints/Pager.jsx'
import { Button, Card, EmptyState, ErrorMessage, LoadingSpinner, Select } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { COMPLAINT_RULES } from '../../../database/schema.js'
import { COMPLAINT_STATUS } from '../../lib/constants.js'
import { controlClasses } from '../../lib/styles.js'
import { PATHS } from '../../routes/paths.js'
import * as complaintService from '../../services/complaintService.js'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 350
const NO_FILTERS = { search: '', status: '', categoryId: '', sort: 'newest' }
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

/**
 * The student's complaint history. Everything (search, filters, sort, paging) is requested from complaint-api, which only ever
 * looks at the signed-in student's own complaints.
 */
export default function MyComplaintsPage() {
  const [searchText, setSearchText] = useState('') // what is typed
  const [filters, setFilters] = useState(NO_FILTERS) // what is applied (search is applied after a short pause)
  const [page, setPage] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.search === searchText.trim() ? prev : { ...prev, search: searchText.trim() }))
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  const list = useAsyncData(
    () => complaintService.listMyComplaints({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    JSON.stringify([filters, page]),
    complaintService.isSessionError,
  )

  const facets = (list.data ?? list.previous)?.filters
  const statusOptions = [
    { value: '', label: `All statuses${facets ? ` (${facets.overallTotal})` : ''}` },
    ...Object.entries(COMPLAINT_STATUS).map(([value, { label }]) => ({ value, label: `${label}${facets ? ` (${facets.statusCounts[value] ?? 0})` : ''}` })),
  ]
  const categoryOptions = [{ value: '', label: 'All categories' }, ...(facets?.categories ?? []).map((category) => ({ value: category.id, label: category.name }))]
  const filtering = Boolean(filters.search || filters.status || filters.categoryId)

  const setFilter = (name) => (event) => {
    setFilters((prev) => ({ ...prev, [name]: event.target.value }))
    setPage(0)
  }
  const clearAll = () => {
    setSearchText('')
    setFilters(NO_FILTERS)
    setPage(0)
  }

  const data = list.data
  const first = data && data.total > 0 ? page * PAGE_SIZE + 1 : 0
  const last = data ? Math.min((page + 1) * PAGE_SIZE, data.total) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My complaints</h1>
          <p className="mt-1 text-sm text-slate-500">Track everything you have submitted.</p>
        </div>
        <Button as={Link} to={PATHS.student.submitComplaint} icon={PlusCircle}>
          Submit a complaint
        </Button>
      </div>

      <Card padded={false}>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              maxLength={COMPLAINT_RULES.search.max}
              placeholder="Search by complaint ID, title, category, department or details"
              aria-label="Search complaints"
              className={`${controlClasses(false)} pl-9`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select aria-label="Filter by status" value={filters.status} onChange={setFilter('status')} options={statusOptions} />
            <Select aria-label="Filter by category" value={filters.categoryId} onChange={setFilter('categoryId')} options={categoryOptions} />
            <Select aria-label="Sort by date" value={filters.sort} onChange={setFilter('sort')} options={SORT_OPTIONS} />
          </div>
          {filtering && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">{data ? `${data.total} matching complaint${data.total === 1 ? '' : 's'}` : 'Searching…'}</span>
              <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 font-medium text-brand-600 hover:text-brand-700">
                <X className="h-4 w-4" aria-hidden="true" />
                Clear filters
              </button>
            </div>
          )}
        </div>

        {list.status === 'loading' && <LoadingSpinner center label="Loading your complaints…" />}
        {list.status === 'error' && (
          <div className="p-5">
            <ErrorMessage title="Could not load your complaints" message={list.error} onRetry={list.reload} />
          </div>
        )}
        {data && data.filters.overallTotal === 0 && (
          <EmptyState
            icon={FileText}
            title="You have not submitted any complaints"
            description="When you submit a complaint it will appear here, and you can follow its progress."
            action={<Button as={Link} to={PATHS.student.submitComplaint}>Submit your first complaint</Button>}
          />
        )}
        {data && data.filters.overallTotal > 0 && data.total === 0 && (
          <EmptyState
            icon={SearchX}
            title="No complaints match"
            description="Try different words, or remove a filter."
            action={<Button variant="outline" onClick={clearAll}>Clear filters</Button>}
          />
        )}
        {data && data.total > 0 && (
          <>
            <ComplaintList complaints={data.complaints} basePath={PATHS.student.complaints} />
            <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
              Showing {first}–{last} of {data.total}
            </p>
            <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  )
}
