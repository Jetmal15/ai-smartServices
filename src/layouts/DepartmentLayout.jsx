import { dashboardConfigs } from '../lib/navigation.js'
import DashboardLayout from './DashboardLayout.jsx'

export default function DepartmentLayout() {
  return <DashboardLayout config={dashboardConfigs.department} />
}
