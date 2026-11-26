import { Eye, Target, Users } from 'lucide-react'
import { Card, SectionHeading } from '../components/ui/index.js'
import { FET_DEPARTMENTS } from '../lib/constants.js'

const values = [
  { icon: Target, title: 'Our mission', text: 'Give every student a clear, accountable path to get campus issues resolved quickly and fairly.' },
  { icon: Eye, title: 'Transparency', text: 'Complaint status is visible from submission to resolution, so nothing disappears into a void.' },
  { icon: Users, title: 'Collaboration', text: 'Students, department staff, and administrators work from one shared system.' },
]

export default function About() {
  return (
    <>
      <section className="border-b border-slate-200 bg-white py-16 sm:py-20">
        <div className="container-page">
          <SectionHeading
            as="h1"
            align="left"
            eyebrow="About"
            title="About AI SmartServices"
            description="An AI-based complaint management and department notification system for the Faculty of Engineering and Technology (FET)."
          />
        </div>
      </section>

      <section className="container-page py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {values.map(({ icon: Icon, title, text }) => (
            <Card key={title}>
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="container-page pb-20">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Why this system exists</h2>
            <p className="mt-4 text-slate-600">
              Complaints about labs, facilities, services, and academics are often handled through scattered channels, which
              makes them hard to track and easy to miss. AI SmartServices brings them into one place.
            </p>
            <p className="mt-4 text-slate-600">
              Complaints are categorized and sent to the responsible department, which is notified immediately.
              Administrators get a faculty-wide view to spot recurring problems and keep response times in check.
            </p>
          </div>

          <Card title="Departments covered" description="Complaints can be routed to any FET department.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {FET_DEPARTMENTS.map((department) => (
                <li key={department} className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                  {department}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>
    </>
  )
}
