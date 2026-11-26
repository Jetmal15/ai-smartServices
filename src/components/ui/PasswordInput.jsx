import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import Input from './Input.jsx'

export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      icon={Lock}
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded-md p-1.5 text-slate-400 transition hover:text-slate-600"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      }
    />
  )
}
