import { describe, expect, it } from 'vitest';
import { colorChoices, COMMON_COLORS } from '@/lib/colors';

describe('colorChoices', () => {
  it('offers store presets first, then the common clothing colours', () => {
    const list = colorChoices([{ name: 'Sand', hex: '#D9C7A3' }], []);
    expect(list[0]!.name).toBe('Sand');
    expect(list.map((c) => c.name)).toEqual(expect.arrayContaining(['Black', 'White', 'Navy', 'Red', 'Olive']));
    expect(list).toHaveLength(COMMON_COLORS.length + 1);
  });

  it('never lists the same colour name twice, ignoring case', () => {
    const list = colorChoices([{ name: 'black', hex: '#000000' }], [{ name: 'RED', hex: '#FF0000' }]);
    expect(list.filter((c) => c.name.toLowerCase() === 'black')).toHaveLength(1);
    expect(list.find((c) => c.name.toLowerCase() === 'black')!.hex).toBe('#000000');
    expect(list.filter((c) => c.name.toLowerCase() === 'red')).toHaveLength(1);
  });
});
