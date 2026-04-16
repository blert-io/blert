'use client';

import { ChallengeMode, ChallengeType } from '@blert/common';

import Checkbox from '@/components/checkbox';
import DatePicker from '@/components/date-picker';
import PlayerSearch from '@/components/player-search';
import TagList from '@/components/tag-list';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './filter-controls.module.scss';

const DATE_INPUT_WIDTH = 132;
const MAX_PARTY_SIZE = 5;

const NO_MODE_CHALLENGE_TYPES = new Set<ChallengeType>([
  ChallengeType.COLOSSEUM,
  ChallengeType.INFERNO,
  ChallengeType.MOKHAIOTL,
]);

function isTobMode(mode: ChallengeMode): boolean {
  return mode >= ChallengeMode.TOB_ENTRY && mode <= ChallengeMode.TOB_HARD;
}

type FilterSectionProps = {
  title?: string;
  /** Optional action rendered in the section header. */
  action?: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Logical grouping of one or more filters.
 * Renders an optional heading above its children.
 */
export function FilterSection({ title, action, children }: FilterSectionProps) {
  const hasHeader = title !== undefined || action !== undefined;
  return (
    <section className={styles.section}>
      {hasHeader && (
        <div className={styles.sectionHeader}>
          {title !== undefined && (
            <h4 className={styles.sectionTitle}>{title}</h4>
          )}
          {action !== undefined && (
            <div className={styles.sectionAction}>{action}</div>
          )}
        </div>
      )}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

type FilterFieldProps = {
  label: string;
  htmlFor?: string;
  /** Identifier mirrored as a `data-field-id` attribute on the wrapper. */
  fieldId?: string;
  onRemove?: () => void;
  children: React.ReactNode;
};

/**
 * A single labeled filter. Used inside a {@link FilterSection} (or standalone).
 */
export function FilterField({
  label,
  htmlFor,
  fieldId,
  onRemove,
  children,
}: FilterFieldProps) {
  return (
    <div className={styles.field} data-field-id={fieldId}>
      <div className={styles.fieldLabelRow}>
        <label className={styles.fieldLabel} htmlFor={htmlFor}>
          {label}
        </label>
        {onRemove !== undefined && (
          <button
            className={styles.fieldRemove}
            onClick={onRemove}
            type="button"
            aria-label={`Remove filter ${label}`}
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        )}
      </div>
      <div className={styles.fieldBody}>{children}</div>
    </div>
  );
}

/** Horizontal grouping of fields. */
export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

type PartyFilterProps = {
  party: string[];
  onChange: (party: string[]) => void;
  disabled?: boolean;
};

export function PartyFilter({
  party,
  onChange,
  disabled = false,
}: PartyFilterProps) {
  return (
    <FilterField label="Party" htmlFor="filters-player">
      <div className={styles.partyInput}>
        <PlayerSearch
          disabled={disabled || party.length >= MAX_PARTY_SIZE}
          label="Enter username"
          labelBg="var(--blert-filter-surface)"
          id="filters-player"
          onSelection={(username) => {
            if (!party.includes(username)) {
              onChange([...party, username]);
            }
          }}
        />
        <TagList
          onRemove={(username) => onChange(party.filter((u) => u !== username))}
          tags={party}
        />
      </div>
    </FilterField>
  );
}

type DateRangeFilterProps = {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (startDate: Date | null, endDate: Date | null) => void;
  disabled?: boolean;
};

export function DateRangeFilter({
  startDate,
  endDate,
  onChange,
  disabled = false,
}: DateRangeFilterProps) {
  return (
    <FilterField label="Date">
      <div className={styles.dateRange}>
        <DatePicker
          disabled={disabled}
          icon="fas fa-calendar-alt"
          isClearable
          maxDate={endDate ?? new Date()}
          placeholderText="From"
          popperPlacement="bottom"
          selected={startDate}
          onChange={(date) => onChange(date, endDate)}
          showIcon
          width={DATE_INPUT_WIDTH}
        />
        <DatePicker
          disabled={disabled}
          icon="fas fa-calendar-alt"
          isClearable
          maxDate={new Date()}
          minDate={startDate ?? undefined}
          placeholderText="To"
          popperPlacement="bottom"
          selected={endDate}
          onChange={(date) => onChange(startDate, date)}
          showIcon
          width={DATE_INPUT_WIDTH}
        />
      </div>
    </FilterField>
  );
}

type TypeFilterProps = {
  type: ChallengeType[];
  mode: ChallengeMode[];
  onChange: (type: ChallengeType[], mode: ChallengeMode[]) => void;
  disabled?: boolean;
  disabledTypes?: ChallengeType[];
  disabledTypesMessage?: string;
};

export function toggleTobMode(
  type: ChallengeType[],
  mode: ChallengeMode[],
  targetMode: ChallengeMode,
): { type: ChallengeType[]; mode: ChallengeMode[] } {
  const remove = mode.includes(targetMode);
  if (remove) {
    const tobModes = mode.filter(isTobMode).length;
    return {
      mode: mode.filter((v) => v !== targetMode),
      type: tobModes === 1 ? type.filter((v) => v !== ChallengeType.TOB) : type,
    };
  }
  return {
    mode: [...mode, targetMode],
    type: type.includes(ChallengeType.TOB)
      ? type
      : [...type, ChallengeType.TOB],
  };
}

export function toggleNoModeType(
  type: ChallengeType[],
  mode: ChallengeMode[],
  targetType: ChallengeType,
): { type: ChallengeType[]; mode: ChallengeMode[] } {
  const remove = type.includes(targetType);
  if (remove) {
    const keepNoMode = type.some(
      (t) => t !== targetType && NO_MODE_CHALLENGE_TYPES.has(t),
    );
    return {
      type: type.filter((t) => t !== targetType),
      mode: keepNoMode ? mode : mode.filter((m) => m !== ChallengeMode.NO_MODE),
    };
  }
  const hasNoMode = mode.includes(ChallengeMode.NO_MODE);
  return {
    type: [...type, targetType],
    mode: hasNoMode ? mode : [...mode, ChallengeMode.NO_MODE],
  };
}

export function TypeFilter({
  type,
  mode,
  onChange,
  disabled = false,
  disabledTypes = [],
  disabledTypesMessage,
}: TypeFilterProps) {
  const tobRegularChecked =
    type.includes(ChallengeType.TOB) &&
    mode.includes(ChallengeMode.TOB_REGULAR);
  const tobHardChecked =
    type.includes(ChallengeType.TOB) && mode.includes(ChallengeMode.TOB_HARD);

  function maybeWrapDisabled(checkboxEl: React.ReactNode, isDisabled: boolean) {
    if (!isDisabled || disabledTypesMessage === undefined) {
      return checkboxEl;
    }
    return (
      <div
        data-tooltip-id={GLOBAL_TOOLTIP_ID}
        data-tooltip-content={disabledTypesMessage}
      >
        {checkboxEl}
      </div>
    );
  }

  const tobDisabled =
    disabledTypes.includes(ChallengeType.TOB) &&
    !type.includes(ChallengeType.TOB);

  function tobModeCheckbox(
    target: ChallengeMode,
    label: string,
    checked: boolean,
  ) {
    return maybeWrapDisabled(
      <Checkbox
        checked={checked}
        disabled={disabled || (tobDisabled && !checked)}
        onChange={() => {
          const next = toggleTobMode(type, mode, target);
          onChange(next.type, next.mode);
        }}
        label={label}
        simple
      />,
      tobDisabled && !checked,
    );
  }

  function noModeCheckbox(target: ChallengeType, label: string) {
    const checked = type.includes(target);
    const isDisabled = disabledTypes.includes(target) && !checked;
    return maybeWrapDisabled(
      <Checkbox
        checked={checked}
        disabled={disabled || isDisabled}
        onChange={() => {
          const next = toggleNoModeType(type, mode, target);
          onChange(next.type, next.mode);
        }}
        label={label}
        simple
      />,
      isDisabled,
    );
  }

  return (
    <FilterField label="Type">
      <div className={styles.checkboxList}>
        {tobModeCheckbox(
          ChallengeMode.TOB_REGULAR,
          'ToB Regular',
          tobRegularChecked,
        )}
        {tobModeCheckbox(ChallengeMode.TOB_HARD, 'ToB Hard', tobHardChecked)}
        {noModeCheckbox(ChallengeType.INFERNO, 'Inferno')}
        {noModeCheckbox(ChallengeType.COLOSSEUM, 'Colosseum')}
        {noModeCheckbox(ChallengeType.MOKHAIOTL, 'Mokhaiotl')}
      </div>
    </FilterField>
  );
}

type ScaleFilterProps = {
  scale: number[];
  type: ChallengeType[];
  onChange: (scale: number[]) => void;
  disabled?: boolean;
};

export function ScaleFilter({
  scale,
  type,
  onChange,
  disabled = false,
}: ScaleFilterProps) {
  const hasTeamChallenges =
    type.length === 0 || type.includes(ChallengeType.TOB);

  function toggle(value: number) {
    if (scale.includes(value)) {
      onChange(scale.filter((v) => v !== value));
    } else {
      onChange([...scale, value]);
    }
  }

  function checkbox(value: number, label: string, teamOnly: boolean = false) {
    const checked = scale.includes(value);
    const isDisabled = teamOnly && !hasTeamChallenges && !checked;
    const checkboxEl = (
      <Checkbox
        checked={checked}
        disabled={disabled || isDisabled}
        onChange={() => toggle(value)}
        label={label}
        simple
      />
    );
    if (!isDisabled) {
      return checkboxEl;
    }
    return (
      <div
        data-tooltip-id={GLOBAL_TOOLTIP_ID}
        data-tooltip-content="Only available for team challenge types"
      >
        {checkboxEl}
      </div>
    );
  }

  return (
    <FilterField label="Scale">
      <div className={styles.checkboxList}>
        {checkbox(1, 'Solo')}
        {checkbox(2, 'Duo', true)}
        {checkbox(3, 'Trio', true)}
        {checkbox(4, '4s', true)}
        {checkbox(5, '5s', true)}
      </div>
    </FilterField>
  );
}

type StatusOption<T extends number> = {
  value: T;
  label: string;
};

type StatusFilterProps<T extends number> = {
  status: T[];
  options: StatusOption<T>[];
  onChange: (status: T[]) => void;
  disabled?: boolean;
};

export function StatusFilter<T extends number>({
  status,
  options,
  onChange,
  disabled = false,
}: StatusFilterProps<T>) {
  function toggle(value: T) {
    if (status.includes(value)) {
      onChange(status.filter((v) => v !== value));
    } else {
      onChange([...status, value]);
    }
  }

  return (
    <FilterField label="Status">
      <div className={styles.checkboxList}>
        {options.map((option) => (
          <Checkbox
            key={option.value}
            checked={status.includes(option.value)}
            disabled={disabled}
            onChange={() => toggle(option.value)}
            label={option.label}
            simple
          />
        ))}
      </div>
    </FilterField>
  );
}
