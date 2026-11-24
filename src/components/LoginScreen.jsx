import { useState } from 'react'

export default function LoginScreen({ onSignIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await onSignIn(email.trim(), password)
    if (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'E-Mail oder Passwort ist falsch.'
          : err.message,
      )
    }
    setBusy(false)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gray-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-700 text-2xl text-white">
            🚒
          </div>
          <h1 className="text-xl font-bold text-gray-900">Feuerwehr Pyhra</h1>
          <p className="text-sm text-gray-600">Ballkartenverkauf – Anmeldung</p>
        </div>

        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="email">
          E-Mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-3 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
        />

        <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="password">
          Passwort
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-3 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
        />

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-red-700 py-3 text-base font-semibold text-white active:bg-red-800 disabled:opacity-60"
        >
          {busy ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
    </div>
  )
}
