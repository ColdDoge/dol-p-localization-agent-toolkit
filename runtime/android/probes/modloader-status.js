/*
 * Read-only ModLoader status probe: presence flags plus small, bounded
 * metadata. Never dumps large objects and never writes storage.
 *
 * The listing calls used here are read-only reads of the ModLoader storage:
 *   modUtils.getModListName()                         - names loaded this session
 *   controller.listModIndexDB() / listHiddenModIndexDB() - names persisted in IndexedDB
 */
(async () => {
  const safe = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const safeAsync = async (fn, fallback = null) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  const controller = window.modModLoadController;
  const dataManager = window.modSC2DataManager;
  return {
    passage: window.State?.passage ?? null,
    modLoaderGui: Boolean(window.modLoaderGui),
    modModLoadController: Boolean(controller),
    modSC2DataManager: Boolean(dataManager),
    modUtils: Boolean(window.modUtils),
    modUtilsVersion: safe(() => window.modUtils?.version ?? null),
    controllerKeys: safe(() => Object.keys(controller ?? {}).slice(0, 40), []),
    dataManagerKeys: safe(() => Object.keys(dataManager ?? {}).slice(0, 40), []),
    loadedModNames: safe(() => {
      const names = window.modUtils?.getModListName?.();
      return Array.isArray(names) ? names.slice(0, 60) : null;
    }),
    indexDbModNames: await safeAsync(() => controller?.listModIndexDB?.()),
    hiddenModNames: await safeAsync(() => controller?.listHiddenModIndexDB?.()),
    bodyErrors: document.querySelectorAll('.error').length,
  };
})()
