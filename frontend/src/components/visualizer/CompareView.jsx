import { useState, useEffect } from 'react';
import T from '../../theme';

const API_BASE = '/api';

export default function CompareView({ releases, currentVersion, cluster, onClose }) {
  const [compareWith, setCompareWith] = useState('');
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(false);

  const others = releases.filter((r) => r.version !== currentVersion);

  const hasRecipeDiffs = (data) => {
    if (!data) return false;
    const keys = ['recipesAdded', 'recipesRemoved', 'recipesChanged'];
    return keys.some((k) => Array.isArray(data[k]) && data[k].length > 0);
  };

  const renderList = (items) => (
    <ul style={{ margin: 0, paddingLeft: 18, color: T.textMuted, fontSize: 12 }}>
      {items.map((text, i) => <li key={`${text}-${i}`}>{text}</li>)}
    </ul>
  );

  const renderRecipeSection = (title, items, formatter) => (
    <div style={{
      background: T.bgSurface, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: '12px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textMuted }}>None</div>
      ) : (
        renderList(items.map(formatter))
      )}
    </div>
  );

  const renderChangedRecipes = (items) => (
    <div style={{
      background: T.bgSurface, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: '12px 16px',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
        Recipes Changed
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textMuted }}>None</div>
      ) : (
        items.map((rec) => {
          const comp = rec.components || {};
          const up = rec.upgrade_to || {};
          const addedComps = comp.added ? Object.entries(comp.added).map(([k, v]) => `+ ${k}: ${v}`) : [];
          const removedComps = comp.removed ? Object.entries(comp.removed).map(([k, v]) => `- ${k}: ${v}`) : [];
          const changedComps = comp.changed
            ? Object.entries(comp.changed).map(([k, v]) => `~ ${k}: ${v.from} → ${v.to}`)
            : [];
          const upAdded = Array.isArray(up.added) ? up.added.map((p) => `+ ${p}`) : [];
          const upRemoved = Array.isArray(up.removed) ? up.removed.map((p) => `- ${p}`) : [];

          return (
            <div key={rec.version} style={{
              borderTop: `1px dashed ${T.border}`,
              paddingTop: 10,
              marginTop: 10,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.teal, marginBottom: 6 }}>
                Recipe v{rec.version}
              </div>
              {(addedComps.length + removedComps.length + changedComps.length) > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
                    Components
                  </div>
                  {renderList([...addedComps, ...removedComps, ...changedComps])}
                </div>
              )}
              {(upAdded.length + upRemoved.length) > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>
                    Upgrade To
                  </div>
                  {renderList([...upAdded, ...upRemoved])}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  useEffect(() => {
    if (!compareWith) { setDiff(null); return; }
    setLoading(true);
    fetch(`${API_BASE}/helm-releases/compare?from=${compareWith}&to=${currentVersion}&cluster=${cluster}`)
      .then((r) => r.json())
      .then(setDiff)
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [compareWith, currentVersion, cluster]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 16,
        padding: 28, width: 560, maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: T.text }}>Compare Helm Versions</h2>
          <button onClick={onClose} style={{
            background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 6,
            color: T.textMuted, width: 28, height: 28, cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <select value={compareWith} onChange={(e) => setCompareWith(e.target.value)} style={{
            flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 14,
            background: T.bgSurface, color: T.text, border: `1px solid ${T.border}`,
          }}>
            <option value="">Select version to compare...</option>
            {others.map((r) => <option key={r.version} value={r.version}>{r.version} ({r.releaseName})</option>)}
          </select>
          <span style={{ color: T.textMuted, fontSize: 14 }}>→</span>
          <div style={{
            padding: '8px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600,
            background: `${T.teal}18`, color: T.teal, border: `1px solid ${T.teal}44`,
          }}>{currentVersion}</div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: 20, color: T.textMuted }}>Loading comparison...</div>}

        {diff && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!hasRecipeDiffs(diff) && !diff.error && (
              <div style={{
                background: T.bgSurface, border: `1px dashed ${T.border}`,
                borderRadius: 10, padding: '12px 16px',
                color: T.textMuted, fontSize: 12, textAlign: 'center',
              }}>
                No recipe differences found for these versions.
              </div>
            )}
            {diff.error && (
              <div style={{
                background: `${T.red}15`, border: `1px solid ${T.red}55`,
                borderRadius: 10, padding: '12px 16px',
                color: T.red, fontSize: 12,
              }}>
                {diff.error}
              </div>
            )}
            {renderRecipeSection(
              'Recipes Added',
              Array.isArray(diff.recipesAdded) ? diff.recipesAdded : [],
              (r) => `v${r.version}${r.description ? ` — ${r.description}` : ''}`
            )}
            {renderRecipeSection(
              'Recipes Removed',
              Array.isArray(diff.recipesRemoved) ? diff.recipesRemoved : [],
              (r) => `v${r.version}${r.description ? ` — ${r.description}` : ''}`
            )}
            {renderChangedRecipes(Array.isArray(diff.recipesChanged) ? diff.recipesChanged : [])}
          </div>
        )}
      </div>
    </div>
  );
}
