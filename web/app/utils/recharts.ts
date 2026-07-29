import { ReactNode } from 'react';
import type {
  TooltipPayload,
  TooltipPayloadEntry,
  TooltipValueType,
} from 'recharts';

/** Rendered content of a tooltip formatter, optionally paired with a name. */
type FormatterResult = ReactNode | [ReactNode, number | string];

/** A tooltip payload entry whose `payload` is the chart's own datum type. */
type TooltipEntry<P> = Omit<TooltipPayloadEntry, 'payload'> & {
  payload?: P;
};

/** The `formatter` signature required by Recharts' `Tooltip`. */
type TooltipFormatter = (
  value: TooltipValueType | undefined,
  name: number | string | undefined,
  item: TooltipPayloadEntry,
  index: number,
  payload: TooltipPayload,
) => FormatterResult;

/** The `labelFormatter` signature required by Recharts' `Tooltip`. */
type TooltipLabelFormatter = (
  label: ReactNode,
  payload: TooltipPayload,
) => ReactNode;

/**
 * Wraps a tooltip formatter which operates on numeric values, adapting it to
 * the signature Recharts requires.
 *
 * Entries whose value is not a number render nothing.
 *
 * @param format Receives the entry's numeric value, its name (empty if unset),
 *   and the full payload entry.
 */
export function numberFormatter<P = unknown>(
  format: (
    value: number,
    name: string,
    item: TooltipEntry<P>,
  ) => FormatterResult,
): TooltipFormatter {
  return (value, name, item) => {
    if (typeof value !== 'number') {
      return null;
    }
    return format(value, name === undefined ? '' : String(name), item);
  };
}

/**
 * Wraps a tooltip label formatter which operates on numeric labels, adapting
 * it to the signature Recharts requires.
 *
 * Non-numeric labels render nothing.
 *
 * @param format Formatter function taking the numeric label as a string and the
 *    tooltip's payload.
 */
export function numberLabel<P = unknown>(
  format: (label: number, payload: readonly TooltipEntry<P>[]) => ReactNode,
): TooltipLabelFormatter {
  return (label, payload) => {
    if (typeof label !== 'number') {
      return null;
    }
    return format(label, payload);
  };
}

/**
 * Wraps a tooltip label formatter which operates on textual labels, adapting
 * it to the signature Recharts requires. Numeric labels are stringified.
 *
 * Labels which are neither a string nor a number render nothing.
 *
 * @param format Formatter function taking the label as a string and the
 *    tooltip's payload.
 */
export function stringLabel<P = unknown>(
  format: (label: string, payload: readonly TooltipEntry<P>[]) => ReactNode,
): TooltipLabelFormatter {
  return (label, payload) => {
    if (typeof label !== 'string' && typeof label !== 'number') {
      return null;
    }
    return format(String(label), payload);
  };
}
