import { describeLevels, missingLevels } from './staffing';

describe('missingLevels', () => {
  it('lists the levels that nobody holds', () => {
    expect(missingLevels(3, [])).toEqual([1, 2, 3]);
    expect(missingLevels(3, [3])).toEqual([1, 2]);
    expect(missingLevels(3, [1, 3, 3])).toEqual([2]);
    expect(missingLevels(3, [1, 2, 3])).toEqual([]);
    expect(missingLevels(2, [1, 2, 3])).toEqual([]);
  });

  it('describes them for a message', () => {
    expect(describeLevels([2])).toBe('L2');
    expect(describeLevels([1, 2])).toBe('L1 and L2');
    expect(describeLevels([1, 2, 3])).toBe('L1, L2 and L3');
  });
});
