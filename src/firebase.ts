import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  type User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => {
  provider.addScope(scope);
});
provider.setCustomParameters({
  prompt: 'select_account',
});

// Flag indicating an active popup sign-in flow
let isSigningIn = false;
// Strictly in-memory OAuth access token cache (never stored in localStorage or sessionStorage)
let cachedAccessToken: string | null = null;

/**
 * Subscribes to Firebase Auth state changes and manages the in-memory Google Drive OAuth token.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure(user);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure(null);
    }
  });
};

/**
 * Launches Google Sign-In popup requesting Google Drive file permission (drive.file)
 * so the user's open PDF saves directly into their own Google Drive.
 */
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive permission was not granted during sign-in.');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async (): Promise<void> => {
  await signOut(auth);
  cachedAccessToken = null;
};
