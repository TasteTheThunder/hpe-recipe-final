import { Handle, Position } from 'reactflow';
import T from '../../theme';

export default function RecipeNode({ data }) {
  const sel = data.isSelected;
  const version = String(data.version || '').replace(/^v/i, '');
  return (
    <div style={{
      background: sel ? `linear-gradient(135deg, ${T.teal}, ${T.tealDark})` : T.bgCard,
      border: `2px solid ${sel ? T.white + '44' : T.border}`,
      borderRadius: 16,
      padding: '16px 24px',
      width: 280,
      maxWidth: 280,
      minHeight: 96,
      boxSizing: 'border-box',
      cursor: 'pointer',
      backdropFilter: 'blur(10px)',
      boxShadow: sel
        ? `0 0 30px ${T.teal}88, 0 0 60px ${T.teal}33, inset 0 0 10px rgba(255,255,255,0.2)`
        : '0 8px 32px rgba(0,0,0,0.4)',
      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      transform: sel ? 'scale(1.05)' : 'scale(1)',
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 10, height: 10, borderRadius: 6, background: T.teal, border: `2px solid ${T.bg}` }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 10, height: 10, borderRadius: 6, background: T.teal, border: `2px solid ${T.bg}` }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: sel ? 'rgba(255,255,255,0.25)' : T.bgSurface,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
        }}>📋</div>
        <div style={{
          fontWeight: 800, fontSize: 16,
          color: sel ? T.white : T.teal,
          letterSpacing: 0.5,
        }}>v{version}</div>
      </div>
      <div style={{
        fontSize: 12, color: sel ? 'rgba(255,255,255,0.9)' : T.textMuted,
        lineHeight: 1.5, fontWeight: 400,
      }}>{data.description}</div>

      {sel && (
        <div style={{
          marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.1)',
          fontSize: 10, color: 'rgba(255,255,255,0.7)',
          display: 'flex', alignItems: 'center', gap: 6,
          textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.white, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
          Active Recipe
        </div>
      )}
      <style>{`@keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.2); } 100% { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  );
}
