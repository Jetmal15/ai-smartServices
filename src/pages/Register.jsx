import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Hash, Mail, User } from 'lucide-react'
import { Button, ErrorMessage, Input, PasswordInput, Select } from '../components/ui/index.js'
import { useAuth } from '../hooks/useAuth.js'
import { FET_DEPARTMENTS } from '../lib/constants.js'
import { PATHS } from '../routes/paths.js'
import { toAuthError } from '../services/authService.js'
import { validateRegistration } from '../utils/validators.js'

const initialValues = { fullName: '', rollNumber: '', email: '', department: '', password: '', confirmPassword: '' }

export default function Register() {
  const { register } = useAuth()
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined }))
    setFormError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const next = validateRegistration(values, FET_DEPARTMENTS)
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    setFormError('')
    try {
      // On success the new student is signed in and PublicRoute redirects to the dashboard.
      await register(values)
    } catch (error) {
      const authError = toAuthError(error)
      // Show "email already exists" next to the email field; everything else at the top.
      if (authError.type === 'user_already_exists') setErrors({ email: authError.message })
      else setFormError(authError.message)
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Create student account</h1>
      <p className="mt-1 text-sm text-slate-600">Register with your university details to submit complaints.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {formError && <ErrorMessage title="Could not create your account" message={formError} />}
        <Input label="Full name" name="fullName" icon={User} autoComplete="name" placeholder="Your full name" value={values.fullName} onChange={handleChange} error={errors.fullName} required />
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="Roll number" name="rollNumber" icon={Hash} placeholder="e.g. 22SW001" value={values.rollNumber} onChange={handleChange} error={errors.rollNumber} required />
          <Select label="Department" name="department" options={FET_DEPARTMENTS} placeholder="Select department" value={values.department} onChange={handleChange} error={errors.department} required />
        </div>
        <Input label="Email" name="email" type="email" icon={Mail} autoComplete="email" placeholder="you@example.com" value={values.email} onChange={handleChange} error={errors.email} required />
        <PasswordInput label="Password" name="password" autoComplete="new-password" placeholder="At least 8 characters" value={values.password} onChange={handleChange} error={errors.password} required />
        <PasswordInput label="Confirm password" name="confirmPassword" autoComplete="new-password" placeholder="Re-enter your password" value={values.confirmPassword} onChange={handleChange} error={errors.confirmPassword} required />
        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        Already registered?{' '}
        <Link to={PATHS.login} className="font-medium text-brand-600 hover:text-brand-700">
          Log in
        </Link>
      </p>
    </div>
  )
}
