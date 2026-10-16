// Recognize a pasted OAuth redirect so a phone user can finish a remote /login
// by copying the address of the (unreachable) loopback page they land on.
export interface AuthCallback { readonly code: string; readonly state: string | null; readonly url: boolean }

export function authUrlState(url: string): string | null {
  try { return new URL(url).searchParams.get('state'); } catch { return null; }
}

export function parseAuthCallback(raw: string): AuthCallback | null {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value), code = url.searchParams.get('code');
      return code ? { code, state: url.searchParams.get('state'), url: true } : null;
    } catch { return null; }
  }
  if (/(^|[?&#])code=/.test(value)) {
    const params = new URLSearchParams(value.replace(/^[?#]/, '')), code = params.get('code');
    return code ? { code, state: params.get('state'), url: false } : null;
  }
  const hash = value.indexOf('#');
  return hash > 0 ? { code: value.slice(0, hash), state: value.slice(hash + 1) || null, url: false } : null;
}

// True when the pasted callback provably belongs to this login: its state matches
// the sign-in URL's state, or (stateless sign-in URL) it is a redirect URL with code=.
export function authCallbackMatches(callback: AuthCallback | null, expectedState: string | null) {
  if (!callback) return false;
  return expectedState ? callback.state === expectedState : callback.url;
}
