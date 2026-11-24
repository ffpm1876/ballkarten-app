const formatter = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Europe/Vienna',
})

export function formatDateTime(iso) {
  if (!iso) return '–'
  try {
    return formatter.format(new Date(iso))
  } catch {
    return String(iso)
  }
}

export function houseLabel(h) {
  const line = [h.street, h.house_number].filter(Boolean).join(' ')
  return line || h.address || 'Haus ohne Adresse'
}
