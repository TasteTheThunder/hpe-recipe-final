import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import T from './theme';
import { btnSecondary, cardStyle } from './ui/styles';

const API_BASE = '/api';

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedClusters = ['dev', 'prod', 'qa', 'integration'];
  const initialCluster = allowedClusters.includes(searchParams.get('cluster'))
    ? searchParams.get('cluster')
    : 'dev';
  const [cluster, setCluster] = useState(initialCluster);
  const [catalogs, setCatalogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get('cluster'))
      ? searchParams.get('cluster')
      : 'dev';
    setCluster((prev) => (prev === urlCluster ? prev : urlCluster));
  }, [searchParams]);

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get('cluster'))
      ? searchParams.get('cluster')
      : 'dev';
    if (urlCluster !== cluster) {
      const next = new URLSearchParams(searchParams);
      next.set('cluster', cluster);
      setSearchParams(next, { replace: true });
    }
  }, [cluster, searchParams, setSearchParams, allowedClusters]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/catalogs?cluster=${cluster}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => setCatalogs(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load catalogs. Is the backend running?'))
      .finally(() => setLoading(false));
  }, [cluster]);

  return (
    <div style={{
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      minHeight: '100vh', background: T.bg, color: T.text,
    }}>
      <header style={{
        background: T.bgCard, borderBottom: `1px solid ${T.border}`,
        padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${T.teal}, ${T.tealDark})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: T.white, fontWeight: 800,
          }}>H</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
              Catalogs
            </h1>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
              Cluster-specific Helm catalogs
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={cluster} onChange={(e) => setCluster(e.target.value)} style={{
            ...btnSecondary,
            padding: '7px 10px',
          }}>
            <option value="dev">DEV</option>
            <option value="prod">PROD</option>
            <option value="qa">QA</option>
            <option value="integration">INTEGRATION</option>
          </select>
          <span style={{ fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap' }}>
            Cluster: {cluster.toUpperCase()}
          </span>
          <Link to={`/?cluster=${cluster}`} style={{
            ...btnSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ← Visualizer
          </Link>
          <Link to={`/manage?cluster=${cluster}`} style={{
            ...btnSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            Manage
          </Link>
        </div>
      </header>

      {error && (
        <div style={{
          background: `${T.red}15`, color: T.red,
          padding: '10px 24px', fontSize: 13, borderBottom: `1px solid ${T.red}33`,
        }}>{error}</div>
      )}

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
            Catalogs
          </h2>
          <span style={{
            padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            background: `${T.teal}18`, color: T.teal,
          }}>{catalogs.length}</span>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>Loading...</div>
        )}

        {!loading && catalogs.length === 0 && (
          <div style={{
            ...cardStyle, textAlign: 'center', padding: 40,
            border: `1px dashed ${T.border}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 6 }}>
              No catalogs for {cluster.toUpperCase()}
            </div>
            <div style={{ fontSize: 13, color: T.textMuted }}>
              Deploy a release to see it appear here.
            </div>
          </div>
        )}

        {!loading && (
          <>
            <div
              className="catalog-grid"
              style={{
                display: 'grid',
                gap: 24,
                alignItems: 'stretch',
                marginBottom: 24,
              }}
            >
            {catalogs.map((cat) => {
              // Metadata: cluster, total components, last updated (mocked for now)
              const totalComponents = (cat.recipes || []).reduce((acc, r) => acc + (r.components ? Object.keys(r.components).length : 0), 0);
              // TODO: Replace with real last updated if available
              const lastUpdated = 'Updated 2h ago';
              const catalogTitle = cat.catalogName || cat.catalog_name || cat.name || `Cluster ${cluster.toUpperCase()} Catalog`;
              const rawStatus = cat.catalogStatus || cat.catalog_status || '';
              const catalogStatus = rawStatus.trim() ? rawStatus : '';
              const catalogMaintainer = cat.maintainer || '';
              const catalogDescription = cat.catalogDescription || cat.catalog_description || '';
              const catalogReleaseDate = cat.catalogReleaseDate || cat.release_date || '';
              const releaseName = cat.releaseName || '';
              const formattedCatalogDate = (() => {
                if (!catalogReleaseDate) return '';
                const parsed = new Date(catalogReleaseDate);
                if (Number.isNaN(parsed.getTime())) return catalogReleaseDate;
                return new Intl.DateTimeFormat('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }).format(parsed);
              })();
              const statusColor = catalogStatus === 'GA'
                ? T.green
                : catalogStatus === 'Beta'
                  ? T.yellow
                  : catalogStatus === 'Deprecated'
                    ? T.red
                    : T.blue;
              return (
                <div
                  key={cat.version}
                  style={{
                    ...cardStyle,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 280,
                    height: 'auto',
                    boxShadow: '0 2px 12px 0 rgba(0,0,0,0.10)',
                    transition: 'box-shadow 0.2s, border 0.2s, transform 0.2s',
                    padding: 22,
                    gap: 0,
                    marginBottom: 0,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.boxShadow = '0 4px 16px 0 rgba(0,255,255,0.06)';
                    e.currentTarget.style.border = `1.5px solid ${T.teal}77`;
                    e.currentTarget.style.transform = 'translateY(-1.5px)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = '0 2px 12px 0 rgba(0,0,0,0.10)';
                    e.currentTarget.style.border = `1px solid ${T.border}`;
                    e.currentTarget.style.transform = 'none';
                  }}
                >
                  {/* Card Content */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: T.teal }}>
                        {catalogTitle}
                      </div>
                      {catalogStatus && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                          background: `${statusColor}18`, color: statusColor,
                        }}>
                          {catalogStatus}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, color: T.textDim }}>Version:</span>{' '}
                      {cat.version}
                    </div>
                    {releaseName && (
                      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>
                        {releaseName}
                      </div>
                    )}
                    {catalogMaintainer && (
                      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, color: T.textDim }}>Maintainer:</span>{' '}
                        {catalogMaintainer}
                      </div>
                    )}
                    {catalogDescription && (
                      <div style={{
                        fontSize: 12,
                        color: T.textMuted,
                        marginBottom: 8,
                        lineHeight: 1.4,
                      }}>
                        <span style={{ fontWeight: 700, color: T.textDim }}>Description:</span>{' '}
                        {catalogDescription}
                      </div>
                    )}
                    {formattedCatalogDate && (
                      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, color: T.textDim }}>Released:</span>{' '}
                        {formattedCatalogDate}
                      </div>
                    )}
                    {/* Metadata */}
                    <div style={{
                      fontSize: 10.5,
                      color: T.textMuted,
                      marginBottom: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'nowrap',
                      whiteSpace: 'nowrap',
                      opacity: 0.7,
                      fontWeight: 400,
                    }}>
                      <span>{cluster.toUpperCase()} Cluster</span>
                      <span style={{ fontSize: 13, color: T.textDim }}>•</span>
                      <span>{totalComponents} Components</span>
                      <span style={{ fontSize: 13, color: T.textDim }}>•</span>
                      <span>{lastUpdated}</span>
                    </div>
                    <div style={{
                      padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: `${T.blue}18`, color: T.blue, whiteSpace: 'nowrap',
                      marginBottom: 10,
                      alignSelf: 'flex-start',
                    }}>
                      {(cat.recipes || []).length} recipes
                    </div>
                    {(cat.recipes || []).length > 0 && (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 8,
                        maxHeight: 120, overflowY: 'auto', paddingRight: 2,
                        marginBottom: 14,
                      }}>
                        {(cat.recipes || []).map((r) => (
                          <div
                            key={r.version}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '8px 12px', borderRadius: 8,
                              background: T.bgSurface,
                              border: `1px solid ${T.border}`,
                              fontSize: 12,
                              transition: 'background 0.18s, border 0.18s, box-shadow 0.18s',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = T.bgCard;
                              e.currentTarget.style.border = `1.5px solid ${T.teal}77`;
                              e.currentTarget.style.boxShadow = '0 2px 8px 0 rgba(0,255,255,0.04)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = T.bgSurface;
                              e.currentTarget.style.border = `1px solid ${T.border}`;
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            <span style={{ color: T.text }}>Recipe v{r.version}</span>
                            <span style={{ color: T.textMuted }}>
                              {(r.components && Object.keys(r.components).length) || 0} components
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Button always at bottom */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      marginTop: 'auto',
                    }}
                  >
                    <Link
                      to={`/?cluster=${cluster}&version=${cat.version}`}
                      style={{
                        ...btnSecondary,
                        textDecoration: 'none',
                        padding: '10px 22px',
                        fontSize: 13,
                        fontWeight: 700,
                        border: `1.5px solid ${T.teal}77`,
                        color: T.teal,
                        background: `${T.bgSurface}`,
                        boxShadow: 'none',
                        transition: 'background 0.18s, color 0.18s, border 0.18s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = `${T.teal}18`;
                        e.currentTarget.style.color = T.white;
                        e.currentTarget.style.border = `1.5px solid ${T.teal}`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = `${T.bgSurface}`;
                        e.currentTarget.style.color = T.teal;
                        e.currentTarget.style.border = `1.5px solid ${T.teal}77`;
                      }}
                    >
                      View Catalog
                    </Link>
                  </div>
                </div>
              );
            })}
            </div>
            <style>{`
              .catalog-grid { grid-template-columns: repeat(1, minmax(0, 1fr)); }
              @media (min-width: 768px) {
                .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
              }
              @media (min-width: 1200px) {
                .catalog-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
              }
            `}</style>
          </>
        )}
      </div>
    </div>
  );
}
