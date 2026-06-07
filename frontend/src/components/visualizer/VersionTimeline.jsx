import React from 'react';
import T from '../../theme';

export default function VersionTimeline({ releases, selected, onSelect, cluster }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {releases.map((hr, i) => {
        const active = hr.version === selected;
        return (
          <React.Fragment key={hr.version}>
            {i > 0 && (
              <div style={{
                width: 40, height: 2,
                background: i <= releases.findIndex((r) => r.version === selected)
                  ? T.teal : T.border,
                transition: 'background 0.3s',
              }} />
            )}
            <button
              onClick={() => onSelect(hr.version)}
              title={`Helm Chart ${hr.version}${hr.releaseName ? ` — ${hr.releaseName}` : ''}${cluster ? ` | Cluster: ${cluster.toUpperCase()}` : ''}`}
              style={{
                width: 48, height: 40, borderRadius: 20,
                border: `2px solid ${active ? T.teal : T.border}`,
                background: active ? T.teal : T.bgSurface,
                color: active ? T.white : T.textMuted,
                fontSize: 10, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.25s ease',
                boxShadow: active ? `0 0 12px ${T.teal}66` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              v{hr.version}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
