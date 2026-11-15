// Undo history: the states before the present one, oldest first.
export type History<T> = { past: T[]; present: T }

export const startHistory = <T>(present: T): History<T> => ({ past: [], present })

// makes `next` the present, keeping at most `limit` earlier states (the oldest are dropped)
export function record<T>(h: History<T>, next: T, limit = 20): History<T> {
    const past = [...h.past, h.present]
    return { past: limit > 0 ? past.slice(-limit) : [], present: next }
}

export function undo<T>(h: History<T>): History<T> {
    if (h.past.length === 0) return h
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1] }
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0
