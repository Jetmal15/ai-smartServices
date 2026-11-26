import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Bell, BellRing, Bot, Clock, FileText, GraduationCap, Building2, ShieldCheck, Send } from 'lucide-react'
import { Badge, Button, Card, SectionHeading } from '../components/ui/index.js'
import { PATHS } from '../routes/paths.js'

const features = [
  { icon: FileText, title: 'Simple complaint submission', text: 'Students describe an issue, choose a category, and submit in minutes.' },
  { icon: Bot, title: 'AI-assisted routing', text: 'Complaints are categorized and directed to the most relevant department.' },
  { icon: BellRing, title: 'Department notifications', text: 'The responsible department is alerted as soon as a complaint arrives.' },
  { icon: Clock, title: 'Live status tracking', text: 'Follow every complaint from submission through to resolution.' },
  { icon: BarChart3, title: 'Insights for administrators', text: 'Monitor volumes, response times, and trends across the faculty.' },
  { icon: ShieldCheck, title: 'Role-based access', text: 'Students, staff, and administrators each see only what they need.' },
]

const steps = [
  { icon: Send, title: 'Submit', text: 'A student files a complaint with details and a priority.' },
  { icon: Bell, title: 'Route & notify', text: 'The system assigns it to a department and sends a notification.' },
  { icon: ShieldCheck, title: 'Resolve & track', text: 'Staff act on it while everyone follows progress in real time.' },
]

const roles = [
  { icon: GraduationCap, title: 'Students', points: ['Submit complaints', 'Track progress', 'Receive updates'] },
  { icon: Building2, title: 'Department staff', points: ['Review assigned complaints', 'Update status', 'Respond to students'] },
  { icon: ShieldCheck, title: 'Administrators', points: ['Oversee all departments', 'Manage users', 'View analytics'] },
]

export default function Landing() {
  return (
    <>
      <section className="relative overflow-hidden bg-linear-to-br from-brand-900 via-brand-800 to-brand-600 text-white">
        <div className="container-page grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <Badge className="bg-white/15 text-white">Faculty of Engineering and Technology</Badge>
            <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
              Complaints handled faster, with the right department notified.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-brand-100">
              AI SmartServices gives FET students a clear way to raise issues and gives departments and administrators the
              tools to resolve them.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button as={Link} to={PATHS.register} size="lg" className="bg-white text-brand-700 hover:bg-brand-50">
                Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button as={Link} to={PATHS.login} size="lg" variant="ghost" className="border border-white/30 text-white hover:bg-white/10">
                Log in
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md" aria-hidden="true">
            <div className="rounded-2xl bg-white p-5 text-slate-900 shadow-xl">
              <p className="text-sm font-semibold">Complaint status</p>
              <ul className="mt-4 space-y-3 text-sm">
                {[
                  ['Projector not working in Lab 3', 'In Progress', 'info'],
                  ['Wi-Fi drops in library block', 'Pending', 'warning'],
                  ['Broken chairs in Room 204', 'Resolved', 'success'],
                ].map(([title, status, variant]) => (
                  <li key={title} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
                    <span className="truncate">{title}</span>
                    <Badge variant={variant} dot>
                      {status}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-slate-400">Illustrative preview</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-20">
        <SectionHeading eyebrow="Features" title="Everything needed to manage complaints" description="One system for submitting, routing, resolving, and monitoring complaints across the faculty." />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="transition hover:shadow-md">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white py-20">
        <div className="container-page">
          <SectionHeading eyebrow="How it works" title="From complaint to resolution in three steps" />
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="mt-4 text-sm font-semibold text-brand-600">Step {index + 1}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mx-auto mt-1.5 max-w-xs text-sm text-slate-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-page py-20">
        <SectionHeading eyebrow="Built for everyone" title="A tailored workspace for each role" />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {roles.map(({ icon: Icon, title, points }) => (
            <Card key={title}>
              <Icon className="h-8 w-8 text-brand-600" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                {points.map((point) => (
                  <li key={point} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </section>

      <section className="container-page pb-20">
        <div className="rounded-2xl bg-brand-600 px-6 py-12 text-center text-white sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">Ready to raise your first complaint?</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">Create a student account and start tracking issues today.</p>
          <Button as={Link} to={PATHS.register} size="lg" className="mt-6 bg-white text-brand-700 hover:bg-brand-50">
            Create student account
          </Button>
        </div>
      </section>
    </>
  )
}
