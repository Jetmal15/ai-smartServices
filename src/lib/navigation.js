import {
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  FileText,
  Inbox,
  LayoutDashboard,
  PlusCircle,
  Settings,
  Tags,
  User,
  Users,
} from 'lucide-react'
import { PATHS } from '../routes/paths.js'

export const publicLinks = [
  { to: PATHS.home, label: 'Home', end: true },
  { to: PATHS.about, label: 'About' },
  { to: PATHS.contact, label: 'Contact' },
]

/** Sidebar configuration for each dashboard role (keys match ROLES values). */
export const dashboardConfigs = {
  student: {
    role: 'Student',
    title: 'Student Portal',
    nav: [
      { to: PATHS.student.dashboard, label: 'Dashboard', icon: LayoutDashboard },
      { to: PATHS.student.submitComplaint, label: 'Submit Complaint', icon: PlusCircle },
      { to: PATHS.student.complaints, label: 'My Complaints', icon: FileText },
      { to: PATHS.student.notifications, label: 'Notifications', icon: Bell },
      { to: PATHS.student.profile, label: 'Profile', icon: User },
    ],
  },
  department: {
    role: 'Department Staff',
    title: 'Department Portal',
    nav: [
      { to: PATHS.department.dashboard, label: 'Dashboard', icon: LayoutDashboard },
      { to: PATHS.department.complaints, label: 'Complaints', icon: Inbox },
      { to: PATHS.department.notifications, label: 'Notifications', icon: Bell },
      { to: PATHS.department.profile, label: 'Profile', icon: User },
    ],
  },
  admin: {
    role: 'Administrator',
    title: 'Admin Console',
    nav: [
      { to: PATHS.admin.dashboard, label: 'Dashboard', icon: LayoutDashboard },
      { to: PATHS.admin.users, label: 'Users', icon: Users },
      { to: PATHS.admin.departments, label: 'Departments', icon: Building2 },
      { to: PATHS.admin.categories, label: 'Categories', icon: Tags },
      { to: PATHS.admin.complaints, label: 'Complaints', icon: ClipboardList },
      { to: PATHS.admin.reports, label: 'Reports', icon: BarChart3 },
      { to: PATHS.admin.notifications, label: 'Notifications', icon: Bell },
      { to: PATHS.admin.settings, label: 'Settings', icon: Settings },
      { to: PATHS.admin.profile, label: 'Profile', icon: User },
    ],
  },
}
