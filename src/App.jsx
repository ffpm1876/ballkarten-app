import { useEffect, useMemo, useState } from 'react'
import { isConfigured, supabase } from './lib/supabase'
import { useAuth } from './hooks/useAuth'
import { useHouses } from './hooks/useHouses'
import { STATUS, STATUS_ORDER } from './lib/status'
import LoginScreen from './components/LoginScreen'
import MapView from './components/MapView'
import HouseDetail from './components/HouseDetail'
import AdminPanel from './components/AdminPanel'

const ROLE_LABEL = {
  admin: 'Administrator',
  gebietsleiter: 'Gebietsleiter',
  kamerad: 'Kamerad',
}

function Centered({ children }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-lg">{children}</div>
    </div>
  )
}

function ConfigMissing() {
  return (
    <Centered>
      <h1 className="mb-2 text-lg font-bold">Konfiguration fehlt</h1>
      <p className="text-sm text-gray-700">
        Lege im Projektordner eine Datei <code>.env</code> an mit den Zeilen{' '}
        <code>VITE_SUPABASE_URL</code> und <code>VITE_SUPABASE_ANON_KEY</code> (siehe{' '}
        <code>.env.example</code>) und starte die Vorschau danach neu.
      </p>
    </Centered>
  )
}

function NotActive({ onSignOut }) {
  return (
    <Centered>
      <h1 className="mb-2 text-lg font-bold">Konto noch nicht freigeschaltet</h1>
      <p className="mb-4 text-sm text-gray-700">
        Dein Zugang muss zuerst von einem Administrator aktiviert werden. Bitte melde dich dort.
      </p>
      <button
        onClick={onSignOut}
        className="rounded-lg bg-red-700 px-5 py-3 font-semibold text-white active:bg-red-800"
      >
        Abmelden
      </button>
    </Centered>
  )
}

function Workspace({ profile, onSignOut }) {
  const isAdmin = profile.role === 'admin'
  const { houses, loaded, connected, error, applyHouse, reload } = useHouses(true)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('map')
  const [names, setNames] = useState({})

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, display_name')
      .then(({ data }) => {
        if (data) setNames(Object.fromEntries(data.map((p) => [p.id, p.display_name])))
      })
  }, [])

  const counts = useMemo(() => {
    const c = { rot: 0, orange: 0, gruen: 0 }
    for (const h of Object.values(houses)) c[h.status] += 1
    return c
  }, [houses])
  const total = counts.rot + counts.orange + counts.gruen
  const percent = total ? Math.round((counts.gruen / total) * 100) : 0
  const selected = selectedId ? houses[selectedId] : null

  return (
    <div className="flex h-dvh flex-col bg-gray-100">
      <header
        className="flex items-center gap-2 bg-red-700 px-3 pb-2 text-white"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">🚒 Ballkarten Pyhra</h1>
        <span className="hidden text-sm sm:inline">
          {profile.display_name} · {ROLE_LABEL[profile.role]}
        </span>
        {isAdmin && (
          <button
            onClick={() => setView('admin')}
            className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold active:bg-white/30"
          >
            Admin
          </button>
        )}
        <button
          onClick={onSignOut}
          className="rounded-lg bg-white/20 px-3 py-2 text-sm font-semibold active:bg-white/30"
        >
          Abmelden
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-white px-3 py-2 text-sm">
        {STATUS_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full" style={{ background: STATUS[k].color }} />
            {STATUS[k].short}: <b>{counts[k]}</b>
            <span className="hidden text-gray-500 md:inline">({STATUS[k].label})</span>
          </span>
        ))}
        <span className="text-gray-700">
          Fortschritt: <b>{percent}%</b>
        </span>
        <span
          className={`ml-auto flex items-center gap-1.5 text-xs ${
            connected ? 'text-green-700' : 'text-red-700'
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {connected ? 'Live verbunden' : 'Keine Live-Verbindung'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 px-3 py-2 text-sm text-red-700">
          Daten konnten nicht geladen werden: {error}
        </div>
      )}
      {loaded && total === 0 && !error && (
        <div className="bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {isAdmin
            ? 'Noch keine Häuser vorhanden. Öffne den Admin-Bereich und lade deine GeoJSON-Datei hoch.'
            : 'Dir sind noch keine Häuser zugeteilt. Bitte wende dich an einen Administrator.'}
        </div>
      )}

      <main className="relative flex min-h-0 flex-1">
        <div className="relative z-0 min-w-0 flex-1">
          <MapView houses={houses} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {selected && (
          <aside className="absolute inset-x-0 bottom-0 z-20 max-h-[58%] overflow-y-auto rounded-t-2xl bg-white shadow-2xl md:static md:max-h-none md:w-[26rem] md:shrink-0 md:rounded-none md:border-l md:shadow-none">
            <HouseDetail
              house={selected}
              names={names}
              currentUserId={profile.id}
              isAdmin={isAdmin}
              onClose={() => setSelectedId(null)}
              onChanged={applyHouse}
              onReload={reload}
            />
          </aside>
        )}
      </main>

      {view === 'admin' && isAdmin && (
        <AdminPanel houses={houses} onClose={() => setView('map')} onImported={reload} />
      )}
    </div>
  )
}

function MainApp() {
  const { session, profile, loading, signIn, signOut } = useAuth()

  if (loading) {
    return (
      <Centered>
        <p className="text-gray-600">Lade …</p>
      </Centered>
    )
  }
  if (!session) return <LoginScreen onSignIn={signIn} />
  if (!profile || !profile.active) return <NotActive onSignOut={signOut} />
  return <Workspace profile={profile} onSignOut={signOut} />
}

export default function App() {
  if (!isConfigured) return <ConfigMissing />
  return <MainApp />
}
