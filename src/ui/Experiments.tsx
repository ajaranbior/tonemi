import { FLAGS, setFlag, useFlag, type Flag } from '../flags'

function FlagToggle({ flag }: { flag: Flag }) {
  const on = useFlag(flag)
  const { label, help } = FLAGS[flag]
  return (
    <label className="toggle flag">
      <input type="checkbox" checked={on} onChange={(e) => setFlag(flag, e.target.checked)} />
      <span>
        {label}
        <span className="muted small flag-help">{help}</span>
      </span>
    </label>
  )
}

/** Feature flags for ear training: each experiment on its own switch. */
export function Experiments() {
  return (
    <details className="card settings experiments">
      <summary>🧪 Experiments</summary>
      <p className="muted small">
        Ways to train hearing the pitch itself rather than remembering recordings. They apply to 📚 Words; switch any of them off
        if it gets in the way.
      </p>
      {(Object.keys(FLAGS) as Flag[]).map((f) => (
        <FlagToggle key={f} flag={f} />
      ))}
    </details>
  )
}
