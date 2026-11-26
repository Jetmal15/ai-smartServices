import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { Badge, Card, EmptyState } from '../../components/ui/index.js'

/** Placeholder for pages built in later phases. Shows the :id param on detail routes. */
export default function SectionPlaceholder({ title, backTo, backLabel }) {
  const { id } = useParams()

  return (
    <div className="space-y-6">
      <div>
        {backTo && (
          <Link to={backTo} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {backLabel}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {id && <Badge variant="info">ID: {id}</Badge>}
        </div>
      </div>
      <Card padded={false}>
        <EmptyState icon={Wrench} title="Coming soon" description={`The ${title} page will be built in an upcoming phase.`} />
      </Card>
    </div>
  )
}
