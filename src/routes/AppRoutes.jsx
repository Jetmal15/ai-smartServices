import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AdminLayout from '../layouts/AdminLayout.jsx'
import AuthLayout from '../layouts/AuthLayout.jsx'
import DepartmentLayout from '../layouts/DepartmentLayout.jsx'
import PublicLayout from '../layouts/PublicLayout.jsx'
import StudentLayout from '../layouts/StudentLayout.jsx'
import { ROLES } from '../lib/constants.js'
import About from '../pages/About.jsx'
import Contact from '../pages/Contact.jsx'
import DashboardPreview from '../pages/dashboard/DashboardPreview.jsx'
import SectionPlaceholder from '../pages/dashboard/SectionPlaceholder.jsx'
import NotificationDetailPage from '../pages/notifications/NotificationDetailPage.jsx'
import NotificationsPage from '../pages/notifications/NotificationsPage.jsx'
import ComplaintDetailPage from '../pages/complaints/ComplaintDetailPage.jsx'
import DepartmentComplaintsPage from '../pages/department/DepartmentComplaintsPage.jsx'
import DepartmentDashboardPage from '../pages/department/DepartmentDashboardPage.jsx'
import MyComplaintsPage from '../pages/student/MyComplaintsPage.jsx'
import SubmitComplaintPage from '../pages/student/SubmitComplaintPage.jsx'
import DesignSystem from '../pages/DesignSystem.jsx'
import ForgotPassword from '../pages/ForgotPassword.jsx'
import Landing from '../pages/Landing.jsx'
import Login from '../pages/Login.jsx'
import NotFound from '../pages/NotFound.jsx'
import AdminCategoriesPage from '../pages/admin/AdminCategoriesPage.jsx'
import AdminComplaintsPage from '../pages/admin/AdminComplaintsPage.jsx'
import AdminDashboardPage from '../pages/admin/AdminDashboardPage.jsx'
import AdminDepartmentsPage from '../pages/admin/AdminDepartmentsPage.jsx'
import AdminReportsPage from '../pages/admin/AdminReportsPage.jsx'
import UsersPage from '../pages/admin/UsersPage.jsx'
import ProfilePage from '../pages/profile/ProfilePage.jsx'
import Register from '../pages/Register.jsx'
import ResetPassword from '../pages/ResetPassword.jsx'
import { PATHS } from './paths.js'
import ProtectedRoute from './ProtectedRoute.jsx'
import PublicRoute from './PublicRoute.jsx'
import RoleRedirect from './RoleRedirect.jsx'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function AppRoutes() {
  const { student, department, admin } = PATHS

  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Role-aware shortcuts: each signed-in user is sent to THEIR dashboard / profile */}
        <Route path={PATHS.dashboard} element={<RoleRedirect to="dashboard" />} />
        <Route path={PATHS.profile} element={<RoleRedirect to="profile" />} />

        {/* Public pages */}
        <Route element={<PublicRoute />}>
          <Route element={<PublicLayout />}>
            <Route path={PATHS.home} element={<Landing />} />
            <Route path={PATHS.about} element={<About />} />
            <Route path={PATHS.contact} element={<Contact />} />
            <Route path={PATHS.designSystem} element={<DesignSystem />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>

        {/* Guest-only pages: signed-in users are redirected away */}
        <Route element={<PublicRoute restricted />}>
          <Route element={<AuthLayout />}>
            <Route path={PATHS.login} element={<Login />} />
            <Route path={PATHS.register} element={<Register />} />
            <Route path={PATHS.forgotPassword} element={<ForgotPassword />} />
          </Route>
        </Route>

        {/* Reset page is reached from an email link, so it stays reachable even if a session exists */}
        <Route element={<PublicRoute />}>
          <Route element={<AuthLayout />}>
            <Route path={PATHS.resetPassword} element={<ResetPassword />} />
          </Route>
        </Route>

        {/* Student */}
        <Route element={<ProtectedRoute allowedRoles={[ROLES.STUDENT]} />}>
          <Route path={student.base} element={<Navigate to={student.dashboard} replace />} />
          <Route element={<StudentLayout />}>
            <Route path={student.dashboard} element={<DashboardPreview role={ROLES.STUDENT} />} />
            <Route path={student.submitComplaint} element={<SubmitComplaintPage />} />
            <Route path={student.complaints} element={<MyComplaintsPage />} />
            <Route path={student.complaintDetails} element={<ComplaintDetailPage backTo={student.complaints} backLabel="Back to my complaints" />} />
            <Route path={student.notifications} element={<NotificationsPage />} />
            <Route path={student.notificationDetails} element={<NotificationDetailPage />} />
            <Route path={student.profile} element={<ProfilePage />} />
          </Route>
        </Route>

        {/* Department staff */}
        <Route element={<ProtectedRoute allowedRoles={[ROLES.DEPARTMENT]} />}>
          <Route path={department.base} element={<Navigate to={department.dashboard} replace />} />
          <Route element={<DepartmentLayout />}>
            <Route path={department.dashboard} element={<DepartmentDashboardPage />} />
            <Route path={department.complaints} element={<DepartmentComplaintsPage />} />
            <Route path={department.complaintDetails} element={<ComplaintDetailPage backTo={department.complaints} backLabel="Back to complaints" showStudent canManage />} />
            <Route path={department.notifications} element={<NotificationsPage />} />
            <Route path={department.notificationDetails} element={<NotificationDetailPage />} />
            <Route path={department.profile} element={<ProfilePage />} />
          </Route>
        </Route>

        {/* Administrator */}
        <Route element={<ProtectedRoute allowedRoles={[ROLES.ADMIN]} />}>
          <Route path={admin.base} element={<Navigate to={admin.dashboard} replace />} />
          <Route element={<AdminLayout />}>
            <Route path={admin.dashboard} element={<AdminDashboardPage />} />
            <Route path={admin.users} element={<UsersPage />} />
            <Route path={admin.departments} element={<AdminDepartmentsPage />} />
            <Route path={admin.categories} element={<AdminCategoriesPage />} />
            <Route path={admin.reports} element={<AdminReportsPage />} />
            <Route path={admin.complaints} element={<AdminComplaintsPage />} />
            <Route path={admin.complaintDetails} element={<ComplaintDetailPage backTo={admin.complaints} backLabel="Back to complaints" showStudent canReassign />} />
            <Route path={admin.notifications} element={<NotificationsPage canAnnounce />} />
            <Route path={admin.notificationDetails} element={<NotificationDetailPage />} />
            <Route path={admin.settings} element={<SectionPlaceholder title="Settings" />} />
            <Route path={admin.profile} element={<ProfilePage />} />
          </Route>
        </Route>
      </Routes>
    </>
  )
}
