import { dashboardConfigs } from '../lib/navigation.js'
import DashboardLayout from './DashboardLayout.jsx'

export default function AdminLayout() {
  return <DashboardLayout config={dashboardConfigs.admin} />
}
