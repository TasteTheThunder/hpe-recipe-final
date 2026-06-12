import { useEffect, useState } from 'react';
import T from '../../theme';
import { btnPrimary, btnSecondary } from '../../ui/styles';
import ReleaseDiffPanel from './ReleaseDiffPanel';

const API_BASE = '/api';

export default function DeployPreviewModal({ version, cluster, onClose, onConfirm }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/helm-releases/${version}/deploy-preview?cluster=${cluster}&baseline=auto`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed to load deploy preview');
        setDiff(data);
      })
      .catch((err) => setDiff({ error: err.message }))
      .finally(() => setLoading(false));
  }, [version, cluster]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm(version);
      onClose();
    } catch {
      setConfirming(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 16,
        padding: 28, width: 760, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: T.text }}>Deploy Preview</h2>
            <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4 }}>
              Dry-run for v{version} on {cluster.toUpperCase()}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 6,
            color: T.textMuted, width: 28, height: 28, cursor: 'pointer', fontSize: 14,
          }}>x</button>
        </div>

        <ReleaseDiffPanel diff={diff} loading={loading} version={version} cluster={cluster} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={btnSecondary} disabled={confirming}>Cancel</button>
          <button
            onClick={handleConfirm}
            style={{ ...btnPrimary, opacity: confirming || loading ? 0.7 : 1 }}
            disabled={confirming || loading || diff?.error}
          >
            {confirming ? 'Deploying...' : cluster === 'dev' ? 'Confirm Deploy to DEV' : `Confirm Promote to ${cluster.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
