import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useRealtimeReleases from './hooks/useRealtimeReleases';
import T from './theme';
import { btnSecondary, cardStyle } from './ui/styles';
import Toast from './components/manage/Toast';
import CreateReleaseForm from './components/manage/CreateReleaseForm';
import ReleaseCard from './components/manage/ReleaseCard';

const API_BASE = '/api';
const DEFAULT_PIPELINE = ['dev', 'qa', 'integration', 'prod'];

// Preview of the version an edit will fork (backend bumps the patch and avoids clashes).
const bumpPatch = (v) => {
  if (!v) return '';
  const parts = String(v).replace(/^v/i, '').split('.');
  const last = parts[parts.length - 1];
  const n = parseInt(last, 10);
  if (Number.isNaN(n)) return `${v}.1`;
  parts[parts.length - 1] = String(n + 1);
  return parts.join('.');
};

// ============================================================================
// Main Manage Page
// ============================================================================
export default function ManagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Pipeline order is the source of truth for valid clusters — fetched, not hardcoded.
  const [pipeline, setPipeline] = useState(DEFAULT_PIPELINE);
  const allowedClusters = pipeline;
  const initialCluster = DEFAULT_PIPELINE.includes(searchParams.get('cluster'))
    ? searchParams.get('cluster')
    : 'dev';
  const [cluster, setCluster] = useState(initialCluster);
  const { helmReleases: releases, loading, error, lastEvent, refetch } = useRealtimeReleases(cluster);
  const [toast, setToast] = useState(null);
  // Git-backed platform state: how many catalog versions exist (drives create-only-when-empty),
  // and the deployment event log.
  const [versionCount, setVersionCount] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(null); // DEV catalog being edited (forks a new version on save)

  useEffect(() => {
    fetch(`${API_BASE}/pipeline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (Array.isArray(data) && data.length) setPipeline(data); })
      .catch(() => { /* keep default */ });
  }, []);

  const refreshPlatform = () => {
    fetch(`${API_BASE}/versions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setVersionCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setVersionCount(null));
    fetch(`${API_BASE}/history`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setHistory([]));
  };

  useEffect(() => { refreshPlatform(); }, []);

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get('cluster'))
      ? searchParams.get('cluster')
      : allowedClusters[0];
    setCluster((prev) => (prev === urlCluster ? prev : urlCluster));
  }, [searchParams, pipeline]);

  useEffect(() => {
    const urlCluster = allowedClusters.includes(searchParams.get('cluster'))
      ? searchParams.get('cluster')
      : allowedClusters[0];
    if (urlCluster !== cluster) {
      const next = new URLSearchParams(searchParams);
      next.set('cluster', cluster);
      setSearchParams(next, { replace: true });
    }
  }, [cluster, searchParams, setSearchParams, pipeline]);

  // Show toast on realtime events + keep platform state fresh.
  useEffect(() => {
    if (!lastEvent) return;
    refreshPlatform();
    const eventLabels = {
      status_changed: `Release ${lastEvent.data?.version} → ${lastEvent.data?.status}`,
      release_created: `New release ${lastEvent.data?.version} created`,
      version_created: `New catalog version ${lastEvent.data?.version} created`,
      release_deleted: `Release ${lastEvent.data?.version} deleted`,
      recipe_added: `Recipe added to ${lastEvent.data?.helmVersion}`,
      recipe_updated: `Recipe updated in ${lastEvent.data?.helmVersion}`,
      recipe_deleted: `Recipe removed from ${lastEvent.data?.helmVersion}`,
    };
    const label = eventLabels[lastEvent.event];
    if (label) setToast({ message: label, type: 'success' });
  }, [lastEvent]);

  const notify = (message, isError = false) => {
    setToast({ message, type: isError ? 'error' : 'success' });
  };

  const refresh = () => { refetch(); refreshPlatform(); };

  async function deployRelease(version, targetCluster) {
    const deployCluster = targetCluster || cluster;
    const response = await fetch(`${API_BASE}/helm-releases/${version}/deploy?cluster=${deployCluster}`, {
      method: 'POST',
    });

    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }

    if (!response.ok) {
      const message = payload.error || `Deploy failed for ${version}`;
      notify(message, true);
      window.alert(message);
      throw new Error(message);
    }

    const message = payload.message || `Deploy triggered for ${version} on ${deployCluster.toUpperCase()}`;
    notify(message);
    refresh();
    return payload;
  }

  // Rollback an environment one step to its previous version (QA/INTEGRATION/PROD only).
  // Confirmation here because it changes real cluster state.
  async function rollbackEnv(env) {
    if (!window.confirm(
      `Roll back ${env.toUpperCase()} to its previous version?\n\n`
      + `This redeploys the older version into the ${env} namespace.`)) {
      return;
    }
    const response = await fetch(`${API_BASE}/environments/${env}/rollback`, { method: 'POST' });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      const message = payload.error || `Rollback failed for ${env}`;
      notify(message, true);
      window.alert(message);
      return;
    }
    notify(payload.message || `Rolled back ${env.toUpperCase()}`);
    refresh();
  }

  const pipelineLabel = pipeline.map((p) => p.toUpperCase()).join(' → ');
  const isEmptySystem = versionCount === 0;

  return (
    <div style={{
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      minHeight: '100vh', background: T.bg, color: T.text,
    }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 130,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            overflowY: 'auto', padding: '40px 16px',
          }}
          onClick={() => setEditing(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 920, maxWidth: '95vw' }}>
            <CreateReleaseForm
              editMode
              initialCatalog={editing}
              nextVersionPreview={bumpPatch(editing.version)}
              cluster={cluster}
              onCreated={(msg, isErr) => {
                notify(msg, isErr);
                if (!isErr) { setEditing(null); refresh(); }
              }}
            />
          </div>
        </div>
      )}

      {/* Header */}
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
              Recipe Manager
            </h1>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 1 }}>
              Create & manage Helm releases and recipes
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={cluster} onChange={(e) => setCluster(e.target.value)} style={{
            ...btnSecondary,
            padding: '7px 10px',
          }}>
            {pipeline.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap' }}>
            Viewing: {cluster.toUpperCase()}
          </span>
          <span style={{
            fontSize: 11, color: T.teal, padding: '4px 10px', borderRadius: 6,
            background: `${T.teal}12`, border: `1px solid ${T.teal}33`, whiteSpace: 'nowrap',
          }}>
            Pipeline: {pipelineLabel}
          </span>
          <button onClick={() => setShowHistory((s) => !s)} style={btnSecondary}>
            {showHistory ? 'Hide History' : 'History'}
          </button>
          <Link to={`/?cluster=${cluster}`} style={{
            ...btnSecondary, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
          }}>
              ← Visualizer
          </Link>
          <button onClick={refresh} style={btnSecondary}>Refresh</button>
        </div>
      </header>

      {error && (
        <div style={{
          background: `${T.red}15`, color: T.red,
          padding: '10px 24px', fontSize: 13, borderBottom: `1px solid ${T.red}33`,
        }}>{error}</div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
        {showHistory && <DeploymentHistory history={history} />}

        {/* Create is available only on an empty system (cold start). Otherwise edit the dev
            catalog, which forks a new version. */}
        {isEmptySystem && (
          <CreateReleaseForm onCreated={(msg, isError) => {
            notify(msg, isError);
            if (!isError) refresh();
          }} cluster={cluster} />
        )}
        {versionCount !== null && versionCount > 0 && (
          <div style={{
            ...cardStyle, marginBottom: 16, fontSize: 13, color: T.textMuted,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>✎</span>
            A catalog already exists. New versions are created by editing the <strong style={{ color: T.text }}>DEV</strong> catalog
            (each edit forks a new version); other environments receive versions via promotion.
          </div>
        )}

        {/* Existing releases */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
            Catalog Versions
          </h2>
          <span style={{
            padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            background: `${T.teal}18`, color: T.teal,
          }}>{releases.length}</span>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>Loading...</div>
        )}

        {!loading && releases.length === 0 && (
          <div style={{
            ...cardStyle, textAlign: 'center', padding: 40,
            border: `1px dashed ${T.border}`,
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 6 }}>No versions yet</div>
            <div style={{ fontSize: 13, color: T.textMuted }}>Create your first catalog version above to get started.</div>
          </div>
        )}

        {!loading && releases.map((r) => (
          <ReleaseCard
            key={r.version}
            release={r}
            cluster={cluster}
            onRefresh={refresh}
            onNotify={notify}
            onDeploy={deployRelease}
            onRollback={rollbackEnv}
            onEditCatalog={setEditing}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Deployment History — reads the Git-backed event log (GET /api/history)
// ============================================================================
function DeploymentHistory({ history }) {
  const actionColor = {
    create: T.textMuted,
    deploy: T.blue,
    promote: T.teal,
    rollback: T.yellow,
    edit: T.blue,
  };
  const ordered = [...history].reverse(); // newest first
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: T.text }}>Deployment History</h3>
      {ordered.length === 0 && (
        <div style={{ fontSize: 13, color: T.textMuted }}>No events recorded yet.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ordered.map((e, i) => (
          <div key={`${e.timestamp || ''}-${i}`} style={{
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
            padding: '6px 10px', borderRadius: 6, background: T.bgSurface,
            border: `1px solid ${T.border}`,
          }}>
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              background: `${actionColor[e.action] || T.textMuted}22`,
              color: actionColor[e.action] || T.textMuted, minWidth: 70, textAlign: 'center',
            }}>{e.action}</span>
            <span style={{ color: T.text, fontWeight: 600 }}>v{e.version}</span>
            {e.env && <span style={{ color: T.textMuted }}>→ {String(e.env).toUpperCase()}</span>}
            {e.fromVersion && <span style={{ color: T.textMuted }}>(from {e.fromVersion})</span>}
            <span style={{ marginLeft: 'auto', color: T.textMuted }}>{e.timestamp || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
