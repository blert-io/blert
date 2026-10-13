/** Prefixes `phrase` with its indefinite article ("a" or "an"). */
export function withIndefiniteArticle(phrase: string): string {
  const article = /^([aeiou]|8|1[18]\b)/i.test(phrase) ? 'an' : 'a';
  return `${article} ${phrase}`;
}

/** Formats a list of items as a comma-separated string. */
export function oxford(items: string[]): string {
  if (items.length === 0) {
    return '';
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return items.join(' and ');
  }
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}
