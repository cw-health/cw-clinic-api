import { buildMultiFieldSearchWhere } from './multi-field-search.util';

describe('buildMultiFieldSearchWhere', () => {
  const fieldsForTerm = (term: string) => [
    { firstName: { contains: term } },
    { lastName: { contains: term } },
  ];

  it('returns an empty object for undefined/blank search', () => {
    expect(buildMultiFieldSearchWhere(undefined, fieldsForTerm)).toEqual({});
    expect(buildMultiFieldSearchWhere('   ', fieldsForTerm)).toEqual({});
  });

  it('a single-word search stays a plain OR (one AND branch)', () => {
    expect(buildMultiFieldSearchWhere('jane', fieldsForTerm)).toEqual({
      AND: [{ OR: [{ firstName: { contains: 'jane' } }, { lastName: { contains: 'jane' } }] }],
    });
  });

  it('a multi-word search ANDs one OR-branch per word, collapsing extra whitespace', () => {
    expect(buildMultiFieldSearchWhere('  Jane   Doe ', fieldsForTerm)).toEqual({
      AND: [
        { OR: [{ firstName: { contains: 'Jane' } }, { lastName: { contains: 'Jane' } }] },
        { OR: [{ firstName: { contains: 'Doe' } }, { lastName: { contains: 'Doe' } }] },
      ],
    });
  });
});
