import { Tooltip } from './tooltip';
export default Tooltip;

/**
 * ID of the global basic tooltip, which is always available.
 * Any component that doesn't need custom rendering for tooltip content should
 * use this tooltip ID and set `data-tooltip-content` to the text that should be
 * displayed in the tooltip.
 */
export const GLOBAL_TOOLTIP_ID = 'blert-global-tooltip';
