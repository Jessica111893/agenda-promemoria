import admin from "firebase-admin";

const chiave = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(chiave) });
const db = admin.firestore();
const messaggi = admin.messaging();

const FINESTRA_ORE = 12;   // non manda promemoria scaduti da più di 12 ore
const MAX_ARCHIVIO = 300;  // quanti promemoria già inviati ricordare

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

function quando(p) {
    return Date.parse(p.data + "T" + (p.ora || "09:00") + ":00Z");
}

function chiaveDi(p) {
    return p.data + "|" + (p.ora || "") + "|" + p.testo;
}

async function leggiPromemoria(uid) {
    const imp = await db.doc("utenti/" + uid + "/dati/impostazioni").get();
    const spazio = imp.exists ? imp.data().spazio : null;
    const percorso = spazio
        ? "spazi/" + spazio + "/dati/principale"
        : "utenti/" + uid + "/dati/principale";
    const dati = await db.doc(percorso).get();
    if (!dati.exists) return [];
    try { return JSON.parse(dati.data().promemoria || "[]"); } catch (e) { return []; }
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
    const promemoria = await leggiPromemoria(uid);
    const refArchivio = db.doc("utenti/" + uid + "/server/inviati");
    const arch = await refArchivio.get();
    const giaInviati = new Set(arch.exists ? arch.data().chiavi || [] : []);

    const daInviare = promemoria.filter((p) => {
        if (!p || !p.data || !p.testo || p.notificato) return false;
        if (giaInviati.has(chiaveDi(p))) return false;
        const differenza = adesso - quando(p);
        return differenza >= 0 && differenza <= FINESTRA_ORE * 3600 * 1000;
    });

    if (daInviare.length === 0) continue;

    for (const p of daInviare) {
        for (const d of perUtente[uid]) {
            try {
                await messaggi.send({
                    token: d.id,
                    data: { titolo: "🔔 Promemoria", corpo: p.testo, tag: chiaveDi(p) },
                    webpush: { headers: { Urgency: "high", TTL: "3600" } }
                });
                inviate++;
                console.log("Inviato:", p.testo);
            } catch (e) {
                console.error("Errore invio:", e.code || e.message);
                if (e.code === "messaging/registration-token-not-registered" ||
                    e.code === "messaging/invalid-registration-token") {
                    await d.ref.delete();
                }
            }
        }
        giaInviati.add(chiaveDi(p));
    }

    await refArchivio.set({ chiavi: Array.from(giaInviati).slice(-MAX_ARCHIVIO) });
}

console.log("Fatto. Notifiche inviate:", inviate);
