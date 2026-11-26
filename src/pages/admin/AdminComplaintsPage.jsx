import { useEffect, useState } from 'react'
import { Inbox, Search, SearchX, X } from 'lucide-react'
import ComplaintList from '../../components/complaints/ComplaintList.jsx'
import Pager from '../../components/complaints/Pager.jsx'
import { Alert, Button, Card, EmptyState, ErrorMessage, LoadingSpinner, Select } from '../../components/ui/index.js'
import { useAsyncData } from '../../hooks/useAsyncData.js'
import { COMPLAINT_RULES } from '../../../database/schema.js'
import { COMPLAINT_STATUS } from '../../lib/constants.js'
import { controlClasses } from '../../lib/styles.js'
import { PATHS } from '../../routes/paths.js'
import * as adminService from '../../services/adminService.js'
// import * as complaintService from '../../services/complaintService.js'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 350
const NO_FILTERS = { search: '', status: '', categoryId: '', departmentId: '', sort: 'newest' }
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...Object.entries(COMPLAINT_STATUS).map(([value, { label }]) => ({ value, label }))]
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

/** Administrators: every complaint with search, filters and sorting. The server does the work and only answers administrators. */
export default function AdminComplaintsPage() {
  const [searchText, setSearchText] = useState('')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [page, setPage] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.search === searchText.trim() ? prev : { ...prev, search: searchText.trim() }))
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  const options = useAsyncData(async () => ({ categories: await adminService.listCategories(), departments: await adminService.listDepartments() }), 'options', adminService.isSessionError)
  // const list = useAsyncData(() => complaintService.adminListComplaints({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }), JSON.stringify([filters, page]), complaintService.isSessionError)
  const list = useAsyncData(() => adminService.listAdminComplaints({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }), JSON.stringify([filters, page]), adminService.isSessionError)

  const lists = options.data ?? options.previous
  const categoryOptions = [{ value: '', label: 'All categories' }, ...(lists?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]
  const departmentOptions = [{ value: '', label: 'All departments' }, ...(lists?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]
  const filtering = Boolean(filters.search || filters.status || filters.categoryId || filters.departmentId)
  const data = list.data
  const first = data && data.total > 0 ? page * PAGE_SIZE + 1 : 0
  const last = data ? Math.min((page + 1) * PAGE_SIZE, data.total) : 0

  const setFilter = (name) => (event) => {
    setFilters((prev) => ({ ...prev, [name]: event.target.value }))
    setPage(0)
  }
  const clearAll = () => {
    setSearchText('')
    setFilters(NO_FILTERS)
    setPage(0)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Complaints</h1>
        <p className="mt-1 text-sm text-slate-500">Every complaint in the system. Open one to monitor its progress, review its AI analysis, or move it to another category and department.</p>
      </div>

      <Card padded={false}>
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} maxLength={COMPLAINT_RULES.search.max} placeholder="Search by complaint ID, title, student, roll number, category or details" aria-label="Search complaints" className={`${controlClasses(false)} pl-9`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select aria-label="Filter by status" value={filters.status} onChange={setFilter('status')} options={STATUS_OPTIONS} />
            <Select aria-label="Filter by department" value={filters.departmentId} onChange={setFilter('departmentId')} options={departmentOptions} />
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

        {list.status === 'loading' && <LoadingSpinner center label="Loading complaints…" />}
        {list.status === 'error' && <div className="p-5"><ErrorMessage title="Could not load complaints" message={list.error} onRetry={list.reload} /></div>}
        {data && data.total === 0 && !filtering && <EmptyState icon={Inbox} title="No complaints yet" description="Complaints appear here as soon as students submit them." />}
        {data && data.total === 0 && filtering && <EmptyState icon={SearchX} title="No complaints match" description="Try different words, or remove a filter." action={<Button variant="outline" onClick={clearAll}>Clear filters</Button>} />}
        {data && data.total > 0 && (
          <>
            <ComplaintList complaints={data.complaints} basePath={PATHS.admin.complaints} showStudent showPriority />
            <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">Showing {first}–{last} of {data.total}</p>
            <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
      {data?.sampled && <Alert variant="warning" title="Showing the newest matches only">Search looks through the newest 2,000 matching complaints. Narrow the filters to find older ones.</Alert>}
    </div>
  )
}
