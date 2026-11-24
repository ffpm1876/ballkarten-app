import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const COLUMNS =
  'id,street,house_number,address,lat,lng,area_id,status,revisit,version,status_changed_at,status_changed_by'
const PAGE_SIZE = 1000 // Supabase liefert pro Abfrage maximal 1000 Zeilen

export function useHouses(enabled) {
  const [houses, setHouses] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')

  const housesRef = useRef(houses)
  housesRef.current = houses
  const reloadTimer = useRef(null)
  const dropped = useRef(false)

  const loadAll = useCallback(async () => {
    const all = {}
    let from = 0
    for (;;) {
      const { data, error: err } = await supabase
        .from('houses')
        .select(COLUMNS)
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (err) {
        setError(err.message)
        return
      }
      for (const h of data) all[h.id] = h
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    setError('')
    setHouses((prev) => {
      const next = { ...all }
      // neuere Live-Änderungen, die während des Ladens eintrafen, nicht überschreiben
      for (const id in prev) {
        if (next[id] && prev[id].version > next[id].version) next[id] = prev[id]
      }
      return next
    })
    setLoaded(true)
  }, [])

  // Ergebnis einer eigenen Änderung (z. B. nach Status-Knopf) sofort übernehmen
  const applyHouse = useCallback((h) => {
    setHouses((prev) => {
      const old = prev[h.id]
      if (old && old.version > h.version) return prev
      return { ...prev, [h.id]: { ...old, ...h } }
    })
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let alive = true

    const scheduleReload = () => {
      clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(() => alive && loadAll(), 500)
    }

    loadAll()

    const channel = supabase
      .channel('houses-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'houses' }, (payload) => {
        if (!alive) return

        if (payload.eventType === 'DELETE') {
          const id = payload.old?.id
          if (id) {
            setHouses((prev) => {
              if (!prev[id]) return prev
              const next = { ...prev }
              delete next[id]
              return next
            })
          }
          return
        }

        const row = payload.new
        if (!row?.id) return
        const old = housesRef.current[row.id]
        if (!old) {
          // neues Haus (Import) oder neu freigegebenes Gebiet -> neu laden
          scheduleReload()
          return
        }
        if (old.version > row.version) return

        // lat/lng werden von der Datenbank berechnet und kommen im Live-Paket evtl. nicht mit
        const { lat, lng, ...rest } = row
        setHouses((prev) => ({
          ...prev,
          [row.id]: {
            ...prev[row.id],
            ...rest,
            ...(lat != null && lng != null ? { lat, lng } : {}),
          },
        }))
      })
      .subscribe((status) => {
        if (!alive) return
        if (status === 'SUBSCRIBED') {
          setConnected(true)
          if (dropped.current) {
            dropped.current = false
            loadAll() // nach Verbindungsabbruch alles neu abgleichen
          }
        } else {
          setConnected(false)
          dropped.current = true
        }
      })

    const onOnline = () => loadAll()
    window.addEventListener('online', onOnline)

    return () => {
      alive = false
      clearTimeout(reloadTimer.current)
      window.removeEventListener('online', onOnline)
      supabase.removeChannel(channel)
    }
  }, [enabled, loadAll])

  return { houses, loaded, connected, error, applyHouse, reload: loadAll }
}
