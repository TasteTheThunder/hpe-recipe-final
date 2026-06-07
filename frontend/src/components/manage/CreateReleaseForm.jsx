import { useState, useEffect } from 'react';
import T from '../../theme';
import {
  inputStyle,
  btnPrimary,
  btnDanger,
  btnSecondary,
  cardStyle,
  labelStyle,
} from '../../ui/styles';
import { normalizeRecipeDescription, parseUpgradeList, normalizeVersion } from './utils';

const API_BASE = '/api';

const readUpgradeList = (spec, key, fallbackKey) => {
  if (!spec || typeof spec !== 'object') return [];
  const raw = spec[key] || spec[fallbackKey];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') return parseUpgradeList(raw);
  return [];
};

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));

export default function CreateReleaseForm({ cluster, onCreated }) {
  const [version, setVersion] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [catalogName, setCatalogName] = useState('');
  const [catalogDescription, setCatalogDescription] = useState('');
  const [catalogReleaseDate, setCatalogReleaseDate] = useState('');
  const [catalogStatus, setCatalogStatus] = useState('GA');
  const [maintainer, setMaintainer] = useState('');
  const [draftRecipes, setDraftRecipes] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [expandedRecipeIds, setExpandedRecipeIds] = useState([]);
  const [availableReleases, setAvailableReleases] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importReleaseVersion, setImportReleaseVersion] = useState('');
  const [importRecipes, setImportRecipes] = useState([]);
  const [importRecipeVersion, setImportRecipeVersion] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState(null);
  const [sourceRecipesCache, setSourceRecipesCache] = useState({});

  const createEmptyRecipe = () => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '',
    description: '',
    releaseDate: '',
    status: 'GA',
    releaseNotes: '',
    components: [
      {
        name: '',
        version: '',
        releaseDate: '',
        upgradeFrom: '',
        upgradeTo: '',
        versionTouched: false,
        upgradeFromTouched: false,
        upgradeToTouched: false,
      },
    ],
    upgradeFrom: [],
    upgradeTo: [],
    upgradeFromTouched: false,
    upgradeToTouched: false,
    sourceReleaseVersion: '',
    sourceRecipeVersion: '',
    sourceEnabled: false,
  });

  // Auto-generate release name from version
  const autoReleaseName = version.trim()
    ? `recipe-detection-v${version.trim().replace(/\./g, '-')}`
    : '';

  useEffect(() => {
    setImportError(null);
    setImportReleaseVersion('');
    setImportRecipeVersion('');
    setImportRecipes([]);
    fetch(`${API_BASE}/helm-releases?cluster=${cluster}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => setAvailableReleases(Array.isArray(data) ? data : []))
      .catch(() => setAvailableReleases([]));
  }, [cluster]);

  useEffect(() => {
    if (!importReleaseVersion) {
      setImportRecipes([]);
      return;
    }
    setImportLoading(true);
    setImportError(null);
    setImportRecipeVersion('');
    fetch(`${API_BASE}/helm-releases/${importReleaseVersion}?cluster=${cluster}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => setImportRecipes(Array.isArray(data?.recipes) ? data.recipes : []))
      .catch(() => {
        setImportError('Failed to load recipes for the selected release');
        setImportRecipes([]);
      })
      .finally(() => setImportLoading(false));
  }, [importReleaseVersion, cluster]);

  const loadSourceRecipes = (releaseVersion) => {
    if (!releaseVersion) return;
    if (sourceRecipesCache[releaseVersion]?.loaded || sourceRecipesCache[releaseVersion]?.loading) return;

    setSourceRecipesCache((prev) => ({
      ...prev,
      [releaseVersion]: { recipes: [], loading: true, loaded: false, error: null },
    }));

    fetch(`${API_BASE}/helm-releases/${releaseVersion}?cluster=${cluster}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const recipes = Array.isArray(data?.recipes) ? data.recipes : [];
        setSourceRecipesCache((prev) => ({
          ...prev,
          [releaseVersion]: { recipes, loading: false, loaded: true, error: null },
        }));
      })
      .catch(() => {
        setSourceRecipesCache((prev) => ({
          ...prev,
          [releaseVersion]: { recipes: [], loading: false, loaded: true, error: 'Failed to load recipes' },
        }));
      });
  };

  const getSourceRecipeForDraft = (draft) => {
    if (!draft?.sourceEnabled || !draft?.sourceReleaseVersion || !draft?.sourceRecipeVersion) return null;
    const cache = sourceRecipesCache[draft.sourceReleaseVersion];
    if (!cache || !Array.isArray(cache.recipes)) return null;
    return cache.recipes.find((r) => r.version === draft.sourceRecipeVersion) || null;
  };

  const buildSourceComponentInfo = (sourceRecipe) => {
    const map = {};
    Object.entries(sourceRecipe?.components || {}).forEach(([name, spec]) => {
      const version = readVersion(spec);
      const upgradeToList = readUpgradeList(spec, 'upgrade_to', 'upgradeTo');
      const upgradeToFirst = upgradeToList.length > 0 ? upgradeToList[0] : '';
      if (!name || !version) return;
      if (!map[name]) {
        map[name] = { sourceVersion: version, upgradeToFirst, releaseDate: spec?.release_date || '' };
      }
    });
    return map;
  };

  const applySourceRecipesToDraft = (draft, sourceRecipe) => {
    const next = { ...draft };
    if (!next.sourceEnabled || !sourceRecipe) return next;

    if (!next.upgradeFromTouched) {
      next.upgradeFrom = sourceRecipe.version ? [sourceRecipe.version] : [];
    }

    const sourceComponentInfo = buildSourceComponentInfo(sourceRecipe);
    const nextComponents = [...next.components];

    Object.entries(sourceComponentInfo).forEach(([name, info]) => {
      const existing = nextComponents.find((c) => String(c.name || '').trim() === name);
      if (existing) {
        if (!existing.versionTouched && info.upgradeToFirst) {
          existing.version = info.upgradeToFirst;
        }
        if (!existing.upgradeFromTouched) {
          existing.upgradeFrom = info.sourceVersion;
        }
        if (!existing.releaseDate && info.releaseDate) {
          existing.releaseDate = info.releaseDate;
        }
        return;
      }

      nextComponents.push({
        name,
        version: info.upgradeToFirst || '',
        releaseDate: info.releaseDate || '',
        upgradeFrom: info.sourceVersion || '',
        upgradeTo: '',
        versionTouched: false,
        upgradeFromTouched: false,
        upgradeToTouched: false,
      });
    });

    next.components = nextComponents.filter((component) => {
      const isEmpty = !component.name && !component.version && !component.releaseDate
        && !component.upgradeFrom && !component.upgradeTo;
      const isUntouched = !component.versionTouched && !component.upgradeFromTouched && !component.upgradeToTouched;
      return !(isEmpty && isUntouched);
    });

    return next;
  };

  const updateDraftSourceRelease = (recipeId, releaseVersion) => {
    if (releaseVersion) loadSourceRecipes(releaseVersion);
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      const next = {
        ...r,
        sourceReleaseVersion: releaseVersion,
        sourceRecipeVersion: '',
      };
      return applySourceRecipesToDraft(next, null);
    }));
  };

  const updateDraftSourceRecipe = (recipeId, recipeVersion) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      const next = { ...r, sourceRecipeVersion: recipeVersion };
      return applySourceRecipesToDraft(next, getSourceRecipeForDraft(next));
    }));
  };

  useEffect(() => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (!r.sourceReleaseVersion || !r.sourceRecipeVersion) return r;
      const sourceRecipe = getSourceRecipeForDraft(r);
      if (!sourceRecipe) return r;
      return applySourceRecipesToDraft(r, sourceRecipe);
    }));
  }, [sourceRecipesCache]);

  const addRecipeDraft = () => {
    const recipe = createEmptyRecipe();
    setDraftRecipes((prev) => [...prev, recipe]);
    setExpandedRecipeIds((prev) => [...prev, recipe.id]);
  };

  const importRecipeDraft = () => {
    if (!importReleaseVersion || !importRecipeVersion) {
      setImportError('Select a release and recipe to import');
      return;
    }

    const recipe = importRecipes.find((r) => r.version === importRecipeVersion);
    if (!recipe) {
      setImportError('Selected recipe not found');
      return;
    }

    const exists = draftRecipes.some((r) => r.version.trim() === recipe.version);
    if (exists) {
      setImportError(`Recipe version ${recipe.version} already exists in this release`);
      return;
    }

    const components = Object.entries(recipe.components || {}).map(([name, spec]) => ({
      name,
      version: readVersion(spec),
      releaseDate: spec?.release_date || '',
      upgradeFrom: readUpgradeList(spec, 'upgrade_from', 'upgradeFrom').join(', '),
      upgradeTo: readUpgradeList(spec, 'upgrade_to', 'upgradeTo').join(', '),
      versionTouched: false,
      upgradeFromTouched: false,
      upgradeToTouched: false,
    }));

    const imported = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      version: recipe.version || '',
      description: recipe.description || '',
      releaseDate: recipe.release_date || '',
      status: recipe.status || 'GA',
      releaseNotes: recipe.release_notes || '',
      components: components.length > 0 ? components : [
        {
          name: '',
          version: '',
          releaseDate: '',
          upgradeFrom: '',
          upgradeTo: '',
          versionTouched: false,
          upgradeFromTouched: false,
          upgradeToTouched: false,
        },
      ],
      upgradeFrom: Array.isArray(recipe.upgrade_from) ? [...recipe.upgrade_from] : [],
      upgradeTo: Array.isArray(recipe.upgrade_to) ? [...recipe.upgrade_to] : [],
      upgradeFromTouched: false,
      upgradeToTouched: false,
      sourceReleaseVersion: '',
      sourceRecipeVersion: '',
      sourceEnabled: false,
    };

    setDraftRecipes((prev) => [...prev, imported]);
    setExpandedRecipeIds((prev) => [...prev, imported.id]);
    setImportError(null);
  };

  const removeRecipeDraft = (id) => {
    setDraftRecipes((prev) => prev.filter((r) => r.id !== id));
    setExpandedRecipeIds((prev) => prev.filter((rid) => rid !== id));
  };

  const toggleRecipeDraftExpanded = (id) => {
    setExpandedRecipeIds((prev) => (
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    ));
  };

  const updateRecipeDraft = (id, field, value) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: value };
      if (field === 'upgradeFrom') next.upgradeFromTouched = true;
      if (field === 'upgradeTo') next.upgradeToTouched = true;
      return applySourceRecipesToDraft(next, getSourceRecipeForDraft(next));
    }));
  };

  const updateDraftComponent = (recipeId, index, field, value) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      const next = [...r.components];
      const updated = { ...next[index], [field]: value };
      if (field === 'version') updated.versionTouched = true;
      if (field === 'upgradeFrom') updated.upgradeFromTouched = true;
      if (field === 'upgradeTo') updated.upgradeToTouched = true;
      next[index] = updated;
      const nextRecipe = { ...r, components: next };
      return applySourceRecipesToDraft(nextRecipe, getSourceRecipeForDraft(nextRecipe));
    }));
  };

  const addDraftComponent = (recipeId) => {
    setDraftRecipes((prev) => prev.map((r) => (
      r.id === recipeId
        ? {
          ...r,
          components: [...r.components, {
            name: '',
            version: '',
            releaseDate: '',
            upgradeFrom: '',
            upgradeTo: '',
            versionTouched: false,
            upgradeFromTouched: false,
            upgradeToTouched: false,
          }],
        }
        : r
    )));
  };

  const removeDraftComponent = (recipeId, index) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      return { ...r, components: r.components.filter((_, i) => i !== index) };
    }));
  };

  const toggleDraftUpgradeTo = (recipeId, toVersion) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      const base = r.upgradeTo || [];
      const exists = base.includes(toVersion);
      return {
        ...r,
        upgradeTo: exists ? base.filter((v) => v !== toVersion) : [...base, toVersion],
        upgradeToTouched: true,
      };
    }));
  };

  const toggleDraftUpgradeFrom = (recipeId, fromVersion) => {
    setDraftRecipes((prev) => prev.map((r) => {
      if (r.id !== recipeId) return r;
      const base = r.upgradeFrom || [];
      const exists = base.includes(fromVersion);
      return {
        ...r,
        upgradeFrom: exists ? base.filter((v) => v !== fromVersion) : [...base, fromVersion],
        upgradeFromTouched: true,
      };
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!version.trim()) return;

    const typedDrafts = draftRecipes.filter((r) => r.version.trim());
    if (typedDrafts.length === 0) {
      onCreated('At least one recipe is required', true);
      return;
    }

    const draftVersions = typedDrafts.map((r) => normalizeVersion(r.version));
    const duplicateVersion = draftVersions.find((v, i) => draftVersions.indexOf(v) !== i);

    if (duplicateVersion) {
      onCreated(`Duplicate recipe version in draft: ${duplicateVersion}`, true);
      return;
    }

    const recipesPayload = [];
    for (let idx = 0; idx < typedDrafts.length; idx += 1) {
      const recipe = typedDrafts[idx];
      const recipeVersion = normalizeVersion(recipe.version);
      const compMap = {};
      recipe.components.forEach((c) => {
        if (c.name.trim() && c.version.trim()) {
          const compName = c.name.trim();
          const fromList = parseUpgradeList(c.upgradeFrom);
          const toList = parseUpgradeList(c.upgradeTo);
          compMap[compName] = {
            version: c.version.trim(),
            ...(c.releaseDate.trim() ? { release_date: c.releaseDate.trim() } : {}),
            upgrade_from: fromList,
            upgrade_to: toList,
          };
        }
      });

      if (Object.keys(compMap).length === 0) {
        onCreated(`Recipe ${recipeVersion} must have at least one component`, true);
        return;
      }

      const explicitUpgradeFrom = recipe.upgradeFrom
        .map((p) => normalizeVersion(p))
        .filter((p) => Boolean(p) && p !== recipeVersion);
      const explicitUpgradeTo = recipe.upgradeTo
        .map((p) => normalizeVersion(p))
        .filter((p) => Boolean(p) && p !== recipeVersion);

      recipesPayload.push({
        version: recipeVersion,
        description: normalizeRecipeDescription(recipe.description, recipeVersion),
        ...(recipe.releaseDate.trim() ? { release_date: recipe.releaseDate.trim() } : {}),
        ...(recipe.status.trim() ? { status: recipe.status.trim() } : {}),
        ...(recipe.releaseNotes.trim() ? { release_notes: recipe.releaseNotes.trim() } : {}),
        components: compMap,
        upgrade_from: explicitUpgradeFrom,
        upgrade_to: explicitUpgradeTo,
      });
    }

    setSubmitting(true);
    fetch(`${API_BASE}/helm-releases?cluster=${cluster}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: version.trim(),
        releaseName: releaseName.trim() || autoReleaseName,
        status: 'pending',
        catalog_name: catalogName.trim(),
        catalog_description: catalogDescription.trim(),
        release_date: catalogReleaseDate,
        catalog_status: catalogStatus,
        maintainer: maintainer.trim(),
        recipes: recipesPayload,
      }),
    })
      .then(async (r) => {
        if (r.status === 409) throw new Error('Version already exists');
        if (!r.ok) {
          let payload = {};
          try { payload = await r.json(); } catch { payload = {}; }
          throw new Error(payload.error || 'Failed to create');
        }
        return r.json();
      })
      .then(() => {
        setVersion(''); setReleaseName('');
        setCatalogName('');
        setCatalogDescription('');
        setCatalogReleaseDate('');
        setCatalogStatus('GA');
        setMaintainer('');
        setDraftRecipes([]);
        setExpandedRecipeIds([]);
        onCreated(`Helm release created with ${recipesPayload.length} recipe${recipesPayload.length > 1 ? 's' : ''}`);
      })
      .catch((err) => onCreated(err.message, true))
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={handleSubmit} style={cardStyle}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16, color: T.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.teal }} />
        New Helm Release
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Chart Version</label>
          <input style={inputStyle} placeholder="e.g. 0.0.4" value={version}
            onChange={(e) => setVersion(e.target.value)} required />
        </div>
        <div>
          <label style={labelStyle}>Catalog Name</label>
          <input
            style={inputStyle}
            placeholder="e.g. HPE Analytics Runtime"
            value={catalogName}
            onChange={(e) => setCatalogName(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Catalog Status</label>
          <select style={inputStyle} value={catalogStatus} onChange={(e) => setCatalogStatus(e.target.value)}>
            <option value="GA">GA</option>
            <option value="Beta">Beta</option>
            <option value="Deprecated">Deprecated</option>
            <option value="Internal">Internal</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Release Date</label>
          <input
            style={inputStyle}
            type="date"
            value={catalogReleaseDate}
            onChange={(e) => setCatalogReleaseDate(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Maintainer</label>
          <input
            style={inputStyle}
            placeholder="e.g. HPE DevOps Team"
            value={maintainer}
            onChange={(e) => setMaintainer(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Release Name</label>
          <input style={inputStyle} placeholder={autoReleaseName || 'e.g. recipe-detection-v4'}
            value={releaseName} onChange={(e) => setReleaseName(e.target.value)} />
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
            Auto-generated if empty
          </div>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Catalog Description</label>
        <input
          style={inputStyle}
          placeholder="e.g. Enterprise analytics and streaming platform catalog"
          value={catalogDescription}
          onChange={(e) => setCatalogDescription(e.target.value)}
        />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 8,
          background: `${T.yellow}12`, border: `1px solid ${T.yellow}33`,
          fontSize: 12, color: T.yellow,
        }}>
          <span>⏳</span>
          Status is set automatically — "pending" on creation, "deployed" after Jenkins/Helm deploys successfully
        </div>
      </div>

      <div style={{
        borderRadius: 10,
        padding: 14,
        marginBottom: 16,
        border: `1px solid ${T.blue}55`,
        background: `${T.blue}10`,
      }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.blue }}>
                  Recipes
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={addRecipeDraft} style={{ ...btnSecondary, fontSize: 11, padding: '6px 12px' }}>
                + Create New Recipe
              </button>
              <button type="button" onClick={() => setImportOpen((prev) => !prev)} style={{ ...btnSecondary, fontSize: 11, padding: '6px 12px' }}>
                + Import Existing Recipe
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>
                Add at least one recipe version with components.
          </div>

          {importOpen && (
            <div style={{
              border: `1px solid ${T.border}`,
              background: T.bgCard,
              borderRadius: 10,
              padding: 12,
              marginBottom: 12,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 10, alignItems: 'end' }}>
                <div>
                  <label style={labelStyle}>Source Helm Release</label>
                  <select
                    style={inputStyle}
                    value={importReleaseVersion}
                    onChange={(e) => setImportReleaseVersion(e.target.value)}
                  >
                    <option value="">Select release</option>
                    {availableReleases
                      .filter((r) => r.version !== version.trim())
                      .map((r) => (
                        <option key={r.version} value={r.version}>v{r.version}</option>
                      ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Recipe</label>
                  <select
                    style={inputStyle}
                    value={importRecipeVersion}
                    onChange={(e) => setImportRecipeVersion(e.target.value)}
                    disabled={!importReleaseVersion || importLoading}
                  >
                    <option value="">
                      {importLoading ? 'Loading recipes...' : 'Select recipe'}
                    </option>
                    {importRecipes.map((r) => (
                      <option key={r.version} value={r.version}>v{r.version}</option>
                    ))}
                  </select>
                </div>
                <button type="button" onClick={importRecipeDraft} style={{
                  ...btnSecondary, fontSize: 11, padding: '6px 12px', height: 34,
                }}>
                  Import
                </button>
                <button type="button" onClick={() => {
                  setImportOpen(false);
                  setImportError(null);
                  setImportReleaseVersion('');
                  setImportRecipeVersion('');
                  setImportRecipes([]);
                }} style={{
                  ...btnSecondary, fontSize: 11, padding: '6px 12px', height: 34,
                }}>
                  Remove
                </button>
              </div>
              {importError && (
                <div style={{ marginTop: 8, fontSize: 12, color: T.red }}>
                  {importError}
                </div>
              )}
            </div>
          )}

              {draftRecipes.length === 0 && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  color: T.textMuted,
                  border: `1px dashed ${T.border}`,
                  background: T.bgCard,
                  marginBottom: 8,
                }}>
                  No recipes added yet. Create a new recipe or import from an existing release.
                </div>
              )}

          {draftRecipes.map((recipe, recipeIndex) => {
            const upgradeFromCandidates = draftRecipes
              .slice(0, recipeIndex)
              .filter((r) => r.version.trim())
              .map((r) => r.version.trim());
            const upgradeCandidates = draftRecipes
              .slice(recipeIndex + 1)
              .filter((r) => r.version.trim())
              .map((r) => r.version.trim());
            const effectiveUpgradeTo = recipe.upgradeTo || [];
            const effectiveUpgradeFrom = recipe.upgradeFrom || [];
                const isExpanded = expandedRecipeIds.includes(recipe.id);

            return (
              <div key={recipe.id} style={{
                background: T.bgCard,
                border: `1px solid ${T.border}`,
                borderLeft: `3px solid ${T.blue}`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <button
                        type="button"
                        onClick={() => toggleRecipeDraftExpanded(recipe.id)}
                        style={{
                          ...btnSecondary,
                          fontSize: 12,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        <span>{isExpanded ? '▾' : '▸'}</span>
                        <span>{recipe.version.trim() ? `Recipe v${recipe.version.trim()}` : 'New Recipe'}</span>
                      </button>
                      <button type="button" onClick={() => removeRecipeDraft(recipe.id)} style={{ ...btnDanger, fontSize: 11, padding: '4px 10px' }}>
                        Remove
                      </button>
                </div>

                    {isExpanded && (
                      <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Recipe Version</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. 1.3.1"
                      value={recipe.version}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'version', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Release Date</label>
                    <input
                      style={inputStyle}
                      type="date"
                      value={recipe.releaseDate}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'releaseDate', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Status</label>
                    <select
                      style={inputStyle}
                      value={recipe.status}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'status', e.target.value)}
                    >
                      <option value="GA">GA</option>
                      <option value="Beta">Beta</option>
                      <option value="Deprecated">Deprecated</option>
                      <option value="Retired">Retired</option>
                      <option value="Preview">Preview</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ ...labelStyle, marginBottom: 8 }}>Upgrade Source</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.textMuted }}>
                    <input
                      type="checkbox"
                      checked={Boolean(recipe.sourceEnabled)}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'sourceEnabled', e.target.checked)}
                    />
                    Use Existing Recipe as Source (Optional)
                  </label>
                  {recipe.sourceEnabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 8 }}>
                      <div>
                        <label style={labelStyle}>Source Release</label>
                        <select
                          style={inputStyle}
                          value={recipe.sourceReleaseVersion || ''}
                          onChange={(e) => updateDraftSourceRelease(recipe.id, e.target.value)}
                        >
                          <option value="">Select release</option>
                          {availableReleases
                            .filter((r) => r.version !== version.trim())
                            .map((r) => (
                              <option key={`source-${recipe.id}-${r.version}`} value={r.version}>v{r.version}</option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Source Recipe</label>
                        <select
                          style={inputStyle}
                          value={recipe.sourceRecipeVersion || ''}
                          onChange={(e) => updateDraftSourceRecipe(recipe.id, e.target.value)}
                          disabled={!recipe.sourceReleaseVersion}
                        >
                          <option value="">
                            {recipe.sourceReleaseVersion ? 'Select recipe' : 'Select a release first'}
                          </option>
                          {(sourceRecipesCache[recipe.sourceReleaseVersion]?.recipes || []).map((r) => (
                            <option key={`source-recipe-${recipe.id}-${r.version}`} value={r.version}>v{r.version}</option>
                          ))}
                        </select>
                        {recipe.sourceReleaseVersion && sourceRecipesCache[recipe.sourceReleaseVersion]?.loading && (
                          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Loading recipes...</div>
                        )}
                        {recipe.sourceReleaseVersion && sourceRecipesCache[recipe.sourceReleaseVersion]?.error && (
                          <div style={{ fontSize: 12, color: T.red, marginTop: 6 }}>
                            {sourceRecipesCache[recipe.sourceReleaseVersion].error}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
                    Component upgrade paths and recipe upgrade-from values auto-fill from the selected source recipe(s).
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Description</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. Patch release with minor upgrades"
                      value={recipe.description}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'description', e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Release Notes</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. Performance and stability improvements"
                      value={recipe.releaseNotes}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'releaseNotes', e.target.value)}
                    />
                  </div>
                </div>

                <label style={{ ...labelStyle, marginBottom: 8 }}>Components</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
                  {recipe.components.map((c, i) => (
                    <div key={`${recipe.id}-${i}`} style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr 1fr 1.3fr auto',
                      gap: 12,
                      alignItems: 'center',
                    }}>
                      <input
                        style={inputStyle}
                        placeholder="Enter Component"
                        value={c.name}
                        onChange={(e) => updateDraftComponent(recipe.id, i, 'name', e.target.value)}
                      />
                      <input
                        style={inputStyle}
                        placeholder="Version"
                        value={c.version}
                        onChange={(e) => updateDraftComponent(recipe.id, i, 'version', e.target.value)}
                      />
                      <input
                        style={inputStyle}
                        type="date"
                        value={c.releaseDate || ''}
                        onChange={(e) => updateDraftComponent(recipe.id, i, 'releaseDate', e.target.value)}
                      />
                      <input
                        style={inputStyle}
                        placeholder="Upgrade From"
                        value={c.upgradeFrom || ''}
                        onChange={(e) => updateDraftComponent(recipe.id, i, 'upgradeFrom', e.target.value)}
                      />
                      <input
                        style={inputStyle}
                        placeholder="Upgrade To"
                        value={c.upgradeTo || ''}
                        onChange={(e) => updateDraftComponent(recipe.id, i, 'upgradeTo', e.target.value)}
                      />
                      {recipe.components.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeDraftComponent(recipe.id, i)}
                          style={{ ...btnDanger, padding: '6px 10px', fontSize: 14, lineHeight: 1 }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addDraftComponent(recipe.id)}
                    style={{ ...btnSecondary, alignSelf: 'flex-start', fontSize: 11, padding: '6px 12px', marginTop: 10 }}
                  >
                    + Add Component
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={labelStyle}>Upgrade From (comma-separated)</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. 1.1.1, 1.1.2"
                      value={(effectiveUpgradeFrom || []).join(', ')}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'upgradeFrom', parseUpgradeList(e.target.value))}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Upgrade To (comma-separated)</label>
                    <input
                      style={inputStyle}
                      placeholder="e.g. 1.3.0, 1.4.0"
                      value={(effectiveUpgradeTo || []).join(', ')}
                      onChange={(e) => updateRecipeDraft(recipe.id, 'upgradeTo', parseUpgradeList(e.target.value))}
                    />
                  </div>
                </div>

                {upgradeFromCandidates.length > 0 && (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 8 }}>Upgrade From</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      {upgradeFromCandidates.map((v) => (
                        <button
                          key={`${recipe.id}-from-${v}`}
                          type="button"
                          onClick={() => toggleDraftUpgradeFrom(recipe.id, v)}
                          style={{
                            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: effectiveUpgradeFrom.includes(v) ? `${T.blue}22` : T.bgSurface,
                            color: effectiveUpgradeFrom.includes(v) ? T.blue : T.textMuted,
                            border: `1px solid ${effectiveUpgradeFrom.includes(v) ? T.blue : T.border}`,
                            cursor: 'pointer',
                          }}
                        >
                          v{v}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {upgradeCandidates.length > 0 && (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 8 }}>Upgrade To</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {upgradeCandidates.map((v) => (
                        <button
                          key={`${recipe.id}-${v}`}
                          type="button"
                          onClick={() => toggleDraftUpgradeTo(recipe.id, v)}
                          style={{
                            padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                            background: effectiveUpgradeTo.includes(v) ? `${T.teal}22` : T.bgSurface,
                            color: effectiveUpgradeTo.includes(v) ? T.teal : T.textMuted,
                            border: `1px solid ${effectiveUpgradeTo.includes(v) ? T.teal : T.border}`,
                            cursor: 'pointer',
                          }}
                        >
                          v{v}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                  </>
                )}
              </div>
            );
          })}
      </div>

      <button type="submit" style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }} disabled={submitting}>
        {submitting ? 'Creating...' : 'Create Release'}
      </button>
    </form>
  );
}
