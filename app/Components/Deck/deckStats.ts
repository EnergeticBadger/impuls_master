// bars for the mana curve: one per mana value, heights relative to the tallest (0 to 100)
export function curveBars(curve: number[]): { label: string; count: number; pct: number }[] {
    const tallest = Math.max(0, ...curve)
    return curve.map((count, i) => ({
        label: i === 7 ? "7+" : String(i),
        count,
        pct: tallest > 0 ? (count / tallest) * 100 : 0,
    }))
}
