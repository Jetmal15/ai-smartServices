import { dashboardConfigs } from '../lib/navigation.js'
import DashboardLayout from './DashboardLayout.jsx'

export default function StudentLayout() {
  return <DashboardLayout config={dashboardConfigs.student} />
}
