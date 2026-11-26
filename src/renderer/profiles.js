// Profile rules, kept in one place so the UI and the tests use exactly the same code.
// Works in the app window (window.Profiles) and in Node (require) for the tests.
//
// A game's data looks like { mods: [{id, name, ...}], profiles: { SFW: {modId: true|false} }, active: 'SFW' }.
// Rules:
//  - a profile only ever changes its OWN entries; nothing here writes to another profile by accident
//  - "on" means the entry is exactly true; a missing entry is off (never "on by default")
//  - a newly installed mod is on in the profile it was installed from and explicitly off in all the others
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Profiles = api;
})(this, function () {
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** The on/off map of one profile (created when it does not exist yet). */
  function map(d, profile) {
    if (!d.profiles) d.profiles = {};
    if (!own(d.profiles, profile) || !d.profiles[profile] || typeof d.profiles[profile] !== 'object') d.profiles[profile] = {};
    return d.profiles[profile];
  }

  const isOn = (d, profile, id) => !!d.profiles && own(d.profiles, profile) && !!d.profiles[profile] && d.profiles[profile][id] === true;

  /** Switch one mod on or off in ONE profile. */
  function setOn(d, profile, id, on) { map(d, profile)[id] = !!on; }

  /** Flip one mod in ONE profile; returns the new state. */
  function toggle(d, profile, id) { const on = !isOn(d, profile, id); setOn(d, profile, id, on); return on; }

  /** How many of the game's mods are on in a profile (entries of mods that no longer exist do not count). */
  function countOn(d, profile) { return (d.mods || []).filter(m => isOn(d, profile, m.id)).length; }

  /** Switch every mod off in one profile (explicit off, not "no entry"). */
  function clearProfile(d, profile) { const p = map(d, profile); for (const m of d.mods || []) p[m.id] = false; for (const k of Object.keys(p)) p[k] = false; }

  /** A new profile starts with every mod explicitly off. Returns false when the name is empty or taken. */
  function createProfile(d, name) {
    const n = String(name == null ? '' : name).trim();
    if (!n || (d.profiles && own(d.profiles, n))) return false;
    const p = map(d, n);
    for (const m of d.mods || []) p[m.id] = false;
    return true;
  }

  /** Newly installed mods: on in `profile`, explicitly off in every other profile. */
  function addNew(d, ids, profile) {
    map(d, profile);
    for (const id of ids) for (const name of Object.keys(d.profiles)) d.profiles[name][id] = name === profile;
  }

  /** Move a mod from one profile to another: off in `from`, on in `to`. */
  function moveMod(d, id, from, to) {
    if (from === to || !d.profiles || !own(d.profiles, from) || !own(d.profiles, to)) return false;
    if (!(d.mods || []).some(m => m.id === id)) return false;
    setOn(d, from, id, false);
    setOn(d, to, id, true);
    return true;
  }

  /**
   * Rename a profile. The mod on/off settings and the order stay as they are.
   * Returns { ok: true } or { ok: false, error } (empty name, or a name another profile already has).
   */
  function renameProfile(d, from, to) {
    const n = String(to == null ? '' : to).trim();
    if (!d.profiles || !own(d.profiles, from)) return { ok: false, error: 'That profile does not exist' };
    if (!n) return { ok: false, error: 'Type a name for the profile' };
    if (n === from) return { ok: true };
    if (Object.keys(d.profiles).some(p => p !== from && p.toLowerCase() === n.toLowerCase())) return { ok: false, error: 'A profile called "' + n + '" already exists' };
    const next = {};
    for (const k of Object.keys(d.profiles)) next[k === from ? n : k] = d.profiles[k];
    d.profiles = next;
    if (d.active === from) d.active = n;
    return { ok: true };
  }

  /** Which profile takes over when `name` goes away: "Default" if it is there, else the first one left. */
  function fallbackFor(d, name) {
    const left = Object.keys(d.profiles || {}).filter(p => p !== name);
    return left.includes('Default') ? 'Default' : (left[0] || null);
  }

  /** Why a profile cannot be deleted (null = it can): the last one, or the "Default" everything falls back to. */
  function cannotDelete(d, name) {
    if (!d.profiles || !own(d.profiles, name)) return 'That profile does not exist';
    if (Object.keys(d.profiles).length < 2) return 'You need at least one profile';
    if (name === 'Default') return '"Default" is where MODit falls back to, so it cannot be deleted';
    return null;
  }

  /**
   * Delete a profile. The mods stay installed, only this profile's on/off settings go away.
   * When it was the active one, the fallback becomes active. Returns { ok, error } or { ok, switchedTo }.
   */
  function deleteProfile(d, name) {
    const why = cannotDelete(d, name);
    if (why) return { ok: false, error: why };
    const to = fallbackFor(d, name);
    delete d.profiles[name];
    if (d.active === name) { d.active = to; return { ok: true, switchedTo: to }; }
    return { ok: true };
  }

  /**
   * An install (or a pack edit) finished. `ns` is the state the install worked on: it was copied BEFORE the
   * archive was unpacked, so its profiles are old by now. The profile choices live in `live` and stay as they are;
   * only the list of mods comes from `ns`.
   *  - `before`  ids of the mods that existed when the install started
   *  - `profile` the profile the install was started from (new mods are switched on there only)
   * A mod the user removed while the install ran stays removed, and a title the user changed in the meantime is kept.
   * `ns.installed` lists the mods the install wrote. One that was already there (a reinstall) is switched on in
   * `profile` too, so installing it again from a profile where it was off really gives you the mod there.
   */
  function applyInstall(live, ns, before, profile) {
    const was = before instanceof Set ? before : new Set(before);
    const liveMods = new Map((live.mods || []).map(m => [m.id, m]));
    const wrote = new Set(ns.installed || []);
    const mods = [];
    const fresh = [];
    const again = [];
    for (const m of ns.mods || []) {
      if (was.has(m.id)) {
        const l = liveMods.get(m.id);
        if (!l) continue;                                  // removed while installing
        if (wrote.has(m.id)) again.push(m.id);
        const keep = {};                                    // what the user set on the live mod survives a reinstall
        if (l.name !== undefined && l.name !== m.name) keep.name = l.name;
        if (l.thumb && !m.thumb) keep.thumb = l.thumb;
        mods.push(Object.keys(keep).length ? { ...m, ...keep } : m);
      } else { mods.push(m); fresh.push(m.id); }
    }
    live.mods = mods;
    addNew(live, fresh, profile);
    for (const id of again) {                              // reinstall: on here, the other profiles keep what they had
      for (const name of Object.keys(live.profiles)) if (!(id in live.profiles[name])) live.profiles[name][id] = false;
      setOn(live, profile, id, true);
    }
    return live;
  }

  return { isOn, setOn, toggle, countOn, clearProfile, createProfile, renameProfile, deleteProfile, cannotDelete, fallbackFor, addNew, moveMod, applyInstall };
});
