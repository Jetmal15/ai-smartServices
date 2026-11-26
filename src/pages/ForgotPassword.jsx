import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { Alert, Button, ErrorMessage, Input } from '../components/ui/index.js'
import { PATHS } from '../routes/paths.js'
import { requestPasswordReset, toAuthError } from '../services/authService.js'
import { isValidEmail } from '../utils/validators.js'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.')
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setFormError(toAuthError(err).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-600">Enter your account email and we will send you a reset link.</p>

      {sent ? (
        <Alert variant="success" title="Check your email" className="mt-8">
          If an account exists for {email.trim()}, a reset link is on its way. It is valid for 1 hour.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
          {formError && <ErrorMessage title="Could not send the email" message={formError} />}
          <Input
            label="Email"
            name="email"
            type="email"
            icon={Mail}
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
              setFormError('')
            }}
            error={error}
            required
          />
          <Button type="submit" className="w-full" size="lg" loading={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-slate-600">
        <Link to={PATHS.login} className="font-medium text-brand-600 hover:text-brand-700">
          Back to log in
        </Link>
      </p>
    </div>
  )
}
