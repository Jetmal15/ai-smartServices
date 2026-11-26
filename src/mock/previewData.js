/**
 * TEMPORARY STATIC DATA – UI previews only.
 * Not real application data. Replace with services in src/services/ once Appwrite is connected.
 */
import { AlertTriangle, CheckCircle2, Clock, FileText, Building2, Users, Inbox } from 'lucide-react'

export const previewComplaints = [
  { id: 'CMP-1042', title: 'Projector not working in Lab 3', department: 'Software Engineering', priority: 'high', status: 'in_progress', date: '2026-11-18' },
  { id: 'CMP-1041', title: 'Wi-Fi drops in the library block', department: 'Information Technology', priority: 'medium', status: 'submitted', date: '2026-11-17' },
  { id: 'CMP-1038', title: 'Broken chairs in Room 204', department: 'Electronic Engineering', priority: 'low', status: 'resolved', date: '2026-11-14' },
  { id: 'CMP-1035', title: 'Lab equipment request delayed', department: 'Computer Systems Engineering', priority: 'medium', status: 'in_progress', date: '2026-11-12' },
  { id: 'CMP-1029', title: 'Air conditioning fault in seminar hall', department: 'Telecommunication Engineering', priority: 'high', status: 'resolved', date: '2026-11-09' },
  { id: 'CMP-1024', title: 'Duplicate complaint about parking', department: 'Information Technology', priority: 'low', status: 'closed', date: '2026-11-06' },
]

export const previewContent = {
  student: {
    heading: 'Welcome back',
    subheading: 'Track your complaints and see updates from departments.',
    tableTitle: 'My recent complaints',
    stats: [
      { label: 'Total complaints', value: '8', icon: FileText, tone: 'blue' },
      { label: 'Pending', value: '2', icon: Clock, tone: 'amber' },
      { label: 'In progress', value: '3', icon: Inbox, tone: 'blue' },
      { label: 'Resolved', value: '3', icon: CheckCircle2, tone: 'green' },
    ],
  },
  department: {
    heading: 'Department overview',
    subheading: 'Review and resolve complaints assigned to your department.',
    tableTitle: 'Assigned to your department',
    stats: [
      { label: 'Assigned', value: '24', icon: Inbox, tone: 'blue' },
      { label: 'Awaiting action', value: '7', icon: Clock, tone: 'amber' },
      { label: 'Overdue', value: '2', icon: AlertTriangle, tone: 'red' },
      { label: 'Resolved this month', value: '15', icon: CheckCircle2, tone: 'green' },
    ],
  },
  admin: {
    heading: 'System overview',
    subheading: 'Monitor complaints, departments, and users across FET.',
    tableTitle: 'Latest complaints across all departments',
    stats: [
      { label: 'Total complaints', value: '156', icon: FileText, tone: 'blue' },
      { label: 'Open', value: '41', icon: Clock, tone: 'amber' },
      { label: 'Departments', value: '5', icon: Building2, tone: 'blue' },
      { label: 'Registered users', value: '320', icon: Users, tone: 'green' },
    ],
  },
}
