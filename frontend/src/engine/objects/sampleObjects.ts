/**
 * The sample objects the app adds to an empty project (TwinCityEngine
 * loadSampleData): a fictional 1 km "Pune Central Boulevard", a side lane, a
 * signalised junction and two blocks, placed at 18.5204 N 73.8567 E, about
 * 230 m south of the real Shivaji Bridge. They are not part of the city, so
 * Simulate leaves them out: before this, the Shivaji Bridge study routed real
 * traffic over the fictional boulevard and traced its queue to the fictional
 * junction. They stay on the map (and in Build) until the user deletes them.
 *
 * Matched by id and name together, so a user object that reuses one of these
 * ids (or a sample the user renamed, i.e. adopted) still counts.
 */
export const SAMPLE_OBJECTS: Readonly<Record<string, string>> = {
  b1: 'TwinTowers Block A',
  b2: 'Cyber IT Park',
  r1: 'Pune Central Boulevard',
  r2: 'Tech Corridor Lane',
  j1: 'Boulevard Intersection',
  // An illustrative Hinjewadi demand set that older builds seeded whenever the database had no
  // buildings or zones (removed from the default load on 2026-11-22). Its zone populations and
  // jobs, gateway flows and building occupants were invented, and its buildings carried named
  // real companies with made-up employee counts marked "surveyed". Databases that still hold these
  // rows must not treat them as the city: they are listed as an illustrative sample (fictional) and
  // kept out of demand, Simulate and feasibility evidence.
  zone_wakad: 'Wakad',
  zone_hinjewadi_p1: 'Hinjewadi Phase 1',
  zone_hinjewadi_p2: 'Hinjewadi Phase 2',
  zone_hinjewadi_p3: 'Hinjewadi Phase 3',
  zone_baner: 'Baner',
  zone_balewadi: 'Balewadi',
  zone_aundh: 'Aundh',
  zone_pcmc: 'PCMC External',
  g_wakad: 'Wakad NH48 Gateway',
  g_nh48_south: 'NH48 Highway Gateway (South)',
  g_baner_east: 'Baner Road East Gateway',
  g_balewadi_stadium: 'Balewadi Stadium Road Gateway',
  g_pcmc_north: 'PCMC Road Gateway (North)',
  b_it_infosys: 'Infosys Hinjawadi Campus',
  b_it_wipro: 'Wipro Phase 1 Tech Center',
  b_it_tcs: 'TCS Sahyadri Park',
  b_it_cognizant: 'Cognizant Phase 2 Campus',
  b_res_blueridge: 'Blue Ridge Apartments Block A',
  b_res_megapolis: 'Megapolis Splendour Complex',
  b_res_liferepublic: 'Life Republic Residential Tower',
  b_ret_grandmall: 'Grand High Street Mall',
  b_ret_dmart: 'Hinjawadi D-Mart',
  b_it_techm: 'Tech Mahindra Phase 3 Office',
  b_ret_xion: 'Xion Mall Hinjawadi',
  b_it_quadron: 'Quadron Business Park',
  b_edu_school: 'Blue Ridge Public School',
  b_hosp_hinj: 'Hinjawadi Lifecare Hospital',
};

/** How the app labels a sample object wherever it is listed. */
export const SAMPLE_LABEL = 'Illustrative sample (fictional)';

export function isSampleObject(o: { id: string; name?: string }): boolean {
  return SAMPLE_OBJECTS[o.id] !== undefined && SAMPLE_OBJECTS[o.id] === o.name;
}
