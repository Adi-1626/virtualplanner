import { describe, it, expect } from 'vitest';
import { flyoverFieldUpdates, roadFieldUpdates, classSpeedUpdates } from '../editing/roadEdits';
import { applyUrbanSpeeds } from '../simulation/roadParameters';
import { alignmentDesignSpeed } from '../geometry/alignment/defaults';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';

/**
 * A change of class after drawing (p11 user test, Katraj Chowk flyover): the flyover was drawn with the Road class
 * at local (design speed 30 km/h, class default), made arterial in its properties and given 50 km/h, and still ran
 * at 30 km/h in Simulate, because the alignment's class-default design speed capped it.
 */
const align = (kmh: number, source: 'class-default' | 'user' = 'class-default') => ({ v: 1, behaviour: 'curved', designSpeedKmh: kmh, designSpeedSource: source, eMax: 0.07, criteria: 'irc86-urban', pis: [] });
const flyover = (extra: Record<string, unknown> = {}) => ({ id: 'f1', type: 'flyover', name: 'Katraj Chowk flyover', roadClass: 'local', laneCount: 2, laneWidth: 3.5, isOneWay: true,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 30, elevation: 6, alignment: align(30),
  coordinates: [[73.8587, 18.4547, 0], [73.8591, 18.4461, 0]], ...extra }) as any;
const simSpeed = (o: any) => applyUrbanSpeeds([o as DrivableObject]).roads[0].speedLimit;

describe('class change carries the class speeds along', () => {
  it('local → arterial flyover: speed limit and class-default design speed become 60 km/h; Simulate drives 60', () => {
    const f = flyover();
    expect(simSpeed(f)).toBe(30);
    const u = flyoverFieldUpdates(f, 'roadClass', 'arterial') as any;
    expect(u.roadClass).toBe('arterial');
    expect(u.speedLimit).toBe(60);
    expect(u.alignment).toMatchObject({ designSpeedKmh: 60, designSpeedSource: 'class-default' });
    expect(simSpeed({ ...f, ...u })).toBe(60);
  });

  it('a speed limit or design speed the user set is kept', () => {
    const f = flyover({ speedLimit: 50, alignment: align(40, 'user') });
    const m = { ...f, ...flyoverFieldUpdates(f, 'roadClass', 'arterial') } as any;
    expect(m.roadClass).toBe('arterial');
    expect(m.speedLimit).toBe(50);
    expect(m.alignment.designSpeedKmh).toBe(40);
    expect(simSpeed(m)).toBe(40);
  });

  it('a flyover saved before the fix (arterial, 50 km/h, design speed still the local class default 30) runs at 50 km/h', () => {
    const f = flyover({ roadClass: 'arterial', speedLimit: 50 });
    expect(alignmentDesignSpeed(f)).toBe(60);
    expect(simSpeed(f)).toBe(50);
    // A design speed the user set still caps the speed
    expect(simSpeed(flyover({ roadClass: 'arterial', speedLimit: 50, alignment: align(30, 'user') }))).toBe(30);
  });

  it('a drawn road follows its class too; an OSM road and an unchanged class are left alone', () => {
    const r = { ...flyover(), type: 'road', alignment: align(30) };
    const u = roadFieldUpdates(r, 'roadClass', 'collector', () => []) as any;
    expect(u).toMatchObject({ roadClass: 'collector', speedLimit: 40, alignment: { designSpeedKmh: 40 } });
    expect(classSpeedUpdates({ ...r, osmProvenance: { osmId: 1 } }, 'arterial')).toEqual({});
    expect(classSpeedUpdates(r, 'local')).toEqual({});
  });
});
