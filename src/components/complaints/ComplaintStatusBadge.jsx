import { Badge } from '../ui/index.js'
import { COMPLAINT_STATUS } from '../../lib/constants.js'

export default function ComplaintStatusBadge({ status }) {
  const known = COMPLAINT_STATUS[status]
  return (
    <Badge variant={known?.variant ?? 'neutral'} dot>
      {known?.label ?? status}
    </Badge>
  )
}
