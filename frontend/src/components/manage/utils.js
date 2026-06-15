function normalizeRecipeDescription(text, fallbackVersion) {
  const cleaned = String(text || '').replace(/^\s*description\s*:\s*/i, '').trim();
  if (cleaned) return cleaned;
  return `HPE Ezmeral Runtime ${fallbackVersion}`;
}

function parseUpgradeList(text) {
  if (Array.isArray(text)) {
    return text.map((v) => String(v).trim()).filter(Boolean);
  }
  return String(text || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}


function getRecipeUpgradeTo(recipe) {
  const paths = Array.isArray(recipe?.upgrade_to) ? recipe.upgrade_to : [];
  return paths.filter(Boolean);
}

function getRecipeUpgradeFrom(recipes, recipe) {
  if (!recipes || !recipe) return [];
  const explicit = Array.isArray(recipe?.upgrade_from) ? recipe.upgrade_from.filter(Boolean) : [];
  if (explicit.length > 0) return explicit;
  const targetVersion = recipe.version;
  return recipes
    .filter((r) => Array.isArray(r?.upgrade_to) && r.upgrade_to.includes(targetVersion))
    .map((r) => r.version)
    .filter(Boolean);
}

function getEnvironmentActions(pipeline, cluster, promotion) {
  const clusterIndex = pipeline.indexOf(cluster);
  const isCurrentVersion = Boolean(promotion?.deployedOn?.[cluster]);
  const nextStage = clusterIndex >= 0 ? pipeline[clusterIndex + 1] || null : null;
  const activeVersions = promotion?.activeVersionOnCluster || {};
  const currentVersion = activeVersions[cluster] || '';
  const targetVersion = nextStage ? activeVersions[nextStage] || '' : '';
  const knowsTargetVersion = nextStage && Object.prototype.hasOwnProperty.call(activeVersions, nextStage);
  const promotionWouldChangeTarget = Boolean(nextStage)
    && (!knowsTargetVersion || currentVersion !== targetVersion);

  return {
    promoteTarget: isCurrentVersion && promotionWouldChangeTarget
      ? nextStage
      : null,
    rollbackTarget: isCurrentVersion && promotion?.canRollback?.[cluster]
      ? cluster
      : null,
  };
}

function getSourceReleaseOptions(releases, editMode, currentVersion) {
  if (!Array.isArray(releases)) return [];
  if (editMode) {
    return releases.filter((release) => release?.status === 'deployed');
  }
  return releases.filter((release) => release?.version !== currentVersion);
}

export {
  normalizeRecipeDescription,
  parseUpgradeList,
  normalizeVersion,
  getRecipeUpgradeTo,
  getRecipeUpgradeFrom,
  getEnvironmentActions,
  getSourceReleaseOptions,
};
