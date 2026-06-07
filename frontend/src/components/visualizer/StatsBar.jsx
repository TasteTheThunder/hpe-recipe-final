import T from '../../theme';

export default function StatsBar({ release }) {
  if (!release) return null;
  const recipeCount = release.recipes?.length || 0;
  const compCount = release.recipes?.reduce((s, r) => s + Object.keys(r.components || {}).length, 0) || 0;
  const pathCount = release.recipes?.reduce((s, r) => s + (r.upgrade_to?.length || 0), 0) || 0;
  const catalogName = release.catalogName || release.catalog_name;
  const catalogStatus = release.catalogStatus || release.catalog_status;

  const stats = [
    { label: 'Recipes', value: recipeCount, color: T.teal },
    { label: 'Components', value: compCount, color: T.blue },
    { label: 'Upgrade Paths', value: pathCount, color: T.yellow },
    { label: 'Status', value: release.status, color: release.status === 'deployed' ? T.teal : T.red },
  ];

  if (catalogName) {
    stats.push({ label: 'Catalog', value: catalogName, color: T.blue });
  }
  if (catalogStatus) {
    stats.push({ label: 'Catalog Status', value: catalogStatus, color: T.teal });
  }

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 24px',
      background: T.bgCard, borderBottom: `1px solid ${T.border}`,
    }}>
      {stats.map((s) => (
        <div key={s.label} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 14px', borderRadius: 8,
          background: T.bgSurface, border: `1px solid ${T.border}`,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
          <span style={{ fontSize: 12, color: T.textMuted }}>{s.label}:</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}
