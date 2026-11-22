/**
 * A drawn curved road (PI + radius alignment) saved to the backend and loaded again keeps its alignment.
 *
 * Two halves share one fixture, backend/tests/fixtures/objects/drawn_curved_road.json (the row the app POSTs):
 *  - here: the fixture IS what the app saves for this drawing (Road tool, 3 clicks, auto curve), and the row the
 *    backend returns for it (identical, checked by the backend half) loads back into an object whose shape editor
 *    sees the same alignment (not a migrated polyline) and whose coordinates are that alignment densified;
 *  - backend/tests/test_alignment_round_trip.py: POST /api/objects (and /batch) then GET /api/objects returns that row
 *    unchanged, alignment included, also after a reshape is saved over it.
 * Regenerate the fixture after a deliberate change of the saved shape: UPDATE_FIXTURES=1 npx vitest run AlignmentRoundTrip
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { destination, type Pt3 } from '../editing/drawConstraints';
import { editableOf } from '../editing/AlignmentEditor';
import { densifyAlignment } from '../geometry/alignment/index';
import { objectFromRow, objectToRow, type ObjectRow } from '../objects/objectRows';
import type { RoadObject } from '../objects/types';

const FIXTURE = path.join(__dirname, '../../../../backend/tests/fixtures/objects/drawn_curved_road.json');
const O: Pt3 = [73.85, 18.5, 0];
const P1 = destination(O, 0, 300), P2 = destination(P1, 90, 300);
const T = '2026-11-22T07:00:00.000Z';

function drawnRow(): ObjectRow {
  const om = new ObjectManager();
  const editing = new EditingEngine(om, new HistoryManager(om));
  editing.setMode('draw_road');
  [O, P1, P2].forEach(p => editing.addDrawingPoint(p));
  editing.finalizeDrawing('base');
  const road = om.getAll().find(o => o.type === 'road') as RoadObject;
  // Fixed id and times (random / clock-based in the app): everything else is exactly what the app sends
  const row = objectToRow({ ...road, id: 'syn_curved_road', name: 'SYNTHETIC curved road', createdAt: T, updatedAt: T });
  expect(om.schemaOf(road)).toEqual({ ...row, id: road.id, name: road.name, properties: { ...row.properties, createdAt: road.createdAt, updatedAt: road.updatedAt } });
  return JSON.parse(JSON.stringify(row));
}

describe('drawn curved road: save → reload keeps the alignment', () => {
  it('the backend fixture is the row the app saves for the drawing', () => {
    const row = drawnRow();
    if (process.env.UPDATE_FIXTURES) fs.writeFileSync(FIXTURE, JSON.stringify(row, null, 1) + '\n');
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as ObjectRow;
    expect(fixture).toEqual(row);
    const a = (fixture.properties as { alignment: RoadObject['alignment'] }).alignment!;
    expect(a.pis).toHaveLength(3);
    expect(a.pis[1].radiusM).toBeGreaterThan(0);
    expect(a.pis[1].radiusSource).toBe('auto');
  });

  it('the row as loaded back gives the same alignment to the shape editor, and coordinates follow from it', () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as ObjectRow;
    // What GET /api/objects returns for it (the backend half asserts it is the posted row, unchanged)
    const loaded = objectFromRow(JSON.parse(JSON.stringify(fixture))) as RoadObject;
    expect(loaded.alignment).toEqual(fixture.properties.alignment);
    expect(loaded.createdAt).toBe(T);
    const ed = editableOf(loaded);
    expect(ed.kind).toBe('editable');
    if (ed.kind !== 'editable') return;
    expect(ed.migrated).toBe(false); // its own alignment, not one rebuilt from the polyline with radius 0
    expect(ed.state.alignment).toEqual(fixture.properties.alignment);
    const d = densifyAlignment(loaded.alignment!);
    expect(d.ok).toBe(true);
    expect(d.coordinates.map(c => [c[0], c[1]])).toEqual(loaded.coordinates.map(c => [c[0], c[1]]));
    // Saving it again sends the same row
    expect(JSON.parse(JSON.stringify(objectToRow(loaded)))).toEqual(fixture);
  });
});
