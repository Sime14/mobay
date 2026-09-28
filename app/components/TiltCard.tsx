'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';

// A link card that tilts towards the mouse in 3D, with a soft glare that follows
// the pointer. Touch and pen input leave it flat, and globals.css turns the tilt
// off for people who prefer reduced motion.

interface TiltCardProps {
    href?: string;
    className?: string;
    children: ReactNode;
}

const MAX_TILT_DEG = 8;

export default function TiltCard({ href, className = '', children }: TiltCardProps) {
    const ref = useRef<HTMLAnchorElement>(null);

    const onPointerMove = (e: PointerEvent<HTMLAnchorElement>) => {
        const el = ref.current;
        if (!el || e.pointerType !== 'mouse') return;
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        el.style.setProperty('--tilt-x', `${(0.5 - py) * MAX_TILT_DEG * 2}deg`);
        el.style.setProperty('--tilt-y', `${(px - 0.5) * MAX_TILT_DEG * 2}deg`);
        el.style.setProperty('--glare-x', `${px * 100}%`);
        el.style.setProperty('--glare-y', `${py * 100}%`);
        el.classList.add('is-tilting');
    };

    const onPointerLeave = () => {
        const el = ref.current;
        if (!el) return;
        el.style.setProperty('--tilt-x', '0deg');
        el.style.setProperty('--tilt-y', '0deg');
        el.classList.remove('is-tilting');
    };

    return (
        <a
            ref={ref}
            href={href || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={`tilt-card ${className}`}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
        >
            {children}
            <span className="tilt-glare" aria-hidden="true" />
        </a>
    );
}
