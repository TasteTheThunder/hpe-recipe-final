import { useState, useEffect } from 'react';
import T from '../../theme';
import {
  btnPrimary,
  btnDanger,
  btnSecondary,
  cardStyle,
  labelStyle,
} from '../../ui/styles';
import DeployPreviewModal from './DeployPreviewModal';
import {
  normalizeRecipeDescription,
  getRecipeUpgradeFrom,
  getRecipeUpgradeTo,
  getEnvironmentActions,
} from './utils';

const API_BASE = '/api';

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));

export default function ReleaseCard({ release, onDeploy, onRollback, onEditCatalog, cluster, onRefresh, onNotify }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showDeployPreview, setShowDeployPreview] = useState(false);
  const [promotion, setPromotion] = useState(null);

  const fetchDetail = () => {
    return fetch(`${API_BASE}/helm-releases/${release.version}?cluster=${cluster}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data);
        return data;
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (expanded) {
      fetchDetail();
    }
  }, [expanded, release.version, cluster]);

  useEffect(() => {
    fetch(`${API_BASE}/versions/${release.version}/promotion-options`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPromotion(data))
      .catch(() => setPromotion(null));
  }, [release.version, release.status]);

  const handleDeleteRelease = () => {
    if (!window.confirm(
      `Delete catalog version ${release.version}?\n\n`
      + 'This removes the version from Git and runs "helm uninstall" in every environment '
      + 'currently running it. This cannot be undone.')) return;
    fetch(`${API_BASE}/versions/${release.version}`, { method: 'DELETE' })
      .then(async (r) => {
        if (!r.ok) {
          let payload = {};
          try { payload = await r.json(); } catch { payload = {}; }
          throw new Error(payload.error || 'Failed to delete');
        }
        onNotify('Version deleted; uninstalling from affected environments');
        onRefresh();
      })
      .catch((err) => onNotify(err.message, true));
  };

  const recipes = detail?.recipes || [];
  const displayStatus = detail?.status || release.status;
  const displayReleaseName = detail?.releaseName || release.releaseName;
  const statusColor = displayStatus === 'deployed' ? T.green
    : displayStatus === 'failed' || displayStatus === 'push_failed' ? T.red
    : displayStatus === 'deploying' ? T.blue
    : T.yellow;

  const handleDeploy = () => {
    setShowDeployPreview(true);
  };

  const pipeline = promotion?.pipeline || ['dev', 'qa', 'integration', 'prod'];
  const deployedOn = promotion?.deployedOn || {};
  const { promoteTarget, rollbackTarget } = getEnvironmentActions(pipeline, cluster, promotion);
  const promoteLabel = promoteTarget ? `Promote to ${promoteTarget.toUpperCase()}` : '';
  // Editing is DEV-only, and only on the version currently live on DEV (the dev catalog).
  const devStage = pipeline[0];
  const isDevCatalog = cluster === devStage && Boolean(deployedOn[devStage]);

  const handleEditCatalog = async () => {
    const source = detail || (await fetchDetail()) || release;
    if (onEditCatalog) onEditCatalog(source);
  };

  const handleConfirmDeploy = (version) => onDeploy(version, promoteTarget);

  return (
    <div style={{
      ...cardStyle,
      borderLeft: `3px solid ${statusColor}`,
      transition: 'all 0.2s',
    }}>
      {/* Release header */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
        alignItems: 'center', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', flex: '1 1 auto', minWidth: 0 }}
          onClick={() => setExpanded(!expanded)}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: `linear-gradient(135deg, ${T.teal}, ${T.tealDark})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: T.white, fontWeight: 800,
          }}>
            v{release.version}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
              Helm Chart {release.version}
            </div>
            <div style={{ fontSize: 13, color: T.textMuted, marginTop: 2 }}>
              {displayReleaseName}
              <span style={{
                marginLeft: 10, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                background: `${statusColor}18`, color: statusColor,
              }}>{displayStatus}</span>
            </div>
            {promotion && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {pipeline.map((stage) => {
                  const onStage = deployedOn[stage];
                  return (
                    <span
                      key={`${release.version}-${stage}`}
                      style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: onStage ? `${T.green}18` : T.bgSurface,
                        color: onStage ? T.green : T.textMuted,
                        border: `1px solid ${onStage ? T.green : T.border}44`,
                      }}
                    >
                      {stage.toUpperCase()}{onStage ? ' ✓' : ''}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <span style={{
            marginLeft: 'auto', fontSize: 18, color: T.textMuted,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>▼</span>
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
          alignItems: 'center', gap: 8,
        }}>
          {isDevCatalog && (
            <button onClick={handleEditCatalog} style={{
              ...btnSecondary, padding: '6px 14px', fontSize: 12,
            }}>Edit Catalog</button>
          )}
          {displayStatus !== 'deploying' && promoteTarget && (
            <>
              <button onClick={handleDeploy} style={{
                ...btnSecondary, padding: '6px 14px', fontSize: 12,
              }}>Preview</button>
              <button
                onClick={handleDeploy}
                style={{
                  ...btnPrimary, padding: '6px 14px', fontSize: 12,
                }}
                title={promoteLabel}
              >
                {promoteLabel}
              </button>
            </>
          )}
          {displayStatus === 'deploying' && (
            <span style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: `${T.blue}18`, color: T.blue, border: `1px solid ${T.blue}44`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: T.blue,
                animation: 'pulse 1s infinite',
              }} />
              Deploying...
              <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
            </span>
          )}
          {rollbackTarget && (
            <button
              onClick={() => onRollback && onRollback(rollbackTarget)}
              style={{ ...btnSecondary, padding: '6px 14px', fontSize: 12 }}
              title={`Roll ${rollbackTarget.toUpperCase()} back to its previous version`}
            >
              Rollback {rollbackTarget.toUpperCase()}
            </button>
          )}
          <button onClick={handleDeleteRelease} style={{ ...btnDanger, padding: '6px 14px', fontSize: 12, borderRadius: 8 }}>Delete</button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}` }}>
          {/* Recipes list */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={labelStyle}>Recipes ({recipes.length})</span>
            <span style={{ fontSize: 11, color: T.textMuted }}>
              Add only during release creation
            </span>
          </div>

          {recipes.length === 0 && (
            <div style={{
              padding: '20px', borderRadius: 8, background: T.bgSurface,
              border: `1px dashed ${T.border}`, textAlign: 'center',
              color: T.textMuted, fontSize: 13,
            }}>
              This release has no recipes. Create releases with recipes from the top form.
            </div>
          )}

          {recipes.map((recipe) => (
            (() => {
              const fromPaths = getRecipeUpgradeFrom(recipes, recipe);
              const toPaths = getRecipeUpgradeTo(recipe);
              return (
            <div key={recipe.version} style={{
              background: T.bgSurface, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: 16, marginBottom: 10,
            }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.teal }}>
                        Recipe v{recipe.version}
                      </div>
                      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                        {normalizeRecipeDescription(recipe.description, recipe.version)}
                      </div>
                      {(recipe.release_date || recipe.status) && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          {recipe.release_date && (
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                              background: `${T.blue}15`, color: T.blue,
                            }}>{recipe.release_date}</span>
                          )}
                          {recipe.status && (
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
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
                    {/* Recipes are edited via the DEV "Edit Catalog" editor (forks a new version). */}
                  </div>

                  {/* Components grid */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                    {Object.entries(recipe.components || {}).map(([name, spec]) => {
                      const ver = readVersion(spec);
                      const fromPaths = getRecipeUpgradeFrom(recipes, recipe);
                      const toPaths = getRecipeUpgradeTo(recipe);

                      const prevVers = fromPaths.map((pv) => {
                        const pr = recipes.find((r) => r.version === pv);
                        return readVersion(pr?.components?.[name]);
                      }).filter((v) => v && v !== ver);
                      const uniquePrev = [...new Set(prevVers)];

                      const nextVers = toPaths.map((tv) => {
                        const tr = recipes.find((r) => r.version === tv);
                        return readVersion(tr?.components?.[name]);
                      }).filter((v) => v && v !== ver);
                      const uniqueNext = [...new Set(nextVers)];

                      return (
                        <div key={name} style={{
                          padding: '6px 12px', borderRadius: 6,
                          background: T.bgCard, border: `1px solid ${T.border}`,
                          fontSize: 12,
                        }}>
                          <span style={{ color: T.textMuted, textTransform: 'capitalize' }}>{name}</span>
                          <span style={{ color: T.teal, fontWeight: 600, marginLeft: 6 }}>
                            {uniquePrev.length > 0 && <span style={{ color: T.textMuted, fontWeight: 400 }}>{uniquePrev.join(', ')} → </span>}
                            {ver}
                            {uniqueNext.length > 0 && <span style={{ color: T.textMuted, fontWeight: 400 }}> → {uniqueNext.join(', ')}</span>}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Upgrade paths info */}
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {fromPaths.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: T.textMuted }}>Upgrades from:</span>
                        {fromPaths.map((p) => (
                          <span key={p} style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: `${T.blue}15`, color: T.blue,
                          }}>v{p}</span>
                        ))}
                      </div>
                    )}
                    {toPaths.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: T.textMuted }}>Upgrades to:</span>
                        {toPaths.map((p) => (
                          <span key={p} style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: `${T.yellow}15`, color: T.yellow,
                          }}>v{p}</span>
                        ))}
                      </div>
                    )}
                  </div>
            </div>
              );
            })()
          ))}
        </div>
      )}
      {showDeployPreview && (
        <DeployPreviewModal
          version={release.version}
          cluster={promoteTarget}
          onClose={() => setShowDeployPreview(false)}
          onConfirm={handleConfirmDeploy}
        />
      )}
    </div>
  );
}
