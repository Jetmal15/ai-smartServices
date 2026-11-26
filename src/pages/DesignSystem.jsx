import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorMessage, Input, LoadingSpinner, Modal, PasswordInput, Select, Textarea,
} from '../components/ui/index.js'

const swatches = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900']
const swatchColors = ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a']

function Section({ title, children }) {
  return (
    <Card title={title}>
      <div className="space-y-4">{children}</div>
    </Card>
  )
}

export default function DesignSystem() {
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="container-page space-y-6 py-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Design system</h1>
        <p className="mt-2 text-slate-600">Reusable components used across AI SmartServices.</p>
      </div>

      <Section title="Brand colors">
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
          {swatches.map((shade, index) => (
            <div key={shade} className="text-center text-xs text-slate-500">
              <div className="h-12 rounded-lg border border-slate-200" style={{ backgroundColor: swatchColors[index] }} />
              <p className="mt-1">{shade}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button icon={Plus}>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="info" dot>Info</Badge>
          <Badge variant="success" dot>Success</Badge>
          <Badge variant="warning" dot>Warning</Badge>
          <Badge variant="danger" dot>Danger</Badge>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-5 md:grid-cols-2">
          <Input label="Text input" placeholder="Type here" hint="Helper text appears here." />
          <Input label="With error" defaultValue="invalid" error="This field has an error." />
          <Select label="Select" options={['Option one', 'Option two']} placeholder="Choose an option" defaultValue="" />
          <PasswordInput label="Password" placeholder="Password" />
          <div className="md:col-span-2">
            <Textarea label="Textarea" placeholder="Write a longer message…" />
          </div>
        </div>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Feedback">
          <Alert title="Information">This is an informational alert.</Alert>
          <Alert variant="success" title="Success">Your changes have been saved.</Alert>
          <ErrorMessage message="Could not load complaints." onRetry={() => {}} />
        </Section>

        <Section title="Loading">
          <div className="flex items-center gap-4">
            <LoadingSpinner size="sm" />
            <LoadingSpinner />
            <LoadingSpinner size="lg" />
          </div>
          <LoadingSpinner center label="Loading data…" className="rounded-lg bg-slate-50" />
        </Section>
      </div>

      <Card title="Empty state" padded={false}>
        <EmptyState
          title="No complaints yet"
          description="When complaints are submitted they will appear here."
          action={<Button icon={Plus}>New complaint</Button>}
        />
      </Card>

      <Section title="Dialogs">
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirmOpen(true)}>Open confirmation</Button>
        </div>
      </Section>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Example modal"
        description="Press Escape or click outside to close."
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={() => setModalOpen(false)}>Save</Button>
          </>
        }
      >
        <Input label="Title" placeholder="Enter a title" />
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title="Delete complaint?"
        message="This action cannot be undone."
        confirmLabel="Delete"
      />
    </div>
  )
}
