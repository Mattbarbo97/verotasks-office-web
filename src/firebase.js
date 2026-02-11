// src/firebase.js
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

function env(k) {
  return (import.meta?.env?.[k] ?? "").toString().trim();
}

const firebaseConfig = {
  apiKey: env("VITE_FIREBASE_API_KEY"),
  authDomain: env("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: env("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: env("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: env("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: env("VITE_FIREBASE_APP_ID"),
};

const REQUIRED = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const missing = REQUIRED.filter((k) => !firebaseConfig[k]);

let app = null;
let auth = null;
let db = null;

if (missing.length) {
  // Não quebra o app inteiro. Só loga e deixa auth/db nulos.
  // Assim você consegue renderizar uma tela de "Config faltando".
  // eslint-disable-next-line no-console
  console.error("[Firebase] Config incompleta:", missing);
} else {
  try {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[Firebase] Falha ao inicializar:", e?.message || e);
    app = null;
    auth = null;
    db = null;
  }
}

export { app, auth, db, firebaseConfig, missing };
