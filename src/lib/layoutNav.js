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

/**
 * Documents shell (Avize / Rapoarte / Zone / Flotă) plus any TMS items whose
 * feature_flags.modules key is on — so GOD toggles actually change the sidebar.
 */
export function mergeDocumentsNav(companionNav, fullNav, isModuleOn) {
  const covered = new Set();
  for (const item of companionNav || []) {
    if (item?.path) covered.add(item.path);
    for (const child of item?.children || []) {
      if (child?.path) covered.add(child.path);
    }
  }
  // Companion Flotă uses /fleet + /drivers; full TMS also has /vehicles.
  covered.add('/vehicles');

  const extras = (fullNav || []).filter((item) => {
    if (!item?.path || item.path === '/') return false;
    if (covered.has(item.path)) return false;
    if (item.module && typeof isModuleOn === 'function' && !isModuleOn(item.module)) {
      return false;
    }
    return true;
  });

  return [...(companionNav || []), ...extras];
}
