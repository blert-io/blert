import { SessionStatus } from '@blert/common';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';

import Input from '@/components/input';

import {
  DateRangeFilter,
  FilterField,
  FilterRow,
  FilterSection,
  PartyFilter,
  ScaleFilter,
  StatusFilter,
  TypeFilter,
} from '../filter-controls';

import { SessionSearchContext, SessionSearchFilters } from './context';

import styles from './style.module.scss';

type FiltersProps = {
  context: SessionSearchContext;
  setContext: Dispatch<SetStateAction<SessionSearchContext>>;
  loading: boolean;
};

const STATUS_OPTIONS = [
  { value: SessionStatus.COMPLETED, label: 'Completed' },
  { value: SessionStatus.ACTIVE, label: 'Active' },
];

type RangeFilterProps = {
  label: string;
  id: string;
  minValue: number | null;
  maxValue: number | null;
  minField: keyof SessionSearchFilters;
  maxField: keyof SessionSearchFilters;
  inputWidth?: number;
  setContext: FiltersProps['setContext'];
  loading: boolean;
};

function RangeFilter({
  label,
  id,
  minValue,
  maxValue,
  minField,
  maxField,
  inputWidth = 90,
  setContext,
  loading,
}: RangeFilterProps) {
  const [minText, setMinText] = useState(minValue?.toString() ?? '');
  const [maxText, setMaxText] = useState(maxValue?.toString() ?? '');

  useEffect(() => setMinText(minValue?.toString() ?? ''), [minValue]);
  useEffect(() => setMaxText(maxValue?.toString() ?? ''), [maxValue]);

  function commit(field: keyof SessionSearchFilters, text: string) {
    const parsed = parseInt(text);
    const value = isNaN(parsed) || parsed < 1 ? null : parsed;
    setContext((prev) => {
      if (value === prev.filters[field]) {
        return prev;
      }
      return {
        ...prev,
        filters: { ...prev.filters, [field]: value },
        pagination: {},
      };
    });
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    field: keyof SessionSearchFilters,
    text: string,
  ) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(field, text);
    }
  }

  return (
    <FilterField label={label}>
      <div className={styles.rangeContainer}>
        <Input
          disabled={loading}
          id={`filters-min-${id}`}
          label="Min"
          labelBg="var(--blert-filter-surface)"
          type="number"
          value={minText}
          width={inputWidth}
          onChange={(e) => setMinText(e.target.value)}
          onBlur={() => commit(minField, minText)}
          onKeyDown={(e) => handleKeyDown(e, minField, minText)}
        />
        <span className={styles.rangeSeparator}>&ndash;</span>
        <Input
          disabled={loading}
          id={`filters-max-${id}`}
          label="Max"
          labelBg="var(--blert-filter-surface)"
          type="number"
          value={maxText}
          width={inputWidth}
          onChange={(e) => setMaxText(e.target.value)}
          onBlur={() => commit(maxField, maxText)}
          onKeyDown={(e) => handleKeyDown(e, maxField, maxText)}
        />
      </div>
    </FilterField>
  );
}

export default function Filters({
  context,
  setContext,
  loading,
}: FiltersProps) {
  function updateFilters(update: Partial<SessionSearchFilters>) {
    setContext((prev) => ({
      ...prev,
      filters: { ...prev.filters, ...update },
      pagination: {},
    }));
  }

  return (
    <div className={styles.filters}>
      <FilterRow>
        <TypeFilter
          type={context.filters.type}
          mode={context.filters.mode}
          onChange={(type, mode) => updateFilters({ type, mode })}
          disabled={loading}
        />
        <ScaleFilter
          scale={context.filters.scale}
          type={context.filters.type}
          onChange={(scale) => updateFilters({ scale })}
          disabled={loading}
        />
      </FilterRow>

      <StatusFilter
        status={context.filters.status}
        options={STATUS_OPTIONS}
        onChange={(status) => updateFilters({ status })}
        disabled={loading}
      />

      <DateRangeFilter
        startDate={context.filters.startDate}
        endDate={context.filters.endDate}
        onChange={(startDate, endDate) => updateFilters({ startDate, endDate })}
        disabled={loading}
      />

      <PartyFilter
        party={context.filters.party}
        onChange={(party) => updateFilters({ party })}
        disabled={loading}
      />

      <FilterSection title="Session metrics">
        <RangeFilter
          label="Challenge count"
          id="challenge-count"
          minValue={context.filters.minChallengeCount}
          maxValue={context.filters.maxChallengeCount}
          minField="minChallengeCount"
          maxField="maxChallengeCount"
          setContext={setContext}
          loading={loading}
        />
        <RangeFilter
          label="Duration (mins)"
          id="duration"
          minValue={context.filters.minDurationMinutes}
          maxValue={context.filters.maxDurationMinutes}
          minField="minDurationMinutes"
          maxField="maxDurationMinutes"
          setContext={setContext}
          loading={loading}
        />
      </FilterSection>
    </div>
  );
}
