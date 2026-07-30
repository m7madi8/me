import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

let app = null;
let auth = null;
let db = null;

function ensureFirebase() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase غير مضبوط. أضف مفاتيح المشروع في ملف .env");
  }
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  }
  return { auth, db };
}

export function watchAuth(callback) {
  if (!isFirebaseConfigured()) {
    callback(null);
    return () => {};
  }
  const { auth } = ensureFirebase();
  return onAuthStateChanged(auth, callback);
}

/** Finish Google redirect flow (needed on phones). */
export async function completeGoogleRedirect() {
  if (!isFirebaseConfigured()) return null;
  const { auth } = ensureFirebase();
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (_) {
    return null;
  }
}

export async function loginWithGoogle() {
  const { auth } = ensureFirebase();
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    await signInWithRedirect(auth, googleProvider);
    return null; // page will navigate away
  }
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    return cred.user;
  } catch (err) {
    // Popup blocked → redirect
    if (
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/popup-closed-by-user" ||
      err?.code === "auth/cancelled-popup-request"
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function logout() {
  if (!isFirebaseConfigured()) return;
  const { auth } = ensureFirebase();
  await signOut(auth);
}

function ledgerRef(uid) {
  const { db } = ensureFirebase();
  return doc(db, "users", uid, "data", "ledger");
}

export async function loadCloudLedger(uid) {
  const snap = await getDoc(ledgerRef(uid));
  if (!snap.exists()) return null;
  return snap.data();
}

export async function saveCloudLedger(uid, payload) {
  await setDoc(
    ledgerRef(uid),
    {
      ...payload,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  return true;
}

export function mergeLedger(localData, cloudData) {
  if (!cloudData) return localData || { projects: [], currency: "$", userName: "mohammad" };
  if (!localData) return cloudData;
  const localTs = Number(localData.updatedAt) || 0;
  const cloudTs = Number(cloudData.updatedAt) || 0;
  if (cloudTs >= localTs) return cloudData;
  return localData;
}
