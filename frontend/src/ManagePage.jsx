import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useRealtimeReleases from './hooks/useRealtimeReleases';
import T from './theme';
import { btnSecondary, cardStyle } from './ui/styles';
import Toast from './components/manage/Toast';
import CreateReleaseForm from './components/manage/CreateReleaseForm';
import ReleaseCard from './components/manage/ReleaseCard';

const API_BASE = '/api';

// ============================================================================
// Main Manage Page
// ============================================================================
export default function ManagePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const allowedClusters = ['dev', 'prod', 'qa', 'integration'];
  const initialCluster = allowedClusters.includes(searchParams.get('cluster'))
    ? searchParams.get('cluster')
    : 'dev';
  const [cluster, setCluster] = useState(initialCluster);
  const { helmReleases: releases, loading, error, lastEvent, refetch } = useRealtimeReleases(cluster);
  const [toast, setToast] = useState(null);

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

  // Show toast on realtime events from other users/Jenkins
  useEffect(() => {
    if (!lastEvent) return;
    const eventLabels = {
      status_changed: `Release ${lastEvent.data?.version} → ${lastEvent.data?.status}`,
      release_created: `New release ${lastEvent.data?.version} created`,
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

  const refresh = () => refetch();

  async function deployRelease(version) {
    const response = await fetch(`${API_BASE}/helm-releases/${version}/deploy?cluster=${cluster}`, {
      method: 'POST',
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      const message = payload.error || `Deploy failed for ${version}`;
      notify(message, true);
      window.alert(message);
      throw new Error(message);
    }

    const message = payload.message || `Deploy triggered for ${version} on ${cluster.toUpperCase()}`;
    notify(message);
    window.alert(message);
    refresh();
    return payload;
  }

  return (
    <div style={{
      fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
      minHeight: '100vh', background: T.bg, color: T.text,
    }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

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
            <option value="dev">DEV</option>
            <option value="prod">PROD</option>
            <option value="qa">QA</option>
            <option value="integration">INTEGRATION</option>
          </select>
          <span style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: T.textMuted, whiteSpace: 'nowrap' }}>
            Cluster: {cluster.toUpperCase()}
          </span>
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
        {/* Create new release */}
        <CreateReleaseForm onCreated={(msg, isError) => {
          notify(msg, isError);
          if (!isError) refresh();
        }} cluster={cluster} />

        {/* Existing releases */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text }}>
            Helm Releases
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
            <div style={{ fontSize: 16, fontWeight: 600, color: T.text, marginBottom: 6 }}>No releases yet</div>
            <div style={{ fontSize: 13, color: T.textMuted }}>Create your first Helm release above to get started.</div>
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
          />
        ))}
      </div>
    </div>
  );
}