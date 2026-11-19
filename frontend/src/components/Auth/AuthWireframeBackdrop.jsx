import React from 'react';
import { Scale } from 'lucide-react';

const LEFT_FAN_LINES = Array.from({ length: 14 }, (_, idx) => ({
  id: `left-${idx}`,
  x1: -40 + idx * 54,
  y1: 0,
  x2: 460 + idx * 24,
  y2: 960,
}));

const RIGHT_FAN_LINES = Array.from({ length: 14 }, (_, idx) => ({
  id: `right-${idx}`,
  x1: 1480 - idx * 54,
  y1: 0,
  x2: 980 - idx * 24,
  y2: 960,
}));

const HORIZONTAL_ARCS = [
  'M -60 110 Q 720 260 1500 110',
  'M -60 220 Q 720 350 1500 220',
  'M -60 350 Q 720 450 1500 350',
  'M -60 510 Q 720 560 1500 510',
];

export function AuthWireframeBackdrop() {
  return (
    <div className="lexit-auth-backdrop" aria-hidden="true">
      <svg
        className="lexit-auth-mesh"
        viewBox="0 0 1440 960"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <radialGradient id="lexitAuthGlow" cx="50%" cy="18%" r="62%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" />
            <stop offset="55%" stopColor="#1e3a8a" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#070d1b" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1440" height="960" fill="url(#lexitAuthGlow)" />
        <g stroke="#6ea8e5" strokeOpacity="0.16" strokeWidth="1" fill="none">
          {LEFT_FAN_LINES.map((line) => (
            <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          ))}
          {RIGHT_FAN_LINES.map((line) => (
            <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
          ))}
        </g>
        <g stroke="#7bb6f0" strokeOpacity="0.12" strokeWidth="1" fill="none">
          {HORIZONTAL_ARCS.map((d, idx) => (
            <path key={`arc-${idx}`} d={d} />
          ))}
        </g>
      </svg>
    </div>
  );
}

export function AuthBrandHeader({ onGoHome }) {
  return (
    <header className="lexit-auth-brand-header">
      <a
        href="/"
        className="lexit-auth-brand-link"
        onClick={(e) => {
          e.preventDefault();
          onGoHome();
        }}
        aria-label="LexIT — Quay lại không gian tư vấn pháp luật CNTT"
      >
        <span className="lexit-auth-brand-mark" aria-hidden="true">
          <Scale size={20} strokeWidth={2.2} />
        </span>
        <span className="lexit-auth-wordmark">
          <strong>LEX</strong>
          <span>IT</span>
        </span>
      </a>
    </header>
  );
}
