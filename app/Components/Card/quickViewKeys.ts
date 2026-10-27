// What a key does in the open quick view. `index` is the shown card's place among `count` results (an index
// outside 0..count-1 means it isn't one of them, so the arrows do nothing). Keys typed into an input or textarea
// (`inInput`) are left alone. The arrows stop at the ends of the list rather than wrapping.
export function quickViewAction(key: string, index: number, count: number, inInput: boolean): 'close' | { go: number } | undefined {
    if (inInput) return undefined
    if (key === 'Escape') return 'close'
    if (index < 0 || index >= count) return undefined
    if (key === 'ArrowLeft') return index > 0 ? { go: index - 1 } : undefined
    if (key === 'ArrowRight') return index < count - 1 ? { go: index + 1 } : undefined
    return undefined
}
