/** Keep saved /data paths valid beneath a GitHub project site's URL prefix. */
export function assetUrl(path, base, siteBase = import.meta.env?.BASE_URL || '/') {
  const url = new URL(path, base);
  if (url.origin === new URL(base).origin && url.pathname.startsWith('/data/')) {
    url.pathname = new URL(siteBase, base).pathname.replace(/\/?$/, '/') + url.pathname.slice(1);
  }
  return url;
}
