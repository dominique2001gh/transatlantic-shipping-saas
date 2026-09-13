/**
 * Pure matching logic behind components/forms/SearchableSelect.tsx,
 * pulled out on its own so it's testable without a DOM (this repo's web
 * tests are plain node:test over pure functions — see
 * hostname-routing.test.ts's own doc comment — there's no React
 * rendering harness here, so component logic that needs real test
 * coverage has to live in a function like this one, not inside the
 * component itself).
 *
 * Whitespace-split, case-insensitive, every-token-must-match (AND)
 * substring search against a single caller-supplied haystack string per
 * item — deliberately not "starts with" or single-substring, so a query
 * like "owusu michael" or "michael ta-000013" still matches regardless
 * of field order, the same forgiving behavior users expect from a
 * combobox search box.
 */
export interface SearchableSelectMatchResult<T> {
  /** At most maxResults items, in the same relative order as the input. */
  matches: T[];
  /** How many additional items matched but were cut off by maxResults — 0 when everything that matched is included in `matches`. */
  truncatedCount: number;
}

export function filterSearchableOptions<T>(
  items: T[],
  query: string,
  getSearchText: (item: T) => string,
  maxResults = 50,
): SearchableSelectMatchResult<T> {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const allMatches =
    tokens.length === 0
      ? items
      : items.filter((item) => {
          const haystack = getSearchText(item).toLowerCase();
          return tokens.every((token) => haystack.includes(token));
        });
  return {
    matches: allMatches.slice(0, maxResults),
    truncatedCount: Math.max(0, allMatches.length - maxResults),
  };
}
