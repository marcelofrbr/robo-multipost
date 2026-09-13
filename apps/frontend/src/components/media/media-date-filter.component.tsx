'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import {
  isValidDateRange,
  MediaDatePreset,
  MediaDateRange,
  presetDateRange,
} from '@gitroom/frontend/components/media/media-date-range.helper';

const PRESETS: { key: MediaDatePreset; label: string; fallback: string }[] = [
  { key: 'today', label: 'media_filter_today', fallback: 'Today' },
  { key: 'last7', label: 'media_filter_last_7_days', fallback: '7 days' },
  { key: 'last30', label: 'media_filter_last_30_days', fallback: '30 days' },
  { key: 'thisMonth', label: 'media_filter_this_month', fallback: 'This month' },
];

// `color-scheme` acompanha o tema: sem isso o icone do calendario nativo some
// no escuro e o popup abre claro.
const inputClass =
  'bg-newBgColorInner h-[36px] border-newTableBorder border rounded-[8px] text-textColor text-[13px] px-[10px] outline-none [color-scheme:light] dark:[color-scheme:dark]';

const chipClass = (active: boolean) =>
  clsx(
    'h-[36px] px-[12px] rounded-[8px] text-[13px] border transition-colors',
    active
      ? 'bg-btnSimple border-transparent text-white'
      : 'bg-newBgColorInner border-newTableBorder text-textColor hover:bg-newTextColor/[0.06]'
  );

/**
 * Barra de filtro por data de upload: atalhos + periodo livre + limpar.
 * Emite datas locais (YYYY-MM-DD); quem consome converte para ISO com
 * `toIsoRange`.
 */
export const MediaDateFilter: FC<{
  value: MediaDateRange;
  onChange: (range: MediaDateRange) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const tz = getTimezone();
  // Ultimo atalho clicado: evita dois chips "ativos" quando dois atalhos
  // produzem o mesmo periodo (ex.: Hoje e Este mes no dia 1). Continua exigindo
  // que o periodo bata, para desativar quando o pai limpa o filtro.
  const [activePreset, setActivePreset] = useState<MediaDatePreset | null>(
    null
  );

  const isPresetActive = useCallback(
    (preset: MediaDatePreset) => {
      if (activePreset !== preset) {
        return false;
      }
      const range = presetDateRange(preset, new Date(), tz);
      return range.from === value.from && range.to === value.to;
    },
    [activePreset, value, tz]
  );

  const applyPreset = useCallback(
    (preset: MediaDatePreset) => () => {
      setActivePreset(preset);
      onChange(presetDateRange(preset, new Date(), tz));
    },
    [onChange, tz]
  );

  const setFrom = useCallback(
    (from: string) => {
      setActivePreset(null);
      onChange({ ...value, from: from || undefined });
    },
    [onChange, value]
  );

  const setTo = useCallback(
    (to: string) => {
      setActivePreset(null);
      onChange({ ...value, to: to || undefined });
    },
    [onChange, value]
  );

  const hasFilter = !!value.from || !!value.to;
  const invalid = !isValidDateRange(value);

  return (
    <div
      className="flex flex-wrap items-center gap-[8px]"
      role="group"
      aria-label={t('media_filter_date', 'Filter by date')}
    >
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className={chipClass(isPresetActive(preset.key))}
          aria-pressed={isPresetActive(preset.key)}
          onClick={applyPreset(preset.key)}
        >
          {t(preset.label, preset.fallback)}
        </button>
      ))}
      <label className="flex items-center gap-[6px] text-[13px] text-textColor">
        {t('media_filter_from', 'From')}
        <input
          type="date"
          className={clsx(inputClass, invalid && 'border-red-400')}
          value={value.from || ''}
          max={value.to || undefined}
          aria-invalid={invalid}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-[6px] text-[13px] text-textColor">
        {t('media_filter_to', 'To')}
        <input
          type="date"
          className={clsx(inputClass, invalid && 'border-red-400')}
          value={value.to || ''}
          min={value.from || undefined}
          aria-invalid={invalid}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      {hasFilter && (
        <button
          type="button"
          className="h-[36px] px-[12px] rounded-[8px] text-[13px] text-textColor underline"
          onClick={() => {
            setActivePreset(null);
            onChange({});
          }}
        >
          {t('media_filter_clear', 'Clear')}
        </button>
      )}
      {invalid && (
        <div role="alert" className="basis-full text-[12px] text-red-400">
          {t(
            'media_filter_invalid_range',
            'The start date must be on or before the end date'
          )}
        </div>
      )}
    </div>
  );
};
