import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS, STATUS_ORDER } from '../lib/status'
import { formatDateTime, houseLabel } from '../lib/format'

function explain(error) {
  if (!error) return ''
  if (error.code === '40001') {
    return 'Konflikt: Dieses Haus wurde gerade von jemand anderem geändert. Die Ansicht wurde aktualisiert – bitte erneut versuchen.'
  }
  if (error.code === '42501') return 'Dafür fehlt dir die Berechtigung.'
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Keine Internetverbindung. Die Änderung wurde NICHT gespeichert.'
  }
  return error.message || 'Unbekannter Fehler.'
}

function Chip({ status }) {
  const s = STATUS[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.soft}`}>{s.short}</span>
  )
}

export default function HouseDetail({
  house,
  names,
  currentUserId,
  isAdmin,
  onClose,
  onChanged,
  onReload,
}) {
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [history, setHistory] = useState([])

  const [noteText, setNoteText] = useState('')
  const [noteMeta, setNoteMeta] = useState(null) // { version, updated_by, updated_at } oder null
  const [noteDirty, setNoteDirty] = useState(false)
  const [noteRemote, setNoteRemote] = useState(false)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteMsg, setNoteMsg] = useState(null) // { type: 'ok' | 'error', text }

  const metaRef = useRef(null)
  const dirtyRef = useRef(false)
  metaRef.current = noteMeta
  dirtyRef.current = noteDirty

  const nameOf = (id) => (id ? names[id] || 'Unbekannt' : 'System')

  // ---------- Notiz laden ----------
  const loadNote = useCallback(async () => {
    const { data, error } = await supabase
      .from('house_notes')
      .select('note, version, updated_by, updated_at')
      .eq('house_id', house.id)
      .maybeSingle()
    if (error) {
      setNoteMsg({ type: 'error', text: explain(error) })
      return
    }
    setNoteMeta(data ?? null)
    setNoteText(data?.note ?? '')
    setNoteDirty(false)
    setNoteRemote(false)
  }, [house.id])

  useEffect(() => {
    setStatusMsg('')
    setNoteMsg(null)
    setNoteText('')
    setNoteMeta(null)
    setNoteDirty(false)
    setNoteRemote(false)
    loadNote()
  }, [house.id, loadNote])

  // Live: Notiz von jemand anderem geändert?
  useEffect(() => {
    const channel = supabase
      .channel(`note-${house.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'house_notes', filter: `house_id=eq.${house.id}` },
        (payload) => {
          const row = payload.new
          if (row && metaRef.current && row.version === metaRef.current.version) return
          if (dirtyRef.current) setNoteRemote(true)
          else loadNote()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [house.id, loadNote])

  // ---------- Verlauf laden (bei jeder neuen Hausversion) ----------
  useEffect(() => {
    let cancelled = false
    supabase
      .from('status_history')
      .select('id, old_status, new_status, changed_by, changed_at, source')
      .eq('house_id', house.id)
      .order('changed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!cancelled) setHistory(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [house.id, house.version])

  // ---------- Aktionen ----------
  async function changeStatus(newStatus) {
    if (newStatus === house.status || busy) return
    setBusy(true)
    setStatusMsg('')
    const { data, error } = await supabase.rpc('set_house_status', {
      p_house: house.id,
      p_status: newStatus,
      p_expected_version: house.version,
    })
    if (error) {
      setStatusMsg(explain(error))
      if (error.code === '40001') await onReload()
    } else if (data) {
      onChanged(data)
    }
    setBusy(false)
  }

  async function undoLast() {
    if (busy) return
    setBusy(true)
    setStatusMsg('')
    const { data, error } = await supabase.rpc('undo_last_status_change', { p_house: house.id })
    if (error) setStatusMsg(explain(error))
    else if (data) onChanged(data)
    setBusy(false)
  }

  async function saveNote() {
    setNoteSaving(true)
    setNoteMsg(null)
    const text = noteText.trim()
    const columns = 'note, version, updated_by, updated_at'
    let data = null
    let conflict = false
    let error = null

    if (noteMeta) {
      const res = await supabase
        .from('house_notes')
        .update({ note: text })
        .eq('house_id', house.id)
        .eq('version', noteMeta.version)
        .select(columns)
      error = res.error
      if (!error && (!res.data || res.data.length === 0)) conflict = true
      else data = res.data?.[0] ?? null
    } else {
      const res = await supabase
        .from('house_notes')
        .insert({ house_id: house.id, note: text })
        .select(columns)
      error = res.error
      if (error?.code === '23505') {
        conflict = true
        error = null
      } else {
        data = res.data?.[0] ?? null
      }
    }

    if (conflict) {
      setNoteRemote(true)
      setNoteMsg({
        type: 'error',
        text: 'Nicht gespeichert: Die Notiz wurde zwischenzeitlich von jemand anderem geändert.',
      })
    } else if (error) {
      setNoteMsg({ type: 'error', text: explain(error) })
    } else if (data) {
      setNoteMeta(data)
      setNoteText(data.note)
      setNoteDirty(false)
      setNoteRemote(false)
      setNoteMsg({ type: 'ok', text: 'Notiz gespeichert.' })
    }
    setNoteSaving(false)
  }

  const canUndo =
    history.length > 0 && (history[0].changed_by === currentUserId || isAdmin)

  return (
    <div className="pb-[env(safe-area-inset-bottom)]">
      {/* Kopf */}
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-gray-900">{houseLabel(house)}</h2>
          <span
            className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[house.status].soft}`}
          >
            {STATUS[house.status].label}
          </span>
          {house.status_changed_at && (
            <p className="mt-1 text-xs text-gray-500">
              Zuletzt: {nameOf(house.status_changed_by)} · {formatDateTime(house.status_changed_at)}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Schließen"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-3xl leading-none text-gray-500 active:bg-gray-100"
        >
          ×
        </button>
      </div>

      <div className="space-y-6 px-4 py-4">
        {/* Status */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Status ändern</h3>
          <div className="grid grid-cols-3 gap-2">
            {STATUS_ORDER.map((key) => {
              const s = STATUS[key]
              const active = house.status === key
              return (
                <button
                  key={key}
                  disabled={busy}
                  onClick={() => changeStatus(key)}
                  className={`flex min-h-[4rem] flex-col items-center justify-center rounded-xl border-2 px-1 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                    active
                      ? `${s.button} border-gray-900`
                      : 'border-gray-200 bg-white text-gray-800 active:bg-gray-100'
                  }`}
                >
                  <span
                    className="mb-1 h-3 w-3 rounded-full"
                    style={{ background: active ? '#ffffff' : s.color }}
                  />
                  {s.short}
                  <span className="text-[11px] font-normal leading-tight opacity-90">
                    {s.label}
                  </span>
                </button>
              )
            })}
          </div>
          {statusMsg && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{statusMsg}</p>
          )}
          {canUndo && (
            <button
              onClick={undoLast}
              disabled={busy}
              className="mt-2 text-sm font-medium text-red-700 underline disabled:opacity-60"
            >
              Letzte Änderung rückgängig machen
            </button>
          )}
        </section>

        {/* Notiz */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Notiz</h3>
          <textarea
            value={noteText}
            rows={4}
            maxLength={2000}
            placeholder="z. B. Nachmittags nochmal versuchen …"
            onChange={(e) => {
              setNoteText(e.target.value)
              setNoteDirty(true)
              setNoteMsg(null)
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
          />
          {noteMeta && (
            <p className="mt-1 text-xs text-gray-500">
              Zuletzt geändert von {nameOf(noteMeta.updated_by)} · {formatDateTime(noteMeta.updated_at)}
            </p>
          )}
          {noteRemote && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Die Notiz wurde von jemand anderem geändert.{' '}
              <button onClick={loadNote} className="font-semibold underline">
                Neu laden (meine Eingabe verwerfen)
              </button>
            </div>
          )}
          {noteMsg && (
            <p
              className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                noteMsg.type === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {noteMsg.text}
            </p>
          )}
          <button
            onClick={saveNote}
            disabled={!noteDirty || noteSaving}
            className="mt-2 w-full rounded-lg bg-red-700 py-3 text-base font-semibold text-white active:bg-red-800 disabled:opacity-40"
          >
            {noteSaving ? 'Speichern …' : 'Notiz speichern'}
          </button>
        </section>

        {/* Verlauf */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Änderungsverlauf</h3>
          {history.length === 0 ? (
            <p className="text-sm text-gray-500">Noch keine Statusänderungen.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((h) => (
                <li key={h.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Chip status={h.old_status} />
                    <span className="text-gray-400">→</span>
                    <Chip status={h.new_status} />
                    {h.source === 'undo' && (
                      <span className="text-xs text-gray-500">(rückgängig)</span>
                    )}
                    {h.source === 'offline' && (
                      <span className="text-xs text-gray-500">(offline erfasst)</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {nameOf(h.changed_by)} · {formatDateTime(h.changed_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
