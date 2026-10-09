/** Exact match for /fleet so Autoturisme is not active on /fleet/itp. */
export function navPathActive(pathname, path) {
  const loc = String(pathname || '');
  if (path === '/') return loc === '/';
  if (path === '/fleet') return loc === '/fleet' || loc === '/fleet/';
  return loc === path || loc.startsWith(`${path}/`);
}

export function navGroupActive(pathname, item) {
  if (item?.children?.length) {
    return item.children.some((c) => navPathActive(pathname, c.path));
  }
  return navPathActive(pathname, item?.path);
}
