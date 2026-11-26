// Install queue: when several archives arrive together (three downloads finishing at once, a multi-file pick, a drop),
// their questions are asked ONE archive at a time and every dialog title carries the position, e.g. "(2/3)".
// Cancelling a dialog (or an archive that cannot be read) skips only that archive; the rest carry on.
// Works in the app window (window.InstallQueue) and in Node (require) for the tests.
(function (root, make) {
  const api = make();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InstallQueue = api;
})(this, function () {
  /** @param onError called with (label, error) when an archive's questions throw; the queue goes on with the next one */
  function create(onError) {
    let tail = Promise.resolve(), total = 0, done = 0;
    return {
      /** Adds one archive. run(info) asks its questions; info.tag() is "" for a single archive, else " (1/3)". Resolves with run's result. */
      add(label, run) {
        total++;
        const p = tail.then(async () => {
          const index = done + 1;
          const info = { label, index, total: () => total, tag: () => (total > 1 ? ' (' + index + '/' + total + ')' : '') };
          try { return await run(info); }
          catch (e) { try { if (onError) onError(label, e); } catch (_) { /* ignore */ } return undefined; }
          finally { done++; if (done >= total) { done = 0; total = 0; } }
        });
        tail = p.then(() => undefined, () => undefined);
        return p;
      },
      /** How many archives are waiting or being asked about right now. */
      pending: () => total - done,
    };
  }
  return { create };
});
