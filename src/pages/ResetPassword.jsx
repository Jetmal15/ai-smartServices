import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorMessage, PasswordInput } from '../components/ui/index.js'
import { PATHS } from '../routes/paths.js'
import { completePasswordReset, toAuthError } from '../services/authService.js'
import { getPasswordError } from '../utils/validators.js'

/** Landing page for the link in the recovery email (?userId=…&secret=…). */
export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const userId = params.get('userId')
  const secret = params.get('secret')
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
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
    const passwordError = getPasswordError(values.password)
    if (passwordError) next.password = passwordError
    if (values.confirmPassword !== values.password) next.confirmPassword = 'Passwords do not match.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await completePasswordReset({ userId, secret, password: values.password })
      navigate(PATHS.login, { replace: true, state: { notice: 'Password updated. Log in with your new password.' } })
    } catch (err) {
      setFormError(toAuthError(err).message)
      setSubmitting(false)
    }
  }

  if (!userId || !secret) {
    return (
      <div>
        <ErrorMessage title="Invalid reset link" message="This link is incomplete or has expired. Request a new one." />
        <p className="mt-6 text-center text-sm">
          <Link to={PATHS.forgotPassword} className="font-medium text-brand-600 hover:text-brand-700">
            Request a new link
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Choose a new password</h1>
      <p className="mt-1 text-sm text-slate-600">Enter and confirm your new password.</p>
      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        {formError && <ErrorMessage title="Could not reset password" message={formError} />}
        <PasswordInput label="New password" name="password" autoComplete="new-password" placeholder="At least 8 characters" value={values.password} onChange={handleChange} error={errors.password} required />
        <PasswordInput label="Confirm new password" name="confirmPassword" autoComplete="new-password" placeholder="Re-enter your new password" value={values.confirmPassword} onChange={handleChange} error={errors.confirmPassword} required />
        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          {submitting ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </div>
  )
}
