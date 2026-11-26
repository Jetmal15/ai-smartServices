import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Alert, Button, ErrorMessage, Input, PasswordInput } from '../components/ui/index.js'
import { useAuth } from '../hooks/useAuth.js'
import { PATHS } from '../routes/paths.js'
import { toAuthError } from '../services/authService.js'
import { isValidEmail } from '../utils/validators.js'

export default function Login() {
  const { login, sessionExpired } = useAuth()
  const location = useLocation()
  const notice = location.state?.notice
  const [values, setValues] = useState({ email: '', password: '' })
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
    const next = {}
    if (!isValidEmail(values.email)) next.email = 'Enter a valid email address.'
    if (!values.password) next.password = 'Password is required.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    setFormError('')
    try {
      // On success AuthProvider updates and PublicRoute redirects to the right dashboard.
      await login(values)
    } catch (error) {
      setFormError(toAuthError(error).message)
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-600">Log in to manage your complaints.</p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {sessionExpired && <Alert title="Your session has expired">Please log in again to continue.</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}
        {formError && <ErrorMessage title="Could not log in" message={formError} />}
        <Input label="Email" name="email" type="email" icon={Mail} autoComplete="email" placeholder="you@example.com" value={values.email} onChange={handleChange} error={errors.email} required />
        <PasswordInput label="Password" name="password" autoComplete="current-password" placeholder="Enter your password" value={values.password} onChange={handleChange} error={errors.password} required />
        <div className="text-right text-sm">
          <Link to={PATHS.forgotPassword} className="font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-600">
        New student?{' '}
        <Link to={PATHS.register} className="font-medium text-brand-600 hover:text-brand-700">
          Create an account
        </Link>
      </p>
    </div>
  )
}
