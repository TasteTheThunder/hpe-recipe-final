import T from '../theme';

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
  background: T.bgSurface, color: T.text, border: `1px solid ${T.border}`,
  outline: 'none', boxSizing: 'border-box',
};

const btnPrimary = {
  padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600,
  background: T.teal, color: T.white, border: 'none', cursor: 'pointer',
};

const btnDanger = {
  padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
  background: 'transparent', color: T.red, border: `1px solid ${T.red}44`,
  cursor: 'pointer',
};

const btnSecondary = {
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  background: T.bgSurface, color: T.textMuted, border: `1px solid ${T.border}`,
  cursor: 'pointer',
};

const cardStyle = {
  background: T.bgCard, border: `1px solid ${T.border}`,
  borderRadius: 12, padding: 20, marginBottom: 16,
};

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: T.textMuted,
  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, display: 'block',
};

export {
  inputStyle,
  btnPrimary,
  btnDanger,
  btnSecondary,
  cardStyle,
  labelStyle,
};
