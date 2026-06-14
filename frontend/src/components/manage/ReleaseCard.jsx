import { useState, useEffect } from 'react';
import T from '../../theme';
import {
  btnPrimary,
  btnDanger,
  btnSecondary,
  cardStyle,
  labelStyle,
  inputStyle,
} from '../../ui/styles';
import EditRecipeInline from './EditRecipeInline';
import DeployPreviewModal from './DeployPreviewModal';
import { normalizeRecipeDescription, getRecipeUpgradeFrom, getRecipeUpgradeTo } from './utils';

const API_BASE = '/api';

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));

export default function ReleaseCard({ release, onDeploy, onRollback, onEditCatalog, cluster, onRefresh, onNotify }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [editingCatalog, setEditingCatalog] = useState(false);
  const [showDeployPreview, setShowDeployPreview] = useState(false);
  const [promotion, setPromotion] = useState(null);
  const [catalogDraft, setCatalogDraft] = useState({
    releaseName: '',
    catalogName: '',
    catalogDescription: '',
    catalogReleaseDate: '',
    catalogStatus: 'GA',
    maintainer: '',
  });

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
    if (!window.confirm(`Delete Helm release ${release.version}? This removes all its recipes.`)) return;
    fetch(`${API_BASE}/helm-releases/${release.version}?cluster=${cluster}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to delete');
        onNotify('Helm release deleted');
        onRefresh();
      })
      .catch((err) => onNotify(err.message, true));
  };

  const handleDeleteRecipe = (recipeVersion) => {
    if (!window.confirm(`Delete recipe ${recipeVersion} from Helm ${release.version}?`)) return;
    fetch(`${API_BASE}/helm-releases/${release.version}/recipes/${recipeVersion}?cluster=${cluster}`, { method: 'DELETE' })
      .then((r) => {
        if (!r.ok) throw new Error('Failed to delete');
        onNotify('Recipe deleted');
        setDetail(null);
        onRefresh();
      })
      .catch((err) => onNotify(err.message, true));
  };

  const handleUpdateRecipe = (recipeVersion, updates) => {
    fetch(`${API_BASE}/helm-releases/${release.version}/recipes/${recipeVersion}?cluster=${cluster}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
      .then(async (r) => {
        if (!r.ok) {
          let payload = {};
          try { payload = await r.json(); } catch { payload = {}; }
          throw new Error(payload.error || 'Failed to update');
        }
        return r.json();
      })
      .then(() => {
        onNotify('Recipe updated');
        setEditingRecipe(null);
        fetchDetail();
        onRefresh();
      })
      .catch((err) => onNotify(err.message, true));
  };

  const openCatalogEditor = async () => {
    let source = detail;
    if (!source) {
      source = await fetchDetail();
    }
    source = source || detail || release;
    if (!source) return;
    setCatalogDraft({
      releaseName: source.releaseName || '',
      catalogName: source.catalogName || source.catalog_name || '',
      catalogDescription: source.catalogDescription || source.catalog_description || '',
      catalogReleaseDate: source.catalogReleaseDate || source.release_date || '',
      catalogStatus: source.catalogStatus || source.catalog_status || 'GA',
      maintainer: source.maintainer || '',
    });
    setEditingCatalog(true);
  };

  const handleSaveCatalog = () => {
    const source = detail || release;
    if (!source) return;
    const payload = {
      version: source.version,
      releaseName: catalogDraft.releaseName.trim() || source.releaseName,
      status: source.status,
      catalog_name: catalogDraft.catalogName.trim(),
      catalog_description: catalogDraft.catalogDescription.trim(),
      release_date: catalogDraft.catalogReleaseDate,
      catalog_status: catalogDraft.catalogStatus,
      maintainer: catalogDraft.maintainer.trim(),
      recipes: source.recipes || [],
    };

    const optimistic = {
      ...source,
      releaseName: payload.releaseName,
      catalogName: payload.catalog_name,
      catalogDescription: payload.catalog_description,
      catalogReleaseDate: payload.release_date,
      catalogStatus: payload.catalog_status,
      maintainer: payload.maintainer,
    };
    setDetail(optimistic);

    fetch(`${API_BASE}/helm-releases/${release.version}?cluster=${cluster}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) {
          let payloadErr = {};
          try { payloadErr = await r.json(); } catch { payloadErr = {}; }
          throw new Error(payloadErr.error || 'Failed to update catalog');
        }
        return r.json();
      })
      .then((updated) => {
        setDetail(updated);
        setEditingCatalog(false);
        onNotify('Catalog updated successfully. Redeploy required to apply changes.');
        onRefresh();
      })
      .catch((err) => {
        onNotify(err.message, true);
        fetchDetail();
      });
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
  const firstStage = pipeline[0];
  const isDeployedAnywhere = pipeline.some((env) => deployedOn[env]);
  // Forward-only: promote to the backend's nextTarget. If the version isn't deployed anywhere
  // yet, the only forward action is deploying it to the first stage (deploy-to-dev).
  const deployTarget = promotion?.nextTarget || (!isDeployedAnywhere ? firstStage : null);
  const canPromote = Boolean(deployTarget);
  const deployLabel = !deployTarget
    ? 'Promoted'
    : deployTarget === firstStage
      ? `Deploy to ${firstStage.toUpperCase()}`
      : `Promote to ${deployTarget.toUpperCase()}`;
  const canRollback = promotion?.canRollback || {};
  // Environments (past the first stage) where THIS version is live and a previous version exists.
  const rollbackEnvs = pipeline.filter((env, idx) => idx > 0 && deployedOn[env] && canRollback[env]);
  // Editing is DEV-only, and only on the version currently live on DEV (the dev catalog).
  const devStage = pipeline[0];
  const isDevCatalog = cluster === devStage && Boolean(deployedOn[devStage]);

  const handleEditCatalog = async () => {
    const source = detail || (await fetchDetail()) || release;
    if (onEditCatalog) onEditCatalog(source);
  };

  const handleConfirmDeploy = (version) => onDeploy(version, deployTarget);

  return (
    <div style={{
      ...cardStyle,
      borderLeft: `3px solid ${statusColor}`,
      transition: 'all 0.2s',
    }}>
      {/* Release header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', flex: 1 }}
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
        <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
          {isDevCatalog && (
            <button onClick={handleEditCatalog} style={{
              ...btnSecondary, padding: '6px 14px', fontSize: 12,
            }}>Edit Catalog</button>
          )}
          {displayStatus !== 'deploying' && (
            <>
              <button onClick={handleDeploy} style={{
                ...btnSecondary, padding: '6px 14px', fontSize: 12,
              }}>Preview</button>
              <button
                onClick={handleDeploy}
                style={{
                  ...btnPrimary, padding: '6px 14px', fontSize: 12,
                  opacity: canPromote ? 1 : 0.5,
                }}
                disabled={!canPromote}
                title={canPromote ? deployLabel : 'Fully promoted through all clusters'}
              >
                {canPromote ? deployLabel : 'Promoted'}
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
          {rollbackEnvs.map((env) => (
            <button
              key={`rollback-${env}`}
              onClick={() => onRollback && onRollback(env)}
              style={{ ...btnSecondary, padding: '6px 14px', fontSize: 12 }}
              title={`Roll ${env.toUpperCase()} back to its previous version`}
            >
              Rollback {env.toUpperCase()}
            </button>
          ))}
          <button onClick={handleDeleteRelease} style={btnDanger}>Delete</button>
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
              {editingRecipe === recipe.version ? (
                <EditRecipeInline
                  recipe={recipe}
                  allRecipes={recipes}
                  onSave={(updates) => handleUpdateRecipe(recipe.version, updates)}
                  onCancel={() => setEditingRecipe(null)}
                />
              ) : (
                <>
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
                </>
              )}
            </div>
              );
            })()
          ))}
        </div>
      )}
      {editingCatalog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120,
        }} onClick={() => setEditingCatalog(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 16,
            padding: 24, width: 620, maxWidth: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: T.text }}>Edit Catalog</h3>
              <button onClick={() => setEditingCatalog(false)} style={{
                background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 6,
                color: T.textMuted, width: 28, height: 28, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Catalog Name</label>
                <input
                  style={inputStyle}
                  value={catalogDraft.catalogName}
                  onChange={(e) => setCatalogDraft((prev) => ({ ...prev, catalogName: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Catalog Status</label>
                <select
                  style={inputStyle}
                  value={catalogDraft.catalogStatus}
                  onChange={(e) => setCatalogDraft((prev) => ({ ...prev, catalogStatus: e.target.value }))}
                >
                  <option value="GA">GA</option>
                  <option value="Beta">Beta</option>
                  <option value="Deprecated">Deprecated</option>
                  <option value="Internal">Internal</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Release Name</label>
                <input
                  style={{ ...inputStyle, opacity: 0.7 }}
                  value={catalogDraft.releaseName}
                  readOnly
                />
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
                  Auto-generated from chart version
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Release Date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={catalogDraft.catalogReleaseDate}
                  onChange={(e) => setCatalogDraft((prev) => ({ ...prev, catalogReleaseDate: e.target.value }))}
                />
              </div>
              <div>
                <label style={labelStyle}>Maintainer</label>
                <input
                  style={inputStyle}
                  value={catalogDraft.maintainer}
                  onChange={(e) => setCatalogDraft((prev) => ({ ...prev, maintainer: e.target.value }))}
                />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Catalog Description</label>
              <input
                style={inputStyle}
                value={catalogDraft.catalogDescription}
                onChange={(e) => setCatalogDraft((prev) => ({ ...prev, catalogDescription: e.target.value }))}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingCatalog(false)} style={btnSecondary}>Cancel</button>
              <button onClick={handleSaveCatalog} style={btnPrimary}>Save</button>
            </div>
          </div>
        </div>
      )}

      {showDeployPreview && (
        <DeployPreviewModal
          version={release.version}
          cluster={deployTarget}
          onClose={() => setShowDeployPreview(false)}
          onConfirm={handleConfirmDeploy}
        />
      )}
    </div>
  );
}
