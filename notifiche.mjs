import admin from "firebase-admin";
import { calcolaNotifiche } from "./logica.mjs";

const chiave = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(chiave) });
const db = admin.firestore();
const messaggi = admin.messaging();

const MAX_ARCHIVIO = 500;  // quante notifiche già inviate ricordare

// Ora attuale in Italia, come numero (data e ora "da orologio")
function oraItalia() {
    const p = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Rome",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false
    }).format(new Date());
    return Date.parse(p.replace(" ", "T") + "Z");
}

// Legge dal database promemoria, appuntamenti e compleanni dell'utente (o dello spazio condiviso)
async function leggiDati(uid) {
    const imp = await db.doc("utenti/" + uid + "/dati/impostazioni").get();
    const spazio = imp.exists ? imp.data().spazio : null;
    const percorso = spazio
        ? "spazi/" + spazio + "/dati/principale"
        : "utenti/" + uid + "/dati/principale";
    const dati = await db.doc(percorso).get();
    const leggi = (nome) => {
        if (!dati.exists) return [];
        try { const v = JSON.parse(dati.data()[nome] || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    };
    return { promemoria: leggi("promemoria"), appuntamenti: leggi("appuntamenti"), compleanni: leggi("compleanni") };
}

const adesso = oraItalia();
console.log("Ora in Italia:", new Date(adesso).toISOString().replace("T", " ").slice(0, 16));

const dispositivi = await db.collectionGroup("dispositivi").get();
const perUtente = {};
dispositivi.forEach((d) => {
    const uid = d.ref.parent.parent.id;
    (perUtente[uid] = perUtente[uid] || []).push(d);
});

let inviate = 0;

for (const uid of Object.keys(perUtente)) {
    const dati = await leggiDati(uid);
    const refArchivio = db.doc("utenti/" + uid + "/server/inviati");
    const arch = await refArchivio.get();
    const giaInviati = new Set(arch.exists ? arch.data().chiavi || [] : []);

    const daInviare = calcolaNotifiche({ ...dati, adesso, giaInviati });
    if (daInviare.length === 0) continue;

    for (const n of daInviare) {
        for (const d of perUtente[uid]) {
            try {
                await messaggi.send({
                    token: d.id,
                    data: { titolo: n.titolo, corpo: n.corpo, tag: n.tag },
                    webpush: { headers: { Urgency: "high", TTL: "3600" } }
                });
                inviate++;
                console.log("Inviato:", n.titolo, "-", n.corpo.replace(/\n/g, " / "));
            } catch (e) {
