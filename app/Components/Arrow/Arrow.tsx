import styles from './Arrow.module.css'

// The site's arrow (public/Arrow.svg, drawn pointing right) in the text's colour, turned the way it points.
// Size it with font-size, or a class setting width and height.
export function Arrow({ to, className }: { to: 'up' | 'down' | 'left' | 'right', className?: string }) {
    return <span className={className ? `${styles.arrow} ${className}` : styles.arrow} data-to={to} aria-hidden />
}
