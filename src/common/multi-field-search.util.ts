/**
 * Turns a free-text `search` query into per-word Prisma filters, so a
 * query like "Jane Doe" matches a record whose first/last name are split
 * across two separate columns.
 *
 * A single `OR: [{ firstName: { contains: search } }, { lastName: {
 * contains: search } }, ...]` (the pattern this replaces) only ever tests
 * the *whole* search string against *one* column at a time — "Jane Doe"
 * never matches because no single column stores "Jane Doe": firstName
 * holds "Jane", lastName holds "Doe". Splitting the query on whitespace
 * and requiring every word to match *some* field (AND of per-word ORs)
 * fixes that while staying a single-word no-op for the common case.
 *
 * @param search Raw query.search value (may be undefined/empty).
 * @param fieldsForTerm Given one search word, the fields to OR it against
 *   (same shape as the old inline OR array's entries).
 * @returns `{ AND: [...] }` to spread into a Prisma `where`, or `{}` when
 *   there's nothing to search on.
 */
export function buildMultiFieldSearchWhere<TFieldFilter>(
  search: string | undefined,
  fieldsForTerm: (term: string) => TFieldFilter[],
): { AND: { OR: TFieldFilter[] }[] } | Record<string, never> {
  const terms = search?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (terms.length === 0) return {};
  return { AND: terms.map((term) => ({ OR: fieldsForTerm(term) })) };
}
