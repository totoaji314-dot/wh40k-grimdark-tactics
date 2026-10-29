/**
 * Local-only reference models. When the game runs from the developer's own dev server and the private
 * folder exists, factions listed there load from it (e.g. the user's Space Marine 1 conversions);
 * otherwise (GitHub Pages, other machines) the game's own models are used. `?sm1=0` turns it off.
 */
export async function localFactionOverrides(): Promise<Record<string, string>> {
  const q = new URLSearchParams(location.search);
  if (q.get('sm1') === '0') return {};
  const base = '/local-assets/units/';
  try {
    const r = await fetch(base + 'marines.json', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return {};
    await r.json();
    return { marines: base };
  } catch {
    return {};
  }
}
