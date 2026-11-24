import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { STATUS } from '../lib/status'
import { houseLabel } from '../lib/format'

const PYHRA = [48.1578, 15.6844]

function radiusFor(zoom) {
  if (zoom >= 19) return 13
  if (zoom >= 18) return 11
  if (zoom >= 17) return 9
  if (zoom >= 16) return 7
  if (zoom >= 15) return 5
  return 4
}

export default function MapView({ houses, selectedId, onSelect }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map())
  const onSelectRef = useRef(onSelect)
  const housesRef = useRef(houses)
  onSelectRef.current = onSelect
  housesRef.current = houses

  // Karte einmalig anlegen
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: PYHRA,
      zoom: 16,
      maxZoom: 19,
      renderer: L.canvas({ padding: 0.5, tolerance: 8 }),
    })

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map)

    map.on('click', () => onSelectRef.current(null))
    map.on('zoomend', () => {
      const r = radiusFor(map.getZoom())
      markersRef.current.forEach((m) => m.setRadius(r + (m._selected ? 3 : 0)))
    })

    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(containerRef.current)

    mapRef.current = map
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
    }
  }, [])

  // Häuser als farbige Punkte zeichnen / aktualisieren
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    const seen = new Set()
    const radius = radiusFor(map.getZoom())

    for (const h of Object.values(houses)) {
      if (h.lat == null || h.lng == null) continue
      seen.add(h.id)
      const selected = h.id === selectedId
      const key = `${h.status}|${selected}`
      let m = markers.get(h.id)

      if (!m) {
        m = L.circleMarker([h.lat, h.lng], {
          radius: radius + (selected ? 3 : 0),
          fillColor: STATUS[h.status].color,
          fillOpacity: 0.95,
          color: selected ? '#111827' : '#ffffff',
          weight: selected ? 3 : 1.5,
          bubblingMouseEvents: false,
        })
        const id = h.id
        m.on('click', () => onSelectRef.current(id))
        if (!L.Browser.mobile) m.bindTooltip(houseLabel(h), { direction: 'top', offset: [0, -6] })
        m.addTo(map)
        m._key = key
        m._selected = selected
        markers.set(h.id, m)
      } else {
        const ll = m.getLatLng()
        if (ll.lat !== h.lat || ll.lng !== h.lng) m.setLatLng([h.lat, h.lng])
        if (m._key !== key) {
          m.setStyle({
            fillColor: STATUS[h.status].color,
            color: selected ? '#111827' : '#ffffff',
            weight: selected ? 3 : 1.5,
          })
          m.setRadius(radius + (selected ? 3 : 0))
          m._key = key
          m._selected = selected
        }
        if (m.getTooltip()) m.setTooltipContent(houseLabel(h))
      }
      if (selected) m.bringToFront()
    }

    for (const [id, m] of markers) {
      if (!seen.has(id)) {
        m.remove()
        markers.delete(id)
      }
    }
  }, [houses, selectedId])

  // Beim Auswählen: Haus sichtbar halten (am Handy oberhalb der Seitenleiste)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const h = housesRef.current[selectedId]
    if (!h || h.lat == null) return
    const size = map.getSize()
    const pt = map.latLngToContainerPoint([h.lat, h.lng])
    if (window.innerWidth < 768) {
      if (pt.y > size.y * 0.4 || pt.y < 0 || pt.x < 0 || pt.x > size.x) {
        map.panBy([pt.x - size.x / 2, pt.y - size.y * 0.2], { animate: true })
      }
    } else if (!map.getBounds().contains([h.lat, h.lng])) {
      map.panTo([h.lat, h.lng], { animate: true })
    }
  }, [selectedId])

  return <div ref={containerRef} className="absolute inset-0" />
}
