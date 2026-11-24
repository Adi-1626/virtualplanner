import { describe, it, expect } from 'vitest';
import { hasUnsavedChanges } from '../scenarios/versions';

/** p11 user test: a new, empty proposal read "Unsaved changes" before any edit. */
const v = (hash: string) => ({ changeSetHash: hash }) as never;
describe('versions: unsaved changes', () => {
  it('a new, empty proposal has nothing to save', () => expect(hasUnsavedChanges({ headChangeSetHash: 'h0', headChangeCount: 0, versions: [] })).toBe(false));
  it('a proposal with changes and no version has unsaved changes', () => expect(hasUnsavedChanges({ headChangeSetHash: 'h1', headChangeCount: 2, versions: [] })).toBe(true));
  it('compares with the latest version once there is one', () => {
    expect(hasUnsavedChanges({ headChangeSetHash: 'h1', headChangeCount: 2, versions: [v('h1')] })).toBe(false);
    expect(hasUnsavedChanges({ headChangeSetHash: 'h2', headChangeCount: 3, versions: [v('h1')] })).toBe(true);
  });
  it('an older server without the count keeps the old reading', () => expect(hasUnsavedChanges({ headChangeSetHash: 'h0', versions: [] })).toBe(true));
  it('no list yet: nothing claimed', () => expect(hasUnsavedChanges(null)).toBe(false));
});
