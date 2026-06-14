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
const DRAFT_SOURCE_RELEASE = '__draft__';

const readUpgradeList = (spec, key, fallbackKey) => {
  if (!spec || typeof spec !== 'object') return [];
  const raw = spec[key] || spec[fallbackKey];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') return parseUpgradeList(raw);
  return [];
};

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));

const cloneDraftRecipes = (drafts) => drafts.map((d) => ({
  ...d,
  upgradeFrom: [...(d.upgradeFrom || [])],
  upgradeTo: [...(d.upgradeTo || [])],
  sourceRecipeVersions: [...(d.sourceRecipeVersions || [])],
  components: d.components.map((c) => ({ ...c })),
}));

const draftToRecipeShape = (draft) => ({
  version: draft.version,
  components: draft.components.reduce((acc, c) => {
    const name = String(c.name || '').trim();
    const compVersion = String(c.version || '').trim();
    if (!name || !compVersion) return acc;
    acc[name] = {
      version: compVersion,
      release_date: c.releaseDate || '',
      upgrade_from: parseUpgradeList(c.upgradeFrom),
      upgrade_to: parseUpgradeList(c.upgradeTo),
    };
    return acc;
  }, {}),
});

// Convert a saved recipe (components keyed by name) into the editable draft shape.
// Existing fields are marked "touched" so source-seeding never overwrites them — seeding
// only auto-fills NEW recipes the user adds during the edit.
const recipeToDraft = (recipe) => ({
  id: `${recipe.version || 'r'}-${Math.random().toString(36).slice(2, 8)}`,
  version: recipe.version || '',
  description: recipe.description || '',
  releaseDate: recipe.release_date || recipe.releaseDate || '',
  status: recipe.status || 'GA',
  releaseNotes: recipe.release_notes || recipe.releaseNotes || '',
  components: Object.entries(recipe.components || {}).map(([name, spec]) => ({
    name,
    version: readVersion(spec),
    releaseDate: spec?.release_date || '',
    upgradeFrom: readUpgradeList(spec, 'upgrade_from', 'upgradeFrom').join(', '),
    upgradeTo: readUpgradeList(spec, 'upgrade_to', 'upgradeTo').join(', '),
    versionTouched: true,
    upgradeFromTouched: true,
    upgradeToTouched: true,
  })),
  upgradeFrom: (recipe.upgrade_from || recipe.upgradeFrom || []).map(String),
  upgradeTo: (recipe.upgrade_to || recipe.upgradeTo || []).map(String),
  upgradeFromTouched: true,
  upgradeToTouched: true,
  sourceReleaseVersion: '',
  sourceRecipeVersions: [],
  sourceEnabled: false,
});

const buildSourceComponentInfo = (sourceRecipe) => {
  const map = {};
  Object.entries(sourceRecipe?.components || {}).forEach(([name, spec]) => {
    const compVersion = readVersion(spec);
    const upgradeToList = readUpgradeList(spec, 'upgrade_to', 'upgradeTo');
    const upgradeToFirst = upgradeToList.length > 0 ? upgradeToList[0] : '';
    if (!name || !compVersion) return;
    if (!map[name]) {
      map[name] = { sourceVersion: compVersion, upgradeToFirst, releaseDate: spec?.release_date || '' };
    }
  });
  return map;
};

const resolveSourceRecipeData = (sourceReleaseVersion, sourceRecipeVersion, drafts, cache) => {
  const normalized = normalizeVersion(sourceRecipeVersion);
  if (!normalized || !sourceReleaseVersion) return null;

  if (sourceReleaseVersion === DRAFT_SOURCE_RELEASE) {
    const local = drafts.find((d) => normalizeVersion(d.version) === normalized);
    return local ? draftToRecipeShape(local) : null;
  }

  const cacheEntry = cache[sourceReleaseVersion];
  if (!cacheEntry?.recipes) return null;
  return cacheEntry.recipes.find((r) => normalizeVersion(r.version) === normalized) || null;
};

const getSelectedSourceVersions = (draft) => (
  draft.sourceRecipeVersions?.length
    ? draft.sourceRecipeVersions
    : (draft.sourceRecipeVersion ? [draft.sourceRecipeVersion] : [])
);

const populateDestinationFromSources = (dest, sources) => {
  if (!dest.sourceEnabled || sources.length === 0) return dest;

  if (!dest.upgradeFromTouched) {
    dest.upgradeFrom = sources
      .map((s) => normalizeVersion(s.version))
      .filter(Boolean);
  }

  const nextComponents = dest.components.map((c) => ({ ...c }));

  sources.forEach((source, sourceIdx) => {
    const sourceComponentInfo = buildSourceComponentInfo(source);
    Object.entries(sourceComponentInfo).forEach(([name, info]) => {
      const existing = nextComponents.find((c) => String(c.name || '').trim() === name);
      if (existing) {
        if (!existing.versionTouched && sourceIdx === 0 && info.upgradeToFirst) {
          existing.version = info.upgradeToFirst;
        }
        if (!existing.upgradeFromTouched) {
          const fromVersions = sources
            .map((s) => buildSourceComponentInfo(s)[name]?.sourceVersion)
            .filter(Boolean);
          existing.upgradeFrom = [...new Set(fromVersions)].join(', ');
        }
        if (!existing.releaseDate && info.releaseDate && sourceIdx === 0) {
          existing.releaseDate = info.releaseDate;
        }
        return;
      }

      if (sourceIdx === 0) {
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
      }
    });
  });

  dest.components = nextComponents.filter((component) => {
    const isEmpty = !component.name && !component.version && !component.releaseDate
      && !component.upgradeFrom && !component.upgradeTo;
    const isUntouched = !component.versionTouched && !component.upgradeFromTouched && !component.upgradeToTouched;
    return !(isEmpty && isUntouched);
  });

  return dest;
};

const syncAllDraftSourceLinks = (drafts, cache) => {
  const result = cloneDraftRecipes(drafts);
  const destsByLocalSourceVersion = new Map();

  result.forEach((dest) => {
    if (!dest.sourceEnabled || !dest.sourceReleaseVersion) return;

    const sourceVersions = getSelectedSourceVersions(dest);
    const sources = sourceVersions
      .map((sv) => resolveSourceRecipeData(dest.sourceReleaseVersion, sv, result, cache))
      .filter(Boolean);

    populateDestinationFromSources(dest, sources);

    if (dest.sourceReleaseVersion === DRAFT_SOURCE_RELEASE) {
      sourceVersions.forEach((sv) => {
        const normalized = normalizeVersion(sv);
        if (!normalized) return;
        if (!destsByLocalSourceVersion.has(normalized)) {
          destsByLocalSourceVersion.set(normalized, []);
        }
        destsByLocalSourceVersion.get(normalized).push(dest);
      });
    }
  });

  result.forEach((sourceDraft) => {
    const sourceVersion = normalizeVersion(sourceDraft.version);
    if (!sourceVersion) return;

    const linkedDests = destsByLocalSourceVersion.get(sourceVersion) || [];

    // Source-seeding link (recipe level). Coerce every operand to clean version tokens BEFORE
    // spreading (never spread a raw string char-by-char), and REPLACE the previous auto-linked
    // versions with the current ones instead of accumulating them — otherwise the partial versions
    // captured while the destination version is being typed (1, 1., 1.3, …) pile up forever.
    // Genuine values (loaded or user-typed) are preserved via `recipeBase`; `upgradeToAuto` is
    // bookkeeping of the last auto-link set, carried along by the existing draft spreads.
    const existingRecipeTo = Array.isArray(sourceDraft.upgradeTo)
      ? sourceDraft.upgradeTo.map(String)
      : parseUpgradeList(sourceDraft.upgradeTo);
    const prevRecipeAuto = Array.isArray(sourceDraft.upgradeToAuto) ? sourceDraft.upgradeToAuto : [];
    const recipeLinkTokens = linkedDests
      .map((d) => normalizeVersion(d.version))
      .filter(Boolean);
    const recipeBase = existingRecipeTo.filter((v) => !prevRecipeAuto.includes(v));
    sourceDraft.upgradeTo = [...new Set(
      [...recipeBase, ...recipeLinkTokens].map((s) => String(s).trim()).filter(Boolean),
    )];
    sourceDraft.upgradeToAuto = recipeLinkTokens;

    sourceDraft.components.forEach((srcComp) => {
      const name = String(srcComp.name || '').trim();
      if (!name) return;

      const autoTos = linkedDests
        .flatMap((dest) => dest.components.filter((c) => String(c.name || '').trim() === name))
        .map((c) => String(c.version || '').trim())
        .filter(Boolean);

      // Same discipline for the per-component upgradeTo, which is a comma-separated STRING: parse
      // it to an array (never char-spread), drop the previous auto-links, union the current ones,
      // and store back as a string. Real/user component values are preserved via `compBase`.
      const existingCompTo = parseUpgradeList(srcComp.upgradeTo);
      const prevCompAuto = Array.isArray(srcComp.upgradeToAuto) ? srcComp.upgradeToAuto : [];
      const compBase = existingCompTo.filter((v) => !prevCompAuto.includes(v));
      srcComp.upgradeTo = [...new Set([...compBase, ...autoTos])].join(', ');
      srcComp.upgradeToAuto = autoTos;
    });
  });

  return result;
};

export default function CreateReleaseForm({
  cluster, onCreated, editMode = false, initialCatalog = null, nextVersionPreview = '',
}) {
  const [version, setVersion] = useState('');
  const [valuesFileName, setValuesFileName] = useState('');
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
    sourceRecipeVersions: [],
    sourceEnabled: false,
  });

  const autoReleaseName = cluster ? `recipe-${cluster}` : '';

  useEffect(() => {
    fetch(`${API_BASE}/helm-releases?cluster=${cluster}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => setAvailableReleases(Array.isArray(data) ? data : []))
      .catch(() => setAvailableReleases([]));
  }, [cluster]);

  // Edit mode: pre-fill the form from the current DEV catalog so saving forks a new version.
  useEffect(() => {
    if (!editMode || !initialCatalog) return;
    setVersion(initialCatalog.version || '');
    setReleaseName(initialCatalog.releaseName || '');
    setCatalogName(initialCatalog.catalogName || initialCatalog.catalog_name || '');
    setCatalogDescription(initialCatalog.catalogDescription || initialCatalog.catalog_description || '');
    setCatalogReleaseDate(initialCatalog.catalogReleaseDate || initialCatalog.release_date || '');
    setCatalogStatus(initialCatalog.catalogStatus || initialCatalog.catalog_status || 'GA');
    setMaintainer(initialCatalog.maintainer || '');
    setDraftRecipes((initialCatalog.recipes || []).map(recipeToDraft));
    setExpandedRecipeIds([]);
  }, [editMode, initialCatalog]);

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

  const runSourceSync = (drafts) => syncAllDraftSourceLinks(drafts, sourceRecipesCache);

  const updateDraftSourceRelease = (recipeId, releaseVersion) => {
    if (releaseVersion && releaseVersion !== DRAFT_SOURCE_RELEASE) {
      loadSourceRecipes(releaseVersion);
    }
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => (
      r.id === recipeId
        ? { ...r, sourceReleaseVersion: releaseVersion, sourceRecipeVersions: [] }
        : r
    ))));
  };

  const toggleDraftSourceRecipe = (recipeId, recipeVersion) => {
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => {
      if (r.id !== recipeId) return r;
      const normalized = normalizeVersion(recipeVersion);
      const current = r.sourceRecipeVersions || [];
      const exists = current.some((v) => normalizeVersion(v) === normalized);
      return {
        ...r,
        sourceRecipeVersions: exists
          ? current.filter((v) => normalizeVersion(v) !== normalized)
          : [...current, recipeVersion],
      };
    })));
  };

  useEffect(() => {
    setDraftRecipes((prev) => runSourceSync(prev));
  }, [sourceRecipesCache]);

  const addRecipeDraft = () => {
    const recipe = createEmptyRecipe();
    setDraftRecipes((prev) => runSourceSync([...prev, recipe]));
    setExpandedRecipeIds((prev) => [...prev, recipe.id]);
  };

  const removeRecipeDraft = (id) => {
    setDraftRecipes((prev) => runSourceSync(prev.filter((r) => r.id !== id)));
    setExpandedRecipeIds((prev) => prev.filter((rid) => rid !== id));
  };

  const toggleRecipeDraftExpanded = (id) => {
    setExpandedRecipeIds((prev) => (
      prev.includes(id) ? prev.filter((rid) => rid !== id) : [...prev, id]
    ));
  };

  const updateRecipeDraft = (id, field, value) => {
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: value };
      if (field === 'upgradeFrom') next.upgradeFromTouched = true;
      if (field === 'upgradeTo') next.upgradeToTouched = true;
      return next;
    })));
  };

  const updateDraftComponent = (recipeId, index, field, value) => {
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => {
      if (r.id !== recipeId) return r;
      const next = [...r.components];
      const updated = { ...next[index], [field]: value };
      if (field === 'version') updated.versionTouched = true;
      if (field === 'upgradeFrom') updated.upgradeFromTouched = true;
      if (field === 'upgradeTo') updated.upgradeToTouched = true;
      next[index] = updated;
      return { ...r, components: next };
    })));
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
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => {
      if (r.id !== recipeId) return r;
      const base = r.upgradeTo || [];
      const exists = base.includes(toVersion);
      return {
        ...r,
        upgradeTo: exists ? base.filter((v) => v !== toVersion) : [...base, toVersion],
        upgradeToTouched: true,
      };
    })));
  };

  const toggleDraftUpgradeFrom = (recipeId, fromVersion) => {
    setDraftRecipes((prev) => runSourceSync(prev.map((r) => {
      if (r.id !== recipeId) return r;
      const base = r.upgradeFrom || [];
      const exists = base.includes(fromVersion);
      return {
        ...r,
        upgradeFrom: exists ? base.filter((v) => v !== fromVersion) : [...base, fromVersion],
        upgradeFromTouched: true,
      };
    })));
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

    const body = {
      version: version.trim(),
      ...(valuesFileName.trim() ? { valuesFileName: valuesFileName.trim() } : {}),
      releaseName: releaseName.trim() || autoReleaseName,
      status: 'pending',
      catalog_name: catalogName.trim(),
      catalog_description: catalogDescription.trim(),
      release_date: catalogReleaseDate,
      catalog_status: catalogStatus,
      maintainer: maintainer.trim(),
      recipes: recipesPayload,
    };
    // Edit mode forks a NEW version on DEV via the platform endpoint; create posts a brand-new release.
    const url = editMode ? `${API_BASE}/catalog/edit` : `${API_BASE}/helm-releases?cluster=${cluster}`;

    setSubmitting(true);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        if (r.status === 409) throw new Error('Version already exists');
        if (!r.ok) {
          let payload = {};
          try { payload = await r.json(); } catch { payload = {}; }
          throw new Error(payload.error || (editMode ? 'Failed to save changes' : 'Failed to create'));
        }
        return r.json();
      })
      .then((saved) => {
        if (editMode) {
          onCreated(`New version v${saved?.version || nextVersionPreview} created — deploying to DEV`);
          return;
        }
        setVersion(''); setValuesFileName(''); setReleaseName('');
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
        {editMode ? 'Edit DEV Catalog' : 'New Helm Release'}
      </h3>
      {editMode && (
        <div style={{
          marginBottom: 16, padding: '8px 14px', borderRadius: 8,
          background: `${T.blue}12`, border: `1px solid ${T.blue}33`,
          fontSize: 12, color: T.blue,
        }}>
          Editing DEV is non-destructive — <strong>saving will create v{nextVersionPreview || '…'}</strong> and
          deploy it to DEV. Other environments are unchanged.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>Chart Version</label>
          <input style={editMode ? { ...inputStyle, opacity: 0.7 } : inputStyle} placeholder="e.g. 0.0.4" value={version}
            onChange={(e) => setVersion(e.target.value)} required readOnly={editMode} />
          {editMode && (
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
              Current DEV version — saving creates v{nextVersionPreview || '…'}
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle}>Values File Name (optional)</label>
          <input
            style={inputStyle}
            placeholder={version.trim() ? `values-v${version.trim()}.yaml` : 'e.g. prod-values.yaml'}
            value={valuesFileName}
            onChange={(e) => setValuesFileName(e.target.value)}
          />
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
            </div>
          </div>

          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>
                Add at least one recipe version with components.
          </div>

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
                  No recipes added yet. Create a new recipe to get started.
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
                          <option value={DRAFT_SOURCE_RELEASE}>This release (draft recipes)</option>
                          {availableReleases
                            .filter((r) => r.version !== version.trim())
                            .map((r) => (
                              <option key={`source-${recipe.id}-${r.version}`} value={r.version}>v{r.version}</option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Source Recipes (select one or more)</label>
                        {!recipe.sourceReleaseVersion && (
                          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>
                            Select a release first
                          </div>
                        )}
                        {recipe.sourceReleaseVersion === DRAFT_SOURCE_RELEASE && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {draftRecipes
                              .filter((d) => d.id !== recipe.id && d.version.trim())
                              .map((d) => {
                                const selected = (recipe.sourceRecipeVersions || [])
                                  .some((v) => normalizeVersion(v) === normalizeVersion(d.version));
                                return (
                                  <button
                                    key={`draft-source-${recipe.id}-${d.id}`}
                                    type="button"
                                    onClick={() => toggleDraftSourceRecipe(recipe.id, d.version)}
                                    style={{
                                      padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                      background: selected ? `${T.blue}22` : T.bgSurface,
                                      color: selected ? T.blue : T.textMuted,
                                      border: `1px solid ${selected ? T.blue : T.border}`,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    v{d.version.trim()}
                                  </button>
                                );
                              })}
                            {draftRecipes.filter((d) => d.id !== recipe.id && d.version.trim()).length === 0 && (
                              <span style={{ fontSize: 12, color: T.textMuted }}>
                                Add another recipe to this release first
                              </span>
                            )}
                          </div>
                        )}
                        {recipe.sourceReleaseVersion
                          && recipe.sourceReleaseVersion !== DRAFT_SOURCE_RELEASE && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {(sourceRecipesCache[recipe.sourceReleaseVersion]?.recipes || []).map((r) => {
                              const selected = (recipe.sourceRecipeVersions || [])
                                .some((v) => normalizeVersion(v) === normalizeVersion(r.version));
                              return (
                                <button
                                  key={`source-recipe-${recipe.id}-${r.version}`}
                                  type="button"
                                  onClick={() => toggleDraftSourceRecipe(recipe.id, r.version)}
                                  style={{
                                    padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    background: selected ? `${T.blue}22` : T.bgSurface,
                                    color: selected ? T.blue : T.textMuted,
                                    border: `1px solid ${selected ? T.blue : T.border}`,
                                    cursor: 'pointer',
                                  }}
                                >
                                  v{r.version}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {recipe.sourceReleaseVersion
                          && recipe.sourceReleaseVersion !== DRAFT_SOURCE_RELEASE
                          && sourceRecipesCache[recipe.sourceReleaseVersion]?.loading && (
                          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Loading recipes...</div>
                        )}
                        {recipe.sourceReleaseVersion
                          && recipe.sourceReleaseVersion !== DRAFT_SOURCE_RELEASE
                          && sourceRecipesCache[recipe.sourceReleaseVersion]?.error && (
                          <div style={{ fontSize: 12, color: T.red, marginTop: 6 }}>
                            {sourceRecipesCache[recipe.sourceReleaseVersion].error}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
                    Auto-fills upgrade paths on the new recipe and, for draft sources in this release,
                    adds the new recipe to each source&apos;s upgrade_to list (recipe and matching components).
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
        {submitting
          ? 'Saving...'
          : (editMode ? `Save — create v${nextVersionPreview || '…'}` : 'Create Release')}
      </button>
    </form>
  );
}
