import { useState } from 'react';
import T from '../../theme';
import {
  inputStyle,
  btnPrimary,
  btnDanger,
  btnSecondary,
  labelStyle,
} from '../../ui/styles';
import { normalizeRecipeDescription, parseUpgradeList, normalizeVersion } from './utils';

const readUpgradeList = (spec, key, fallbackKey) => {
  if (!spec || typeof spec !== 'object') return [];
  const raw = spec[key] || spec[fallbackKey];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') return parseUpgradeList(raw);
  return [];
};

const readVersion = (spec) => (typeof spec === 'string' ? spec : (spec?.version || ''));

export default function EditRecipeInline({ recipe, allRecipes, onSave, onCancel }) {
  const [description, setDescription] = useState(recipe.description || '');
  const [releaseDate, setReleaseDate] = useState(recipe.release_date || '');
  const [status, setStatus] = useState(recipe.status || 'GA');
  const [releaseNotes, setReleaseNotes] = useState(recipe.release_notes || '');
  const [components, setComponents] = useState(
    Object.entries(recipe.components || {}).map(([name, spec]) => ({
      name,
      version: readVersion(spec),
      releaseDate: spec?.release_date || '',
      upgradeFrom: readUpgradeList(spec, 'upgrade_from', 'upgradeFrom').join(', '),
      upgradeTo: readUpgradeList(spec, 'upgrade_to', 'upgradeTo').join(', '),
    }))
  );
  const [upgradeFrom, setUpgradeFrom] = useState([...(recipe.upgrade_from || [])]);
  const [upgradeTo, setUpgradeTo] = useState([...(recipe.upgrade_to || [])]);

  const updateComp = (i, field, val) => {
    const next = [...components];
    next[i] = { ...next[i], [field]: val };
    setComponents(next);
  };

  const addComponent = () => setComponents([
    ...components,
    { name: '', version: '', releaseDate: '', upgradeFrom: '', upgradeTo: '' },
  ]);
  const removeComponent = (i) => setComponents(components.filter((_, j) => j !== i));

  const toggleUpgrade = (rv) => {
    setUpgradeTo((prev) => prev.includes(rv) ? prev.filter((p) => p !== rv) : [...prev, rv]);
  };

  const toggleUpgradeFrom = (rv) => {
    setUpgradeFrom((prev) => prev.includes(rv) ? prev.filter((p) => p !== rv) : [...prev, rv]);
  };

  const handleSave = () => {
    const compMap = {};
    components.forEach((c) => {
      if (c.name.trim() && c.version.trim()) {
        const compName = c.name.trim();
        const fromList = parseUpgradeList(c.upgradeFrom);
        const toList = parseUpgradeList(c.upgradeTo);
        compMap[compName] = {
          version: c.version.trim(),
          ...(c.releaseDate.trim() ? { release_date: c.releaseDate.trim() } : {}),
          upgrade_from: fromList,
          upgrade_to: toList,
        };
      }
    });
    const recipeVersion = normalizeVersion(recipe.version);
    const normalizedUpgradeFrom = upgradeFrom.map((p) => normalizeVersion(p)).filter(Boolean);
    const normalizedUpgradeTo = upgradeTo.map((p) => normalizeVersion(p)).filter(Boolean);
    onSave({
      version: recipeVersion,
      description: normalizeRecipeDescription(description, recipeVersion),
      ...(releaseDate.trim() ? { release_date: releaseDate.trim() } : {}),
      ...(status.trim() ? { status: status.trim() } : {}),
      ...(releaseNotes.trim() ? { release_notes: releaseNotes.trim() } : {}),
      components: compMap,
      upgrade_from: normalizedUpgradeFrom,
      upgrade_to: normalizedUpgradeTo,
    });
  };

  const otherRecipes = allRecipes.filter((r) => r.version !== recipe.version);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Release Date</label>
          <input
            style={inputStyle}
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select style={inputStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="GA">GA</option>
            <option value="Beta">Beta</option>
            <option value="Deprecated">Deprecated</option>
            <option value="Retired">Retired</option>
            <option value="Preview">Preview</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Release Notes</label>
        <input
          style={inputStyle}
          placeholder="e.g. Performance and stability improvements"
          value={releaseNotes}
          onChange={(e) => setReleaseNotes(e.target.value)}
        />
      </div>

      <label style={{ ...labelStyle, marginBottom: 8 }}>Components</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {components.map((c, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto',
            gap: 8,
            alignItems: 'center',
          }}>
            <input style={{ ...inputStyle, flex: 1 }} value={c.name}
              onChange={(e) => updateComp(i, 'name', e.target.value)} placeholder="Component" />
            <input style={{ ...inputStyle, flex: 1 }} value={c.version}
              onChange={(e) => updateComp(i, 'version', e.target.value)} placeholder="Version" />
            <input style={{ ...inputStyle, flex: 1 }} value={c.releaseDate || ''}
              onChange={(e) => updateComp(i, 'releaseDate', e.target.value)} placeholder="Release Date" type="date" />
            <input style={{ ...inputStyle, flex: 1 }} value={c.upgradeFrom || ''}
              onChange={(e) => updateComp(i, 'upgradeFrom', e.target.value)} placeholder="Upgradeable from" />
            <input style={{ ...inputStyle, flex: 1 }} value={c.upgradeTo || ''}
              onChange={(e) => updateComp(i, 'upgradeTo', e.target.value)} placeholder="Upgradeable to" />
            <button type="button" onClick={() => removeComponent(i)} style={{ ...btnDanger, padding: '6px 10px' }}>×</button>
          </div>
        ))}
        <button type="button" onClick={addComponent} style={{ ...btnSecondary, alignSelf: 'flex-start', fontSize: 11 }}>
          + Add Component
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Upgrade From (comma-separated)</label>
          <input
            style={inputStyle}
            placeholder="e.g. 1.1.1, 1.1.2"
            value={upgradeFrom.join(', ')}
            onChange={(e) => setUpgradeFrom(parseUpgradeList(e.target.value))}
          />
        </div>
        <div>
          <label style={labelStyle}>Upgrade To (comma-separated)</label>
          <input
            style={inputStyle}
            placeholder="e.g. 1.3.0, 1.4.0"
            value={upgradeTo.join(', ')}
            onChange={(e) => setUpgradeTo(parseUpgradeList(e.target.value))}
          />
        </div>
      </div>

      {otherRecipes.length > 0 && (
        <>
          <label style={{ ...labelStyle, marginBottom: 8 }}>Upgrade From</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {otherRecipes.map((r) => (
              <button key={`from-${r.version}`} type="button" onClick={() => toggleUpgradeFrom(r.version)} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: upgradeFrom.includes(r.version) ? `${T.blue}22` : T.bgCard,
                color: upgradeFrom.includes(r.version) ? T.blue : T.textMuted,
                border: `1px solid ${upgradeFrom.includes(r.version) ? T.blue : T.border}`,
                cursor: 'pointer',
              }}>v{r.version}</button>
            ))}
          </div>
          <label style={{ ...labelStyle, marginBottom: 8 }}>Upgrade To</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {otherRecipes.map((r) => (
              <button key={r.version} type="button" onClick={() => toggleUpgrade(r.version)} style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                background: upgradeTo.includes(r.version) ? `${T.teal}22` : T.bgCard,
                color: upgradeTo.includes(r.version) ? T.teal : T.textMuted,
                border: `1px solid ${upgradeTo.includes(r.version) ? T.teal : T.border}`,
                cursor: 'pointer',
              }}>v{r.version}</button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} style={btnPrimary}>Save Changes</button>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
      </div>
    </div>
  );
}
