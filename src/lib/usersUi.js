/**
 * Presenting the people list.
 *
 * The screen has to make three states obvious that the columns do not: an invitation still
 * waiting, an invitation that has gone stale, and a driver account that will sign in to an empty
 * app. All three are silent failures otherwise — somebody finds out weeks later, usually the
 * person affected.
 */

export const STATES = {
  active: {
    label: 'Activ',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hint: 'S-a autentificat cel puțin o dată.',
  },
  invited: {
    label: 'Invitat',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    hint: 'Are o invitație validă, dar nu și-a ales încă parola.',
  },
  expired: {
    label: 'Invitație expirată',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    hint: 'Nu s-a autentificat niciodată și linkul nu mai e valabil. Retrimite invitația.',
  },
};

export function stateMeta(state) {
  return STATES[state] || STATES.expired;
}

export const ROLE_ORDER = ['admin', 'dispatcher', 'finance', 'driver'];

/**
 * Sorts the way an admin reads the list: deactivated accounts last, then by role, then by name.
 *
 * Alphabetical alone buries the person you are looking for among people who left the company.
 */
export function sortUsers(users) {
  return [...(users || [])].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const roleDiff = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (roleDiff !== 0) return roleDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ro');
  });
}

/** Free-text filter over the fields somebody would actually type. */
export function filterUsers(users, term) {
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return users || [];
  return (users || []).filter((u) => [u.name, u.email, u.role, u.driver_name]
    .some((field) => String(field || '').toLowerCase().includes(needle)));
}

/**
 * The things worth saying out loud about one account, in the order they matter.
 *
 * Returned as data rather than rendered here so the same reasoning can be tested without a DOM.
 */
export function warningsFor(user, { adminCount } = {}) {
  const warnings = [];
  if (!user) return warnings;

  if (user.role === 'driver' && !user.driver_ready) {
    warnings.push({
      code: 'driver_unlinked',
      text: 'Fără profil de șofer: se poate autentifica, dar aplicația de șofer va fi goală.',
    });
  }
  if (user.is_active && user.state === 'expired') {
    warnings.push({
      code: 'invite_expired',
      text: 'Nu s-a autentificat niciodată, iar invitația a expirat.',
    });
  }
  if (user.is_active && user.role === 'admin' && adminCount === 1) {
    warnings.push({
      code: 'last_admin',
      text: 'Este singurul administrator activ. Nu poate fi retrogradat sau dezactivat.',
    });
  }
  return warnings;
}

/**
 * Which actions to offer for one account.
 *
 * Computed here rather than guessed in the markup, so the button an admin sees matches what the
 * server will accept. A button that always fails is worse than no button.
 */
export function actionsFor(user, { currentUserId, adminCount } = {}) {
  if (!user) return { canChangeRole: false, canDeactivate: false, canActivate: false, canResend: false, canLinkDriver: false };
  const isSelf = user.id === currentUserId;
  const isLastAdmin = user.role === 'admin' && user.is_active && adminCount <= 1;

  return {
    canChangeRole: !isSelf && !isLastAdmin,
    canDeactivate: user.is_active && !isSelf && !isLastAdmin,
    canActivate: !user.is_active,
    canResend: user.is_active && user.state !== 'active',
    canLinkDriver: user.role === 'driver',
  };
}

/** Last sign-in as a short local date, or a plain statement that there has not been one. */
export function lastSeen(user) {
  if (!user?.last_login) return 'Niciodată';
  const date = new Date(user.last_login);
  if (Number.isNaN(date.getTime())) return 'Niciodată';
  return date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * What to tell an admin after deactivating somebody.
 *
 * Sessions are revoked immediately, which stops renewal — but an access token already in a
 * browser keeps working until it expires. Saying so is the difference between an admin who knows
 * the cut takes effect within the hour and one who believes it was instant.
 */
export function deactivationNotice({ sessions_revoked: revoked, access_token_ttl: ttl } = {}) {
  const parts = [];
  parts.push(revoked > 0
    ? `${revoked} ${revoked === 1 ? 'sesiune încheiată' : 'sesiuni încheiate'}.`
    : 'Nu avea sesiuni active.');
  if (ttl) parts.push(`Un token deja emis mai poate fi folosit cel mult ${ttl}.`);
  return parts.join(' ');
}
