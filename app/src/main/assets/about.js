'use strict';
/* Dados declarados pelo próprio APK instalado, não por versão fixa da interface. */
const BuildAbout = (() => {
  const unavailable = 'Indisponível fora do aplicativo Android';
  function read(bridge) {
    if (!bridge || typeof bridge.buildInfo !== 'function') return null;
    try {
      const data = JSON.parse(bridge.buildInfo());
      if (!data || typeof data.versionName !== 'string' ||
          !Number.isInteger(data.versionCode) || data.versionCode < 1) return null;
      return data;
    } catch (_) {
      return null;
    }
  }
  function render(root, bridge) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    const native = arguments.length >= 2 ? bridge :
      (typeof window !== 'undefined' ? window.NativeHinos : null);
    const info = read(native);
    const rawDate = info?.buildDateUtc;
    const parsedDate = rawDate ? new Date(rawDate) : null;
    const buildDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ?
      parsedDate.toLocaleString('pt-BR', {timeZone:'UTC',dateStyle:'short',timeStyle:'medium'}) + ' UTC' : unavailable;
    const data = {
      'about-developer': info?.developer || 'Pablo Erlis',
      'about-version': info ? info.versionName : unavailable,
      'about-code': info ? String(info.versionCode) : unavailable,
      'about-type': info?.buildType || unavailable,
      'about-commit': info?.sourceRevision ? String(info.sourceRevision).slice(0,12) : unavailable,
      'about-date': buildDate
    };
    for (const [id, value] of Object.entries(data)) {
      const el = doc?.getElementById(id);
      if (el) el.textContent = value;
    }
    return info;
  }
  return {read,render};
})();
