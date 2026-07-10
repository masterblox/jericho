import React from 'react'
import { Workshop } from './variants/Workshop'
import { Hadal } from './variants/Hadal'
import { DispatchModal, Toast } from './components'

const variant = import.meta.env.VITE_DESIGN_VARIANT === 'hadal' ? 'hadal' : 'workshop'

export default function App() {
  const [active, setActive] = React.useState('COMMAND')
  const [selectedAgent, setSelectedAgent] = React.useState(variant === 'hadal' ? 'IRIS' : 'DEV')
  const [directive, setDirective] = React.useState('')
  const [toast, setToast] = React.useState(false)
  const dispatch = () => {
    setDirective('')
    setToast(true)
    window.setTimeout(() => setToast(false), 3200)
  }
  const props = { active, setActive, selectedAgent, setSelectedAgent, onPreview: setDirective }

  return <main className={`app variant-${variant}`} data-variant={variant}>
    {variant === 'workshop' ? <Workshop {...props} /> : <Hadal {...props} />}
    <DispatchModal directive={directive} onClose={() => setDirective('')} onDispatch={dispatch} />
    <Toast visible={toast} />
  </main>
}
