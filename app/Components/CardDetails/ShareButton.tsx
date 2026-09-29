import { useEffect, useRef, useState } from 'react'
import { shareLink } from '~/lib/card'

const SHARE_ICON = "M680-80q-50 0-85-35t-35-85q0-6 3-28L282-392q-16 15-37 23.5t-45 8.5q-50 0-85-35t-35-85q0-50 35-85t85-35q24 0 45 8.5t37 23.5l281-164q-2-7-2.5-13.5T560-760q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-24 0-45-8.5T598-672L317-508q2 7 2.5 13.5t.5 14.5q0 8-.5 14.5T317-452l281 164q16-15 37-23.5t45-8.5q50 0 85 35t35 85q0 50-35 85t-85 35Z"

const LABELS = { idle: 'Share', shared: 'Shared', copied: 'Link copied', failed: "Couldn't copy" }

// shares a link to a card's page (share sheet on phones, copies the link elsewhere) and says what happened for a moment
export function ShareButton({ path, name, className }: { path: string, name: string, className?: string }) {
    const [state, setState] = useState<keyof typeof LABELS>('idle')
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
    useEffect(() => () => clearTimeout(timer.current), [])

    async function handleShare() {
        const result = await shareLink(path, name)
        setState(result)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState('idle'), 2000)
    }

    return (
        <button type="button" className={className} onClick={handleShare} title="Share a link to this card" aria-live="polite">
            <svg viewBox="0 -960 960 960" style={state === 'copied' || state === 'shared' ? { fill: 'var(--success)' } : undefined}><path d={SHARE_ICON} /></svg>
            {LABELS[state]}
        </button>
    )
}
