const COMP_THEMES = [
  { bg: '#1a2744', border: '#58a6ff', icon: '⚡', color: '#79c0ff' }, // spark
  { bg: '#2a1f1a', border: '#d29922', icon: '📨', color: '#e3b341' }, // kafka
  { bg: '#1a2a2a', border: '#3fb950', icon: '🌊', color: '#56d364' }, // airflow
  { bg: '#2a1a2a', border: '#bc8cff', icon: '🗄️', color: '#d2a8ff' }, // hbase
  { bg: '#2a2a1a', border: '#d29922', icon: '📦', color: '#e3b341' }, // fallback
];

function getCompTheme(name, idx) {
  const map = { spark: 0, kafka: 1, airflow: 2, hbase: 3 };
  return COMP_THEMES[map[name.toLowerCase()] ?? idx % COMP_THEMES.length];
}

export { COMP_THEMES, getCompTheme };
