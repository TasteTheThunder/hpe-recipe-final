import T from '../../theme';
import { getCompTheme } from './compThemes';

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));
const readUpgradeList = (spec, key) => {
  if (!spec || typeof spec !== 'object') return [];
  const raw = spec[key];
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

export default function DetailPanel({ recipe, helmVersion, allRecipes, onClose }) {
  if (!recipe) return null;
  const comps = recipe.components ? Object.entries(recipe.components) : [];
  const explicitFrom = Array.isArray(recipe?.upgrade_from) ? recipe.upgrade_from.filter(Boolean) : [];
  const fromPaths = explicitFrom.length > 0
    ? explicitFrom
    : allRecipes
      .filter((r) => Array.isArray(r?.upgrade_to) && r.upgrade_to.includes(recipe.version))
      .map((r) => r.version)
      .filter(Boolean);
  const toPaths = Array.isArray(recipe.upgrade_to) ? recipe.upgrade_to : [];

  return (
    <div style={{
      width: 340, background: T.bgCard, borderLeft: `1px solid ${T.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
      boxShadow: '-10px 0 30px rgba(0,0,0,0.3)',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Recipe Details
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.teal }}>v{recipe.version}</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{recipe.description}</div>
          {(recipe.release_date || recipe.status) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {recipe.release_date && (
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: `${T.blue}15`, color: T.blue,
                }}>{recipe.release_date}</span>
              )}
              {recipe.status && (
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: `${T.teal}18`, color: T.teal,
                }}>{recipe.status}</span>
              )}
            </div>
          )}
          {recipe.release_notes && (
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
              {recipe.release_notes}
            </div>
          )}
        </div>
        <button onClick={onClose} style={{
          background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 6,
          color: T.textMuted, width: 28, height: 28, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* Helm version badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 6,
          background: T.bgSurface, border: `1px solid ${T.border}`,
          fontSize: 11, color: T.textMuted, marginBottom: 16,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.teal }} />
          Helm Chart {helmVersion}
        </div>

        {/* Components */}
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Components ({comps.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {comps.map(([name, spec], i) => {
            const theme = getCompTheme(name, i);
            const ver = readVersion(spec);
            const compReleaseDate = spec?.release_date || '';

            const explicitPrev = readUpgradeList(spec, 'upgrade_from');
            const explicitNext = readUpgradeList(spec, 'upgrade_to');

            // Find unique previous versions for this component
            const prevVers = fromPaths.map((pv) => {
              const pr = allRecipes.find((r) => r.version === pv);
              return readVersion(pr?.components?.[name]);
            }).filter((v) => v && v !== ver);
            const derivedPrev = [...new Set(prevVers)];
            const uniquePrev = explicitPrev.length > 0
              ? explicitPrev.filter((v) => v !== ver)
              : derivedPrev;

            // Find unique next versions
            const nextVers = toPaths.map((tv) => {
              const tr = allRecipes.find((r) => r.version === tv);
              return readVersion(tr?.components?.[name]);
            }).filter((v) => v && v !== ver);
            const derivedNext = [...new Set(nextVers)];
            const uniqueNext = explicitNext.length > 0
              ? explicitNext.filter((v) => v !== ver)
              : derivedNext;

            return (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: T.bgSurface, border: `1px solid ${T.border}`,
                borderRadius: 10, padding: '10px 14px',
                borderLeft: `3px solid ${theme.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{theme.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text, textTransform: 'capitalize' }}>{name}</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: theme.color,
                        background: theme.bg, padding: '2px 8px', borderRadius: 4,
                      }}>{ver}</span>
                    </div>
                    {(uniquePrev.length > 0 || uniqueNext.length > 0) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {uniquePrev.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, color: T.textMuted, minWidth: 40 }}>From</span>
                            {uniquePrev.map((p) => (
                              <span key={`from-${name}-${p}`} style={{
                                fontSize: 10, fontWeight: 700, color: T.blue,
                                background: `${T.blue}18`, padding: '2px 6px', borderRadius: 4,
                              }}>v{p}</span>
                            ))}
                          </div>
                        )}
                        {uniqueNext.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 10, color: T.textMuted, minWidth: 40 }}>To</span>
                            {uniqueNext.map((p) => (
                              <span key={`to-${name}-${p}`} style={{
                                fontSize: 10, fontWeight: 700, color: T.yellow,
                                background: `${T.yellow}18`, padding: '2px 6px', borderRadius: 4,
                              }}>v{p}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {compReleaseDate && (
                      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                        Released {compReleaseDate}
                      </div>
                    )}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: T.textMuted }} />
              </div>
            );
          })}
        </div>

        {/* Upgrade Paths (From) */}
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Upgrade From
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {fromPaths.length > 0 ? fromPaths.map((p) => (
            <div key={p} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '8px 14px', fontSize: 13,
            }}>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: 'rgba(88,166,255,0.1)', color: T.blue,
              }}>v{p}</span>
              <span style={{ color: T.teal, fontSize: 14 }}>→</span>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: `${T.teal}18`, color: T.teal,
              }}>v{recipe.version}</span>
            </div>
          )) : (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: T.bgSurface, border: `1px solid ${T.border}`,
              fontSize: 12, color: T.textMuted, textAlign: 'center', borderStyle: 'dashed'
            }}>No upgrade source</div>
          )}
        </div>

        {/* Upgrade Paths (To) */}
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          Upgrade To
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {toPaths.length > 0 ? toPaths.map((p) => (
            <div key={p} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: '8px 14px', fontSize: 13,
            }}>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: `${T.teal}18`, color: T.teal,
              }}>v{recipe.version}</span>
              <span style={{ color: T.teal, fontSize: 14 }}>→</span>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                background: 'rgba(210,153,34,0.1)', color: T.yellow,
              }}>v{p}</span>
            </div>
          )) : (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: T.bgSurface, border: `1px solid ${T.border}`,
              fontSize: 12, color: T.textMuted, textAlign: 'center', borderStyle: 'dashed'
            }}>Latest version</div>
          )}
        </div>
      </div>
    </div>
  );
}
