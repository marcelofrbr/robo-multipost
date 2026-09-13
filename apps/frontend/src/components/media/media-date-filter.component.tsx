'use client';

import { FC, useCallback } from 'react';
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

const inputClass =
  'bg-newBgColorInner h-[36px] border-newTableBorder border rounded-[8px] text-textColor text-[13px] px-[10px] outline-none';

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

  const isPresetActive = useCallback(
    (preset: MediaDatePreset) => {
      const range = presetDateRange(preset, new Date(), tz);
      return range.from === value.from && range.to === value.to;
    },
    [value, tz]
  );

  const applyPreset = useCallback(
    (preset: MediaDatePreset) => () =>
      onChange(presetDateRange(preset, new Date(), tz)),
    [onChange, tz]
  );

  const setFrom = useCallback(
    (from: string) => onChange({ ...value, from: from || undefined }),
    [onChange, value]
  );

  const setTo = useCallback(
    (to: string) => onChange({ ...value, to: to || undefined }),
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
          onClick={() => onChange({})}
        >
          {t('media_filter_clear', 'Clear')}
        </button>
      )}
    </div>
  );
};
