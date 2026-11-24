import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS, STATUS_ORDER } from '../lib/status'

const BATCH_SIZE = 200

const STREET_KEYS = [
  'addr:street',
  'street',
  'Straße',
  'Strasse',
  'strasse',
  'straße',
  'STRASSE',
  'addr:place',
]
const NUMBER_KEYS = ['addr:housenumber', 'housenumber', 'house_number', 'Hausnummer', 'hausnummer', 'HNR', 'nr']
const ID_KEYS = ['@id', 'id', 'osm_id', 'full_id']

function pick(props, keys) {
  for (const k of keys) {
    const v = props?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

// Liest die GeoJSON-Datei und bringt jedes Haus in ein einheitliches Format
function parseGeoJson(text) {
  let json = JSON.parse(text)
  if (json.type === 'Feature') json = { type: 'FeatureCollection', features: [json] }
  if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    throw new Error('Das ist keine gültige GeoJSON-Datei (FeatureCollection erwartet).')
  }
  const allowed = ['Point', 'Polygon', 'MultiPolygon']
  const items = []
  for (const f of json.features) {
    if (!f?.geometry || !allowed.includes(f.geometry.type)) continue
    const p = f.properties || {}
    const osm = f.id !== undefined && f.id !== null ? String(f.id) : pick(p, ID_KEYS)
    items.push({
      osm_id: osm,
      street: pick(p, STREET_KEYS),
      house_number: pick(p, NUMBER_KEYS),
      geometry: f.geometry,
    })
  }
  return { totalFeatures: json.features.length, items }
}

export default function AdminPanel({ houses, onClose, onImported }) {
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState('')
  const [onlyWithNumber, setOnlyWithNumber] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [importError, setImportError] = useState('')

  const prepared = useMemo(() => {
    if (!parsed) return []
    return onlyWithNumber ? parsed.items.filter((i) => i.house_number) : parsed.items
  }, [parsed, onlyWithNumber])

  const stats = useMemo(() => {
    if (!parsed) return null
    return {
      usable: parsed.items.length,
      withStreet: parsed.items.filter((i) => i.street).length,
      withNumber: parsed.items.filter((i) => i.house_number).length,
      withId: parsed.items.filter((i) => i.osm_id).length,
    }
  }, [parsed])

  const counts = useMemo(() => {
    const c = { rot: 0, orange: 0, gruen: 0 }
    for (const h of Object.values(houses)) c[h.status] += 1
    return c
  }, [houses])

  async function onFile(e) {
    const file = e.target.files?.[0]
    setParsed(null)
    setParseError('')
    setResult(null)
    setImportError('')
    setProgress(0)
    if (!file) return
    setFileName(file.name)
    try {
      setParsed(parseGeoJson(await file.text()))
    } catch (err) {
      setParseError(err.message || 'Datei konnte nicht gelesen werden.')
    }
  }

  async function runImport() {
    setRunning(true)
    setResult(null)
    setImportError('')
    setProgress(0)
    const total = { inserted: 0, updated: 0, skipped: 0 }
    let firstError = null

    for (let i = 0; i < prepared.length; i += BATCH_SIZE) {
      const chunk = prepared.slice(i, i + BATCH_SIZE)
      const { data, error } = await supabase.rpc('import_houses', { p_features: chunk })
      if (error) {
        setImportError(`Abbruch bei Haus ${i + 1}: ${error.message}`)
        break
      }
      total.inserted += data.inserted
      total.updated += data.updated
      total.skipped += data.skipped
      if (!firstError && data.first_error) firstError = data.first_error
      setProgress(Math.min(i + BATCH_SIZE, prepared.length))
    }

    setResult({ ...total, firstError })
    setRunning(false)
    onImported()
  }

  const totalHouses = counts.rot + counts.orange + counts.gruen

  return (
    <div className="fixed inset-0 z-[2000] overflow-y-auto bg-gray-100">
      <div className="mx-auto max-w-2xl p-4 pb-16">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Admin-Bereich</h1>
          <button
            onClick={onClose}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold shadow active:bg-gray-100"
          >
            Zurück zur Karte
          </button>
        </div>

        <section className="mb-4 rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-2 font-semibold text-gray-900">Häuser in der Datenbank</h2>
          <p className="text-sm text-gray-700">
            Gesamt: <b>{totalHouses}</b>
            {STATUS_ORDER.map((k) => (
              <span key={k} className="ml-3">
                <span
                  className="mr-1 inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: STATUS[k].color }}
                />
                {STATUS[k].short}: <b>{counts[k]}</b>
              </span>
            ))}
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow">
          <h2 className="mb-1 font-semibold text-gray-900">Häuser aus GeoJSON importieren</h2>
          <p className="mb-3 text-sm text-gray-600">
            Wähle deine Datei (z. B. <code>pyhra_haeuser.geojson</code>). Erlaubt sind Punkte und
            Gebäudeflächen; bei Flächen wird ein Punkt im Gebäude verwendet. Ein erneuter Import
            aktualisiert Adresse und Position bestehender Häuser (gleiche OSM-ID), der Status bleibt
            erhalten.
          </p>

          <input
            type="file"
            accept=".geojson,.json,application/geo+json,application/json"
            onChange={onFile}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-red-700 file:px-4 file:py-2.5 file:font-semibold file:text-white"
          />

          {parseError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{parseError}</p>
          )}

          {stats && (
            <div className="mt-4 space-y-2 text-sm text-gray-800">
              <p>
                Datei <b>{fileName}</b>: <b>{parsed.totalFeatures}</b> Einträge, davon{' '}
                <b>{stats.usable}</b> verwendbar (Punkt/Fläche).
              </p>
              <ul className="list-disc pl-5 text-gray-700">
                <li>mit Straße: {stats.withStreet}</li>
                <li>mit Hausnummer: {stats.withNumber}</li>
                <li>mit OSM-ID (verhindert Doppelte bei erneutem Import): {stats.withId}</li>
              </ul>
              {stats.withId < stats.usable && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                  Einträge ohne ID werden bei jedem Import neu angelegt. Importiere die Datei daher
                  nur einmal.
                </p>
              )}
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={onlyWithNumber}
                  onChange={(e) => setOnlyWithNumber(e.target.checked)}
                  className="h-5 w-5"
                />
                Nur Gebäude mit Hausnummer importieren
              </label>
              <p>
                Wird importiert: <b>{prepared.length}</b> Häuser
              </p>

              <button
                onClick={runImport}
                disabled={running || prepared.length === 0}
                className="w-full rounded-lg bg-red-700 py-3 text-base font-semibold text-white active:bg-red-800 disabled:opacity-40"
              >
                {running ? `Importiere … ${progress} / ${prepared.length}` : 'In Datenbank laden'}
              </button>

              {running && (
                <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full bg-red-700 transition-all"
                    style={{ width: `${(progress / Math.max(prepared.length, 1)) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {importError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{importError}</p>
          )}

          {result && (
            <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              Fertig: <b>{result.inserted}</b> neu angelegt, <b>{result.updated}</b> aktualisiert,{' '}
              <b>{result.skipped}</b> übersprungen.
              {result.firstError && (
                <p className="mt-1 text-amber-800">Erster Fehler bei übersprungenen: {result.firstError}</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
