import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyPreparationResetSchema } from '../../src/lib/dashboard/daily-preparation-reset.ts';

const id = '00000000-0000-4000-8000-000000000001';
const base = { enabled: true, availableEverywhere: true, businessLocationIds: [], methodValues: [] };

test('accepts default restoration and integer endpoints', () => {
  for (const resetMinutes of [null, 1, 10, 180]) {
    assert.equal(dailyPreparationResetSchema.safeParse({ ...base, methodValues: [{ id, resetMinutes }] }).success, true);
  }
});
test('rejects invalid values, identifiers, duplicate methods and missing enabled locations', () => {
  for (const resetMinutes of [0, 181, -1, 2.5, NaN, Infinity, '', '10', true]) {
    assert.equal(dailyPreparationResetSchema.safeParse({ ...base, methodValues: [{ id, resetMinutes }] }).success, false);
  }
  assert.equal(dailyPreparationResetSchema.safeParse({ ...base, availableEverywhere: false }).success, false);
  assert.equal(dailyPreparationResetSchema.safeParse({ ...base, businessLocationIds: ['bad-id'] }).success, false);
  assert.equal(dailyPreparationResetSchema.safeParse({ ...base, methodValues: [{ id, resetMinutes: 10 }, { id, resetMinutes: 20 }] }).success, false);
});
test('allows disabling without locations and selecting a location', () => {
  assert.equal(dailyPreparationResetSchema.safeParse({ ...base, enabled: false, availableEverywhere: false }).success, true);
  assert.equal(dailyPreparationResetSchema.safeParse({ ...base, availableEverywhere: false, businessLocationIds: [id] }).success, true);
});
