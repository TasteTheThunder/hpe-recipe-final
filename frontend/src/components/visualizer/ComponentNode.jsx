import { Handle, Position } from 'reactflow';
import T from '../../theme';

export default function ComponentNode({ data }) {
  const theme = data.theme;
  const version = String(data.version || '').replace(/^v/i, '');
  return (
    <div style={{
      background: `linear-gradient(135deg, ${theme.bg}, ${theme.bg}dd)`,
      border: `1.5px solid ${theme.border}88`,
      borderRadius: 12,
      padding: '12px 18px',
      minWidth: 170,
      boxShadow: `0 4px 15px rgba(0,0,0,0.3), 0 0 10px ${theme.border}22`,
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 9, height: 9, borderRadius: 6, background: theme.color, border: `2px solid ${T.bg}` }}
      />
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: `${theme.color}15`, border: `1px solid ${theme.border}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>{theme.icon}</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: theme.color, textTransform: 'capitalize', letterSpacing: 0.2 }}>{data.name}</div>
        <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, fontWeight: 500 }}>v{version}</div>
      </div>
    </div>
  );
}
