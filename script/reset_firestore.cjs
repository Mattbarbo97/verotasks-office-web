// scripts/reset_firestore.js
// Uso:
//   $saPath = Join-Path (Resolve-Path $PWD\..\..\).Path "serviceAccount.json"
//   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content $saPath -Raw
//   node .\reset_firestore.cjs --dry

//   node .\reset_firestore.cjs --yes

//
// Requer env: FIREBASE_SERVICE_ACCOUNT (JSON string do service account)

require("dotenv").config();
const admin = require("firebase-admin");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const YES = args.includes("--yes");

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT env (JSON string).");
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

const db = admin.firestore();

const COLLECTIONS = ["tasks", "awaiting_details", "awaiting_master_comment", "_health"];

async function deleteCollection(name, batchSize = 400) {
  const col = db.collection(name);
  let total = 0;

  while (true) {
    const snap = await col.limit(batchSize).get();
    if (snap.empty) break;

    if (DRY) {
      total += snap.size;
      console.log(`[DRY] ${name}: would delete ${snap.size} docs...`);
    } else {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
      console.log(`[OK] ${name}: deleted ${snap.size} docs...`);
    }
  }

  return total;
}

(async () => {
  console.log("====================================================");
  console.log("🔥 VeroTasks Firestore RESET");
  console.log("Mode:", DRY ? "DRY-RUN" : "DELETE");
  console.log("Collections:", COLLECTIONS.join(", "));
  console.log("====================================================");

  if (!DRY && !YES) {
    console.log("🚫 Segurança: rode com --yes para apagar de verdade.");
    console.log("Ex.: node scripts/reset_firestore.js --yes");
    process.exit(0);
  }

  let grandTotal = 0;

  for (const name of COLLECTIONS) {
    const n = await deleteCollection(name);
    console.log(`→ ${name}: ${DRY ? "would delete" : "deleted"} ${n} docs`);
    grandTotal += n;
  }

  console.log("====================================================");
  console.log(`✅ Done. Total ${DRY ? "to delete" : "deleted"}: ${grandTotal}`);
  console.log("====================================================");
  process.exit(0);
})().catch((e) => {
  console.error("RESET FAILED:", e);
  process.exit(1);
});
