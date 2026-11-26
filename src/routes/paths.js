import { ROLES } from '../lib/constants.js'

/** Single source of truth for every route path in the app. */
export const PATHS = {
  home: '/',
  about: '/about',
  contact: '/contact',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  designSystem: '/design-system',
  /** Role-aware shortcuts: send each signed-in user to THEIR dashboard / profile. */
  dashboard: '/dashboard',
  profile: '/profile',

  student: {
    base: '/student',
    dashboard: '/student/dashboard',
    submitComplaint: '/student/submit-complaint',
    complaints: '/student/complaints',
    complaintDetails: '/student/complaints/:id',
    notifications: '/student/notifications',
    notificationDetails: '/student/notifications/:id',
    profile: '/student/profile',
  },

  department: {
    base: '/department',
    dashboard: '/department/dashboard',
    complaints: '/department/complaints',
    complaintDetails: '/department/complaints/:id',
    notifications: '/department/notifications',
    notificationDetails: '/department/notifications/:id',
    profile: '/department/profile',
  },

  admin: {
    base: '/admin',
    dashboard: '/admin/dashboard',
    users: '/admin/users',
    profile: '/admin/profile',
    departments: '/admin/departments',
    categories: '/admin/categories',
    complaints: '/admin/complaints',
    reports: '/admin/reports',
    complaintDetails: '/admin/complaints/:id',
    notifications: '/admin/notifications',
    notificationDetails: '/admin/notifications/:id',
    settings: '/admin/settings',
  },
}

/** Where each role lands after signing in. */
export const ROLE_HOME = {
  [ROLES.STUDENT]: PATHS.student.dashboard,
  [ROLES.DEPARTMENT]: PATHS.department.dashboard,
  [ROLES.ADMIN]: PATHS.admin.dashboard,
}
