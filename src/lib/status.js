export const STATUS = {
  rot: {
    key: 'rot',
    short: 'Rot',
    label: 'Noch nicht besucht',
    color: '#dc2626',
    button: 'bg-red-600 text-white',
    soft: 'bg-red-100 text-red-800',
  },
  orange: {
    key: 'orange',
    short: 'Orange',
    label: 'Niemand zuhause',
    color: '#f59e0b',
    button: 'bg-amber-500 text-white',
    soft: 'bg-amber-100 text-amber-800',
  },
  gruen: {
    key: 'gruen',
    short: 'Grün',
    label: 'Erledigt',
    color: '#16a34a',
    button: 'bg-green-600 text-white',
    soft: 'bg-green-100 text-green-800',
  },
}

export const STATUS_ORDER = ['rot', 'orange', 'gruen']
