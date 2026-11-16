import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];

const provider = new GoogleAuthProvider();
GMAIL_SCOPES.forEach((s) => provider.addScope(s));
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
// Strictly in-memory token cache (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export interface GoogleAccountProfile {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleGlobal {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: { access_token?: string; error?: string; error_description?: string }) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => GisTokenClient;
    };
  };
}

export const initAuth = (
  onAuthSuccess?: (user: GoogleAccountProfile, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      const profile: GoogleAccountProfile = {
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      };
      if (cachedAccessToken) {
        onAuthSuccess?.(profile, cachedAccessToken);
      } else if (!isSigningIn) {
        onAuthSuccess?.(profile, null);
      }
    } else if (!cachedAccessToken) {
      onAuthFailure?.();
    }
  });
};

// Direct Google Identity Services OAuth2 token flow (works reliably inside iframes and local hosts when authorized)
export const googleSignInDirectGis = (customClientId?: string): Promise<{ user: GoogleAccountProfile; accessToken: string }> => {
  return new Promise((resolve, reject) => {
    const g = (window as unknown as { google?: GoogleGlobal }).google;
    const oauth2 = g?.accounts?.oauth2;
    const clientId = (customClientId || '').trim() || firebaseConfig.oAuthClientId;

    if (!oauth2 || !clientId) {
      reject(
        new Error(
          'Google Identity Services is still loading or unavailable. Allow popups for this site or open the app in a new tab.'
        )
      );
      return;
    }

    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: `${GMAIL_SCOPES.join(' ')} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
      callback: async (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Google authorization did not return a token.'));
          return;
        }
        cachedAccessToken = resp.access_token;
        try {
          const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${resp.access_token}` },
          });
          const info = infoRes.ok
            ? ((await infoRes.json()) as { name?: string; email?: string; picture?: string })
            : {};
          resolve({
            user: {
              displayName: info.name || 'Google Account',
              email: info.email || null,
              photoURL: info.picture || null,
            },
            accessToken: resp.access_token,
          });
        } catch {
          resolve({
            user: { displayName: 'Google Account', email: null, photoURL: null },
            accessToken: resp.access_token,
          });
        }
      },
      error_callback: (err) => {
        reject(new Error(err.message || `Google sign-in popup error (${err.type || 'blocked'}).`));
      },
    });

    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
};

export const googleSignIn = async (): Promise<{ user: GoogleAccountProfile; accessToken: string }> => {
  isSigningIn = true;
  try {
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Could not obtain Gmail access token from Google Sign-In.');
      }
      cachedAccessToken = credential.accessToken;
      return {
        user: {
          displayName: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL,
        },
        accessToken: cachedAccessToken,
      };
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const msg = err instanceof Error ? err.message : '';
      // Fall back to Direct GIS OAuth2 when Firebase popup is blocked or host domain is not listed in Firebase Auth
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/popup-blocked' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/internal-error' ||
        code === 'auth/unauthorized-domain' ||
        msg.includes('popup-closed-by-user') ||
        msg.includes('unauthorized-domain')
      ) {
        try {
          return await googleSignInDirectGis();
        } catch (gisErr) {
          if (code === 'auth/unauthorized-domain' || msg.includes('unauthorized-domain')) {
            const host = typeof window !== 'undefined' ? window.location.hostname : 'this host';
            throw new Error(
              `Domain "${host}" is not authorized in Firebase/Google OAuth. If running locally, open http://localhost:3000 (instead of 127.0.0.1) or add "${host}" in Firebase Console -> Authentication -> Authorized domains.`
            );
          }
          throw gisErr;
        }
      }
      throw err;
    }
  } finally {
    isSigningIn = false;
  }
};

export const setManualGmailToken = async (token: string): Promise<{ user: GoogleAccountProfile; accessToken: string }> => {
  const clean = token.trim().replace(/^Bearer\s+/i, '');
  const infoRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${clean}` },
  });
  if (!infoRes.ok) {
    throw new Error('Provided Gmail OAuth access token was rejected by Gmail API.');
  }
  const prof = (await infoRes.json()) as { emailAddress?: string };
  cachedAccessToken = clean;
  return {
    user: {
      displayName: prof.emailAddress || 'Gmail User',
      email: prof.emailAddress || null,
      photoURL: null,
    },
    accessToken: clean,
  };
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const logoutGoogle = async (): Promise<void> => {
  await auth.signOut().catch(() => {});
  cachedAccessToken = null;
};
