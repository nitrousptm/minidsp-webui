import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { DeviceConfigState, PresetSummary } from '../../types';

export function PresetManager({ onActivated }: { onActivated: () => void }) {
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [backups, setBackups] = useState<string[]>([]);
  const [backupName, setBackupName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPresets(await api.getPresets());
    setBackups(await api.getBackups());
  }

  useEffect(() => {
    refresh();
  }, []);

  // Every action below talks to minidspd, which is known to occasionally
  // time out on a full-config push (minidspd-watchdog restarts it when that
  // happens). Without this wrapper, that rejection used to skip refresh()/
  // onActivated() entirely - the table kept showing the pre-action state
  // (wrong "Active" checkmark, stale names) with no indication anything had
  // gone wrong, even when the backend had actually applied some or all of
  // the change. Always re-sync from the backend's real state and show the
  // failure instead of silently dropping it.
  async function runAction(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await refresh();
      onActivated();
    }
  }

  async function handleImport(index: number, file: File) {
    const text = await file.text();
    const state = JSON.parse(text) as DeviceConfigState;
    await runAction(() => api.importPreset(index, state));
  }

  return (
    <div>
      {error && (
        <div className="status-banner status-banner-error" style={{ marginBottom: 10 }}>
          {error}
          <button className="small-btn" onClick={() => setError(null)}>
            Ausblenden
          </button>
        </div>
      )}
      {/* five action buttons per row don't fit a phone; scroll the table, not the page */}
      <div className="table-scroll">
      <table className="peq-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Active</th>
            <th colSpan={4}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {presets.map((p) => (
            <tr key={p.index}>
              <td>{p.index + 1}</td>
              <td>
                <input
                  value={p.name}
                  maxLength={12}
                  onChange={(e) => runAction(() => api.renamePreset(p.index, e.target.value))}
                />
              </td>
              <td>{p.active ? '✓' : ''}</td>
              <td>
                <button className="small-btn" onClick={() => runAction(() => api.activatePreset(p.index))}>
                  Select
                </button>
              </td>
              <td>
                <a className="small-btn" href={api.exportPresetUrl(p.index)} download>
                  Export
                </a>
              </td>
              <td>
                <label className="small-btn">
                  Import
                  <input
                    type="file"
                    accept="application/json"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files?.[0] && handleImport(p.index, e.target.files[0])}
                  />
                </label>
              </td>
              <td>
                <button className="small-btn" onClick={() => runAction(() => api.resetPreset(p.index))}>
                  Reset
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="toolbar">
        <button className="small-btn" onClick={() => runAction(() => api.resetAllPresets())}>
          Reset All
        </button>
      </div>

      <hr style={{ borderColor: 'var(--border)', margin: '16px 0' }} />

      <strong style={{ fontSize: 13 }}>Named Backups (beyond the 4 device presets)</strong>
      <div className="toolbar">
        <input
          placeholder="Backup name"
          value={backupName}
          onChange={(e) => setBackupName(e.target.value)}
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '5px 8px' }}
        />
        <button
          className="small-btn primary"
          onClick={async () => {
            if (!backupName) return;
            await runAction(() => api.saveBackup(backupName));
            setBackupName('');
          }}
        >
          Save current config as backup
        </button>
      </div>
      <ul>
        {backups.map((name) => (
          <li key={name} style={{ fontSize: 12, marginBottom: 4 }}>
            {name}{' '}
            <button className="small-btn" onClick={() => runAction(() => api.restoreBackup(name))}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
