import { useState } from 'react'
import { Clock, Mail, MapPin, Send } from 'lucide-react'
import { Alert, Button, Card, Input, Select, Textarea } from '../components/ui/index.js'
import { isValidEmail } from '../utils/validators.js'

const subjects = ['General inquiry', 'Technical support', 'Account help', 'Feedback']
const initialValues = { name: '', email: '', subject: '', message: '' }

const info = [
  { icon: MapPin, label: 'Address', value: 'Faculty of Engineering and Technology, University Campus' },
  { icon: Mail, label: 'Email', value: 'support@smartservices.example' },
  { icon: Clock, label: 'Office hours', value: 'Monday – Friday, 9:00 AM – 4:00 PM' },
]

export default function Contact() {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [sent, setSent] = useState(false)

  const handleChange = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const next = {}
    if (!values.name.trim()) next.name = 'Please enter your name.'
    if (!isValidEmail(values.email)) next.email = 'Enter a valid email address.'
    if (!values.subject) next.subject = 'Please choose a subject.'
    if (values.message.trim().length < 10) next.message = 'Message must be at least 10 characters.'
    setErrors(next)
    setSent(false)
    if (Object.keys(next).length === 0) {
      setSent(true)
      setValues(initialValues)
    }
  }

  return (
    <>
      <section className="border-b border-slate-200 bg-white py-16">
        <div className="container-page">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Contact us</h1>
          <p className="mt-3 max-w-2xl text-lg text-slate-600">Have a question or need help with your account? Send us a message.</p>
        </div>
      </section>

      <section className="container-page grid gap-8 py-12 lg:grid-cols-3">
        <Card title="Send a message" className="lg:col-span-2">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {sent && (
              <Alert variant="success" title="Message ready">
                The form works as a UI preview. Messages will be delivered once the backend is connected.
              </Alert>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Input label="Full name" name="name" value={values.name} onChange={handleChange} error={errors.name} placeholder="Your name" required />
              <Input label="Email" name="email" type="email" value={values.email} onChange={handleChange} error={errors.email} placeholder="you@example.com" required />
            </div>
            <Select label="Subject" name="subject" value={values.subject} onChange={handleChange} error={errors.subject} options={subjects} placeholder="Select a subject" required />
            <Textarea label="Message" name="message" rows={6} value={values.message} onChange={handleChange} error={errors.message} placeholder="How can we help?" required />
            <Button type="submit" icon={Send}>
              Send message
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          {info.map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </>
  )
}
