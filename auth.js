import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

/** Public Firebase web config (safe in client). Env overrides when present. */
const DEFAULT_FIREBASE = {
  apiKey: "AIzaSyBxhUE7OPGo_-YBZWgIzMeGWBV9U-m7yOM",
  authDomain: "m7mad-82b1a.firebaseapp.com",
  projectId: "m7mad-82b1a",
  storageBucket: "m7mad-82b1a.firebasestorage.app",
  messagingSenderId: "820765780897",
  appId: "1:820765780897:web:b5eb7b6cca6efa4d6f39e0",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE.appId,
};

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.addScope("profile");

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

function isHostedPage() {
  const host = window.location.hostname;
  return !(host === "localhost" || host === "127.0.0.1");
}

let app = null;
let auth = null;
let db = null;
let bootPromise = null;

function ensureFirebase() {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase غير مضبوط");
  }
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    try {
      auth = initializeAuth(app, {
        persistence: browserLocalPersistence,
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch (_) {
      // Already initialized in this page session
      auth = getAuth(app);
    }
    db = getFirestore(app);
  }
  return { auth, db };
}

async function readyAuth() {
  const ctx = ensureFirebase();
  return ctx.auth;
}

export function watchAuth(callback) {
  if (!isFirebaseConfigured()) {
    callback(null);
    return () => {};
  }
  const { auth } = ensureFirebase();
  return onAuthStateChanged(auth, callback);
}

/**
 * Must run once on app boot (not only inside the login modal),
 * otherwise redirect login never finishes after returning from Google.
 */
export async function completeGoogleRedirect() {
  if (!isFirebaseConfigured()) return { user: null, error: null };
  const auth = await readyAuth();
  try {
    const result = await getRedirectResult(auth);
    return { user: result?.user || null, error: null };
  } catch (err) {
    return { user: null, error: err };
  }
}

export function startAuthBoot(onError) {
  if (bootPromise) return bootPromise;
  bootPromise = completeGoogleRedirect().then((res) => {
    if (res.error && typeof onError === "function") onError(res.error);
    return res;
  });
  return bootPromise;
}

export async function loginWithGoogle() {
  const auth = await readyAuth();

  // Hosted (Vercel/phone): redirect is far more reliable than popups.
  if (isHostedPage()) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }

  try {
    const cred = await signInWithPopup(auth, googleProvider);
    return cred.user;
  } catch (err) {
    if (
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/cancelled-popup-request" ||
      err?.code === "auth/popup-closed-by-user"
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function logout() {
  if (!isFirebaseConfigured()) return;
  const auth = await readyAuth();
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
  const empty = { projects: [], currency: "$", userName: "mohammad", updatedAt: 0 };
  if (!cloudData) return localData || empty;
  if (!localData) return cloudData;

  const localTs = Number(localData.updatedAt) || 0;
  const cloudTs = Number(cloudData.updatedAt) || 0;
  if (cloudTs > localTs) return cloudData;
  if (localTs > cloudTs) return localData;

  const localCount = (localData.projects || []).length;
  const cloudCount = (cloudData.projects || []).length;
  if (cloudCount > localCount) return cloudData;
  if (localCount > cloudCount) return localData;
  return cloudTs >= localTs ? cloudData : localData;
}

export function syncErrorMessage(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  if (code.includes("permission-denied") || msg.includes("permission")) {
    return "رفض Firestore الكتابة — انشر قواعد قاعدة البيانات من Firebase.";
  }
  if (code.includes("unavailable") || msg.includes("network")) {
    return "لا اتصال — البيانات محفوظة على الجهاز مؤقتًا.";
  }
  return err?.message || "فشلت المزامنة السحابية";
}

export function authErrorMessage(err) {
  const code = String(err?.code || "");
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (code.includes("unauthorized-domain")) {
    return `النطاق غير مصرّح: أضف «${host}» في Firebase → Authentication → Settings → Authorized domains`;
  }
  if (code.includes("operation-not-allowed")) {
    return "فعّل Google من Firebase → Authentication → Sign-in method → Google → Enable";
  }
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) {
    return "أُغلق نافذة Google قبل إكمال الدخول — حاول مرة أخرى";
  }
  if (code.includes("popup-blocked")) {
    return "المتصفح منع النافذة المنبثقة — سيتم التحويل لصفحة Google";
  }
  if (code.includes("network-request-failed")) {
    return "تحقق من الاتصال بالإنترنت";
  }
  if (code.includes("account-exists-with-different-credential")) {
    return "هذا الإيميل مرتبط بطريقة دخول أخرى";
  }
  return err?.message || "حدث خطأ أثناء الدخول عبر Google";
}
