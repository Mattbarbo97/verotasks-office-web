// src/firebase.js
/* eslint-disable no-console */
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";

function env(k) {
  return (import.meta.env?.[k] ?? "").toString().trim();
}

const firebaseConfig = {
  apiKey: env("VITE_FIREBASE_API_KEY"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: env("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: env("VITE_FIREBASE_APP_ID"),
};

const REQUIRED = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const missing = REQUIRED.filter((k) => !firebaseConfig[k]);

let app = null;
let auth = null;
let db = null;
let firebaseError = null;

function hintEnvFile() {
  return (
    "Dica: no Vite o arquivo deve se chamar .env.local (com ponto) e conter variáveis VITE_*.\n" +
    "Ex: VITE_FIREBASE_API_KEY=...\n" +
    "Após ajustar, pare e rode o dev server de novo (npm run dev)."
  );
}

function hintFirestoreInit() {
  return (
    "Dica extra: se você inicializa Firestore em mais de um lugar, o initializeFirestore() pode conflitar.\n" +
    "Procure por getFirestore()/initializeFirestore() em outros arquivos e mantenha apenas este aqui.\n"
  );
}

if (missing.length) {
  firebaseError = new Error(
    `[Firebase] Config incompleta. Faltando: ${missing.join(", ")}\n${hintEnvFile()}`
  );
  console.error(firebaseError.message);
} else {
  try {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);

    /**
     * ✅ Estratégia segura:
     * - Primeiro tenta pegar Firestore já inicializado (evita conflito)
     * - Se não existir, inicializa com long polling + cache estável
     */
    try {
      db = getFirestore(app);
    } catch {
      db = null;
    }

    if (!db) {
      db = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentSingleTabManager(),
        }),
      });
    }
  } catch (e) {
    firebaseError = new Error(
      `[Firebase] Falha ao inicializar: ${e?.message || e}\n${hintEnvFile()}\n${hintFirestoreInit()}`
    );
    console.error(firebaseError.message);
    app = null;
    auth = null;
    db = null;
  }
}

const isFirebaseReady = !!app && !!auth && !!db && missing.length === 0;

function requireFirebase() {
  if (!isFirebaseReady) {
    throw firebaseError || new Error("[Firebase] Não inicializado.");
  }
  return { app, auth, db };
}

export {
  app,
  auth,
  db,
  firebaseConfig,
  missing,
  isFirebaseReady,
  firebaseError,
  requireFirebase,
};
