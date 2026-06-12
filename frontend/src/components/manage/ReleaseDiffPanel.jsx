import T from '../../theme';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const LINE_STYLES = {
  diff: { color: T.textMuted },
  meta: { color: T.textDim },
  old: { color: '#ff7b72' },
  new: { color: '#7ee787' },
  hunk: { color: '#a371f7', background: 'rgba(163,113,247,0.1)' },
  del: { color: '#ff7b72', background: 'rgba(248,81,73,0.15)' },
  add: { color: '#7ee787', background: 'rgba(63,185,80,0.15)' },
  context: { color: T.textMuted },
  error: { color: T.red, background: `${T.red}15` },
};

const hasRecipeDiffs = (data) => {
  if (!data) return false;
  const keys = ['recipesAdded', 'recipesRemoved', 'recipesChanged'];
  return keys.some((k) => Array.isArray(data[k]) && data[k].length > 0);
};

const pairRecipesByDescription = (added, removed) => {
  const paired = [];
  const unmatchedRemoved = [];
  const unmatchedAdded = [...added];

  for (const r of removed) {
    const idx = unmatchedAdded.findIndex(
      (a) => a.description && r.description && a.description === r.description,
    );
    if (idx >= 0) {
      paired.push({ removed: r, added: unmatchedAdded[idx] });
      unmatchedAdded.splice(idx, 1);
    } else {
      unmatchedRemoved.push(r);
    }
  }

  return { paired, unmatchedRemoved, unmatchedAdded };
};

const buildDiffLines = (diff) => {
  const lines = [];
  const cluster = diff.cluster || 'cluster';

  if (diff.isNewDeploy) {
    lines.push({
      type: 'diff',
      text: `diff --git a/dev/null b/helm/${cluster}/v${diff.targetVersion}`,
    });
    lines.push({ type: 'meta', text: 'new file mode 100644' });
    lines.push({ type: 'old', text: '--- /dev/null' });
    lines.push({ type: 'new', text: `+++ b/helm/${cluster}/v${diff.targetVersion}` });
    lines.push({ type: 'hunk', text: `@@ -0,0 +1,1 @@ first deploy on ${cluster.toUpperCase()}` });
    lines.push({ type: 'add', text: `+ helm release v${diff.targetVersion}` });
    if (diff.hasChanges) {
      lines.push({ type: 'add', text: '+ includes recipe configuration' });
    }
    return lines;
  }

  const from = diff.baselineVersion || 'unknown';
  const to = diff.targetVersion || 'unknown';

  lines.push({
    type: 'diff',
    text: `diff --git a/helm/${cluster}/v${from} b/helm/${cluster}/v${to}`,
  });
  lines.push({ type: 'meta', text: `index ${from}..${to}` });
  lines.push({ type: 'old', text: `--- a/helm/${cluster}/v${from}` });
  lines.push({ type: 'new', text: `+++ b/helm/${cluster}/v${to}` });

  const added = Array.isArray(diff.recipesAdded) ? diff.recipesAdded : [];
  const removed = Array.isArray(diff.recipesRemoved) ? diff.recipesRemoved : [];
  const changed = Array.isArray(diff.recipesChanged) ? diff.recipesChanged : [];

  const { paired, unmatchedRemoved, unmatchedAdded } = pairRecipesByDescription(added, removed);

  for (const { removed: r, added: a } of paired) {
    lines.push({ type: 'hunk', text: `@@ recipe ${r.description || r.version} @@` });
    lines.push({
      type: 'del',
      text: `- recipe: v${r.version}${r.description ? `  # ${r.description}` : ''}`,
    });
    lines.push({
      type: 'add',
      text: `+ recipe: v${a.version}${a.description ? `  # ${a.description}` : ''}`,
    });
  }

  for (const r of unmatchedRemoved) {
    lines.push({ type: 'hunk', text: '@@ recipe removed @@' });
    lines.push({
      type: 'del',
      text: `- recipe: v${r.version}${r.description ? `  # ${r.description}` : ''}`,
    });
  }

  for (const r of unmatchedAdded) {
    lines.push({ type: 'hunk', text: '@@ recipe added @@' });
    lines.push({
      type: 'add',
      text: `+ recipe: v${r.version}${r.description ? `  # ${r.description}` : ''}`,
    });
  }

  for (const rec of changed) {
    lines.push({ type: 'hunk', text: `@@ recipe v${rec.version} @@` });
    const comp = rec.components || {};

    for (const [k, v] of Object.entries(comp.removed || {})) {
      lines.push({ type: 'del', text: `- ${k}: ${v}` });
    }
    for (const [k, v] of Object.entries(comp.added || {})) {
      lines.push({ type: 'add', text: `+ ${k}: ${v}` });
    }
    for (const [k, v] of Object.entries(comp.changed || {})) {
      lines.push({ type: 'del', text: `- ${k}: ${v.from}` });
      lines.push({ type: 'add', text: `+ ${k}: ${v.to}` });
    }

    const up = rec.upgrade_to || {};
    if ((up.removed || []).length || (up.added || []).length) {
      lines.push({ type: 'context', text: ' upgrade_to:' });
      for (const p of up.removed || []) {
        lines.push({ type: 'del', text: `- ${p}` });
      }
      for (const p of up.added || []) {
        lines.push({ type: 'add', text: `+ ${p}` });
      }
    }
  }

  if (!hasRecipeDiffs(diff)) {
    lines.push({ type: 'hunk', text: '@@ recipes @@' });
    lines.push({ type: 'context', text: ' (no recipe differences)' });
  }

  return lines;
};

function DiffLine({ type, text }) {
  const style = LINE_STYLES[type] || LINE_STYLES.context;
  const display = text === '' ? ' ' : text;

  return (
    <div style={{
      ...style,
      fontFamily: MONO,
      fontSize: 12,
      lineHeight: '20px',
      padding: '0 12px',
      whiteSpace: 'pre',
      minHeight: 20,
    }}>
      {display}
    </div>
  );
}

export default function ReleaseDiffPanel({ diff, loading, version, cluster }) {
  if (loading) {
    return (
      <div style={{
        fontFamily: MONO,
        fontSize: 12,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: '16px 12px',
        color: T.textMuted,
      }}>
        <div>$ git diff helm/{cluster}/deployed..v{version}</div>
        <div style={{ marginTop: 8, color: T.textDim }}>Loading...</div>
      </div>
    );
  }

  if (!diff) {
    return null;
  }

  if (diff.error) {
    return (
      <div style={{
        fontFamily: MONO,
        fontSize: 12,
        background: T.bg,
        border: `1px solid ${T.red}55`,
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <DiffLine type="error" text={`error: ${diff.error}`} />
      </div>
    );
  }

  const diffLines = buildDiffLines(diff);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {diff.summary && (
        <div style={{ fontSize: 12, color: T.textMuted, fontFamily: MONO }}>
          # {diff.summary}
          {diff.baselineVersion && (
            <span>{' '}(v{diff.baselineVersion} → v{diff.targetVersion})</span>
          )}
        </div>
      )}

      <div style={{
        fontFamily: MONO,
        fontSize: 12,
        background: T.bg,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        overflow: 'auto',
        maxHeight: '52vh',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${T.border}`,
          color: T.textDim,
          fontSize: 11,
        }}>
          $ git diff helm/{diff.cluster}/v{diff.baselineVersion || 'null'}..v{diff.targetVersion}
        </div>
        {diffLines.map((line, i) => (
          <DiffLine key={`${line.type}-${i}`} type={line.type} text={line.text} />
        ))}
      </div>
    </div>
  );
}

export { hasRecipeDiffs };
