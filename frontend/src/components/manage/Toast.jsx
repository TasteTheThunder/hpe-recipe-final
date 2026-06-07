import { useEffect } from 'react';
import T from '../../theme';

export default function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 200,
      padding: '12px 20px', borderRadius: 10,
      background: type === 'error' ? T.red : T.teal,
      color: T.white, fontSize: 14, fontWeight: 600,
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      animation: 'slideIn 0.3s ease',
    }}>
      {message}
      <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}
