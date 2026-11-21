// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or bridged
// product of a token that already trades, at any size: the snapshot's watchlist is the floor (all 40
// of its slugs are covered) and the radar adds every other protocol that meets the same rule, above
// or below the watchlist floor. A protocol is pre-token when its record carries no market cap, no
// CoinGecko id and no symbol; it is left out when its category is Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking, Restaked BTC or CEX, its name ends in a version marker, carries a whole
// word wrapped, staked or staking, or begins with an exchange's name. That is the house's own
// still-to-come rule, applied to the whole universe instead of only above the floor: the list ranks
// nothing, and the floor is never the whole board.
//
// Implied value follows only from the snapshot's own figures:
//
//   marketMultiple = the median mcap_usd / tvl_usd of the live-token protocols in this snapshot
//   base           = tvl_usd x marketMultiple
//   growth         = clamp(change_7d, -60, 120) per cent
//   growthMult     = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity       = 0.6 + min(age_days, 1460) / 1460 x 0.4   (age_days unknown: 365)
//   implied        = max(1, round(base x growthMult x maturity))
//
// The multiple is not a constant anyone chose: it is the market's own multiple, read off the
// protocols whose tokens already trade in this same snapshot. A live token's market cap over its TVL
// is what the market pays for a dollar of locked value; a pre-token protocol's implied value is the
// same multiple applied to its TVL, moved by its seven-day growth and by how long it has run with no
// token. No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The multiple is computed, not chosen. */
export interface ModelConstants {
  market_multiple: number;
  market_multiple_n: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  market_multiple: 0.25,
  market_multiple_n: 0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1460,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    market_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  watchlistSlugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

/** Clamp `v` into [`lo`, `hi`]. */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const listed = Date.parse(`${listedAt}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listed) || !Number.isFinite(now)) return null;
  const days = Math.floor((now - listed) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** The market's own multiple: the median market-cap-per-TVL of the live-token protocols. */
export function marketMultiple(snapshot: Snapshot): { multiple: number; n: number } {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) ratios.push(p.mcap_usd / p.tvl_usd);
  }
  ratios.sort((a, b) => a - b);
  const n = ratios.length;
  if (n === 0) return { multiple: MODEL.market_multiple, n: 0 };
  const mid = Math.floor(n / 2);
  let multiple: number;
  if (n % 2 === 1) multiple = ratios[mid]!;
  else multiple = (ratios[mid - 1]! + ratios[mid]!) / 2;
  return { multiple, n };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const aged = clamp(ageForModel, 0, model.maturity_days);
  const maturityMult = model.maturity_floor + (aged / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * model.market_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** The categories the house's rule reads as a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];

/** An exchange's name at the start of the protocol's name. */
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a name ends in a release marker: a pool of another protocol. */
function hasVersionSuffix(name: string): boolean {
  const at = name.lastIndexOf(' ');
  if (at < 0) return false;
  const tail = name.slice(at + 1);
  if (tail.length === 0) return false;
  const head = tail[0]!;
  if (head === 'V' || head === 'v') return /^\d+(\.\d+)?$/.test(tail.slice(1));
  return /^\d+\.\d+$/.test(tail);
}

/** Whether a name carries a whole word wrapped, staked or staking. */
function hasWrappedWord(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9_]+/);
  for (const w of words) {
    if (w === 'wrapped' || w === 'staked' || w === 'staking') return true;
  }
  return false;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  const tokenFields = [p.mcap_usd, p.gecko_id, p.symbol];
  return tokenFields.every((v) => v === null);
}

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped,
 * staked or bridged product of a token that already trades, by the house's own rule. The rule is
 * computed from the snapshot's ten fields alone: the parent-protocol check the house also ran is
 * not one of them, so a protocol the watchlist left out for that reason alone still ranks.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  const blocked =
    (p.category !== null && WRAPPED_CATEGORIES.includes(p.category)) ||
    hasVersionSuffix(p.name) ||
    hasWrappedWord(p.name) ||
    EXCHANGE_NAMES.some((e) => p.name.startsWith(e));
  return !blocked;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** Compare two protocols by TVL, strongest first, then by slug so the order is stable. */
function byTvlThenSlug(a: SnapshotProtocol, b: SnapshotProtocol): number {
  if (a.tvl_usd !== b.tvl_usd) return b.tvl_usd - a.tvl_usd;
  if (a.slug < b.slug) return -1;
  if (a.slug > b.slug) return 1;
  return 0;
}

/** One scored protocol, ready to become a board row. */
interface ScoredEntry {
  p: SnapshotProtocol;
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
}

/** Compare two scored rows by implied value, strongest first, then by slug. */
function byImpliedThenSlug(a: ScoredEntry, b: ScoredEntry): number {
  if (a.implied !== b.implied) return b.implied - a.implied;
  if (a.p.slug < b.p.slug) return -1;
  if (a.p.slug > b.p.slug) return 1;
  return 0;
}

/** A scored entry as its board row, fields in the board's own order. */
function toBoardRow(s: ScoredEntry, i: number, model: ModelConstants): BoardRow {
  const p = s.p;
  const { slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol } = p;
  return {
    rank: i + 1,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    gecko_id,
    symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      market_multiple: model.market_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it joins the board, even one the snapshot no longer
  // carries. Coverage is a gate row, so a missing record is never gambled on.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar: every other protocol that meets the same still-to-come rule, at any size, above or
  // below the watchlist floor. A chosen protocol stays chosen.
  const rest: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) rest.push(p);
  }
  rest.sort(byTvlThenSlug);
  for (const p of rest) chosen.set(p.slug, p);

  const scored: ScoredEntry[] = [];
  for (const p of chosen.values()) {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    scored.push({ p, implied, growthPct, growthMult, maturityMult, age });
  }
  scored.sort(byImpliedThenSlug);
  const rows: BoardRow[] = [];
  for (let i = 0; i < scored.length; i++) rows.push(toBoardRow(scored[i]!, i, model));
  return rows;
}

/** Round to four decimals. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  const parts = [step.text, ' Cost: ', step.cost, '. Time: ', step.time, '.'];
  let s = parts.join('');
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  const [first] = p.chains;
  return first ?? 'its main chain';
}

/** TVL floors and the capital one farm position needs at each floor, largest first. */
const CAPITAL_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  for (const [floor, amount] of CAPITAL_TIERS) {
    if (p.tvl_usd >= floor) return amount;
  }
  return 50;
}

/** Age limits and the hold each one earns, shortest first. */
const HOLD_TIERS: Array<[number, number]> = [
  [180, 60],
  [365, 45],
];

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  for (const [limit, days] of HOLD_TIERS) {
    if (age < limit) return days;
  }
  return 30;
}

/** One category rule: when the lowercased category names any of `keys`, the farm action is `write`. */
interface ActionRule {
  keys: string[];
  write: (name: string, capital: number, chain: string) => string;
}

/** The category's actions as data, first match wins: a table, not a chain of branches. */
const ACTION_RULES: ActionRule[] = [
  { keys: ['lend', 'cdp', 'collateral'], write: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.` },
  { keys: ['curator', 'allocator'], write: (name, capital, chain) => `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.` },
  { keys: ['basis'], write: (name, capital, chain) => `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.` },
  { keys: ['rwa'], write: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.` },
  { keys: ['perpetual', 'derivative'], write: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.` },
  { keys: ['prediction'], write: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.` },
  { keys: ['staking', 'restak'], write: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.` },
  { keys: ['insurance'], write: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.` },
  { keys: ['stable'], write: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.` },
  { keys: ['options vault'], write: (name, capital, chain) => `Deposit $${capital} of USDC into ${name}'s options vault on ${chain} and keep the shares.` },
  { keys: ['index'], write: (name, capital, chain) => `Buy $${capital} of the ${name} index on ${chain} and hold it.` },
  { keys: ['aggregator'], write: (name, capital, chain) => `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares.` },
  { keys: ['dex', 'yield', 'leveraged farm', 'farm'], write: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.` },
  { keys: ['chain'], write: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} and use it in ${name}'s own apps for a week.` },
  { keys: ['payment'], write: (name, capital, chain) => `Fund $${capital} in ${name} on ${chain} and make one payment through it.` },
  { keys: ['privacy'], write: (name, capital, chain) => `Use $${capital} through ${name} on ${chain} and keep the receipt.` },
  { keys: ['otc'], write: (name, capital, chain) => `Fund $${capital} and place one order on ${name}'s OTC desk.` },
];

/** The category's one action, in the words a farmer can follow: the first table rule that matches. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of ACTION_RULES) {
    if (rule.keys.some((k) => c.includes(k))) return rule.write(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/** One farm step out of its three fields. */
function mkStep(text: string, cost: string, time: string): FarmStep {
  return { text, cost, time };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The same derivation runs in the dashboard, so the page shows the plan board.json carries.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    mkStep(`Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.`, 'under $3 of gas for the first transaction', '5 minutes'),
    mkStep(action, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    mkStep(`Do a second kind of qualifying action, such as a swap or a vote, so the wallet shows more than one behaviour.`, 'about $3 of gas', '10 minutes'),
    mkStep(`Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, 'about $2 of gas a week', '10 minutes a week'),
    mkStep(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, `the $${capital} stays in the position`, `${hold} days`),
    mkStep(`Open the protocol's own points or rewards page from its official site or docs and check what it counts; never open a claim link from a message or an ad.`, 'no fee to check, and never pay to claim', '10 minutes'),
    mkStep(`Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, 'nothing but the log', '5 minutes'),
  ];
}

/** Compare two live-token protocols by market cap, then by TVL. */
function byMcapThenTvl(a: SnapshotProtocol, b: SnapshotProtocol): number {
  const am = a.mcap_usd ?? 0;
  const bm = b.mcap_usd ?? 0;
  if (bm !== am) return bm - am;
  return b.tvl_usd - a.tvl_usd;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const live: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) && p.category !== 'CEX') live.push(p);
  }
  live.sort(byMcapThenTvl);
  const rows: LiveRow[] = [];
  const take = Math.min(LIVE_ROWS, live.length);
  for (let i = 0; i < take; i++) {
    const p = live[i]!;
    const { slug, name, category, chains, tvl_usd, mcap_usd, change_7d } = p;
    rows.push({ slug, name, category, chains, tvl_usd, mcap_usd, change_7d });
  }
  return rows;
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days, implied_value_usd } = row;
  const { growth_multiplier, maturity_multiplier } = row.model;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    age_days,
    implied_value_usd,
    growth_multiplier,
    maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { multiple, n } = marketMultiple(snapshot);
  const used: ModelConstants = { ...model, market_multiple: multiple, market_multiple_n: n };
  const board = buildBoard(snapshot, used);
  const live = liveRows(snapshot);
  const { as_of, source, floor_usd, watchlist } = snapshot;
  let early = 0;
  for (const r of board) {
    if (!watchlist.includes(r.slug)) early++;
  }
  const rows: RadarRow[] = [];
  for (const r of board) rows.push(radarRow(r));
  const radar: RadarData = {
    as_of,
    source,
    floor_usd,
    model: used,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.length,
    watchlistSlugs: [...watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** Refuse a snapshot that is not the shape the model scores. */
function refuse(why: string): never {
  throw new SnapshotError(why);
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) refuse('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') refuse('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) refuse('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) refuse('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist)) refuse('snapshot.json has no watchlist of slugs');
  for (const s of o.watchlist) {
    if (typeof s !== 'string') refuse('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const v = o.protocols[i];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) refuse(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      refuse(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const chains: string[] = [];
    if (Array.isArray(p.chains)) {
      for (const c of p.chains) {
        if (typeof c === 'string') chains.push(c);
      }
    }
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains,
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    });
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set<string>();
  for (const r of board) slugs.add(r.slug);
  for (const s of snapshot.watchlist) {
    if (!slugs.has(s)) {
      const missing = snapshot.watchlist.filter((x) => !slugs.has(x));
      return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
