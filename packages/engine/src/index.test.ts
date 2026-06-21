import { expect, test } from 'vitest';
import { health } from './index';

test('health function returns murl-engine-ok', () => {
  expect(health()).toBe('murl-engine-ok');
});
