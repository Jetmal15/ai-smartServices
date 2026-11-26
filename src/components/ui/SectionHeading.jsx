import { cn } from '../../lib/cn.js'

export default function SectionHeading({ eyebrow, title, description, align = 'center', as: Heading = 'h2', className }) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center', className)}>
      {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
      <Heading className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</Heading>
      {description && <p className="mt-4 text-lg text-slate-600">{description}</p>}
    </div>
  )
}
