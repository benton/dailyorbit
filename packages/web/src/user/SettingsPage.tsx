import { unhideAll } from '../lib/hidden-items.ts';
import { useSettings } from '../lib/settings-context.tsx';
import { THEMES } from '../lib/themes.ts';
import { Button } from '../ui/button.tsx';

export default function SettingsPage() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-on-surface">Settings</h1>

      <div className="rounded-theme border border-border-theme bg-surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
          Preferences
        </h2>
        <div className="space-y-4">
          <ToggleRow
            checked={settings?.emailDailyOrbit ?? false}
            description="Email me when new content matches my alert searches"
            label="Email Alerts"
            onChange={(v: boolean) => updateSetting('emailDailyOrbit', v)}
          />
          <ToggleRow
            checked={settings?.wideView ?? false}
            description="Use a wider page layout for more content"
            label="Wide View"
            onChange={(v: boolean) => updateSetting('wideView', v)}
          />
        </div>

        <div className="mt-4 border-t border-border-theme pt-4">
          <p className="mb-3 text-sm font-medium text-on-surface">Theme</p>
          <div className="flex gap-3">
            {THEMES.map((theme) => (
              <ThemeCard
                active={(settings?.theme ?? 'modern') === theme.id}
                description={theme.description}
                key={theme.id}
                label={theme.name}
                onClick={() => updateSetting('theme', theme.id)}
                sampleBg={theme.swatchBg}
                sampleBorder={theme.swatchBorder}
                sampleFont={theme.fontSample}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-theme border border-border-theme bg-surface-card p-6">
        <h2 className="mb-4 text-sm font-semibold tracking-wider text-on-surface-muted uppercase">
          Hidden Items
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-on-surface">Unhide All Items</p>
            <p className="text-xs text-on-surface-muted">
              Make all your personally hidden filings and news items visible again
            </p>
          </div>
          <Button
            className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
            onClick={() => {
              if (
                !confirm(
                  'Unhide all hidden items? This will make all your personally hidden filings and news items visible again.',
                )
              ) {
                return;
              }
              void unhideAll().then((count: number) => {
                alert(`${String(count)} item(s) unhidden.`);
              });
            }}
            size="sm"
          >
            Unhide All
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-on-surface">{label}</p>
        <p className="text-xs text-on-surface-muted">{description}</p>
      </div>
      <button
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          checked ? 'bg-on-surface' : 'bg-on-surface/20'
        }`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-surface-card shadow ring-0 transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function ThemeCard({
  active,
  description,
  label,
  onClick,
  sampleBg,
  sampleBorder,
  sampleFont,
}: {
  active: boolean;
  description: string;
  label: string;
  onClick: () => void;
  sampleBg: string;
  sampleBorder: string;
  sampleFont: string;
}) {
  return (
    <button
      className={`flex flex-1 flex-col items-center gap-2 rounded-theme border-2 p-4 transition-colors ${
        active
          ? 'border-on-surface bg-surface'
          : 'border-border-theme bg-surface-card hover:border-on-surface-muted'
      }`}
      onClick={onClick}
      type="button"
    >
      <div
        className="flex h-10 w-full items-center justify-center rounded"
        style={{ backgroundColor: sampleBg, border: `1px solid ${sampleBorder}` }}
      >
        <span className="text-lg text-on-surface" style={{ fontFamily: sampleFont }}>
          Aa
        </span>
      </div>
      <p className="text-sm font-medium text-on-surface">{label}</p>
      <p className="text-xs text-on-surface-muted">{description}</p>
    </button>
  );
}
