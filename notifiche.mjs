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
    // Quali notifiche vuole questa persona: sono scelte nell'app e salvate nel suo spazio personale
    let tipi = {};
    let vacanzaFino = "";
    try {
        const pers = await db.doc("utenti/" + uid + "/dati/principale").get();
        if (pers.exists && typeof pers.data().notificheTipi === "string") tipi = JSON.parse(pers.data().notificheTipi) || {};
        if (pers.exists && typeof pers.data().vacanzaFino === "string") vacanzaFino = pers.data().vacanzaFino;
    } catch (e) { tipi = {}; }
    // "Solo per me": gli impegni privati dell'altra persona non arrivano
    // e nemmeno quelli della sua agenda personale ("La mia agenda"): arrivano solo i tuoi e quelli di coppia
    const diAltri = (x) => !!x && x.coppia === false && !!x.daUid && x.daUid !== uid;
    let appuntamenti = leggi("appuntamenti").filter((a) => (!a || !a.soloDi || a.soloDi === uid) && !diAltri(a));
    // Modalità vacanza: niente impegni di Lavoro e niente riepiloghi di mattina e sera
    const oggiIt = new Date(adesso).toISOString().slice(0, 10);
    if (vacanzaFino && oggiIt <= vacanzaFino) {
        appuntamenti = appuntamenti.filter((a) => !a || !/lavoro/i.test(String(a.categoria || "")));
        tipi = Object.assign({}, tipi, { mattina: false, sera: false });
        console.log("In vacanza fino al", vacanzaFino);
    }
    // biglietti della Bacheca scritti dall'altra persona nelle ultime 6 ore
    const ora = Date.now();
    const messaggi = leggi("bacheca").filter((m) => m && m.testo && m.daUid && m.daUid !== uid && ora - Number(m.quando || 0) < 6 * 3600 * 1000);
    return { promemoria: leggi("promemoria").filter((p) => !diAltri(p)), appuntamenti, compleanni: leggi("compleanni"), messaggi, tipi };
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
                console.error("Errore invio:", e.code || e.message);
                if (e.code === "messaging/registration-token-not-registered" ||
                    e.code === "messaging/invalid-registration-token") {
                    await d.ref.delete();
                }
            }
        }
        giaInviati.add(n.chiave);
    }

    await refArchivio.set({ chiavi: Array.from(giaInviati).slice(-MAX_ARCHIVIO) });
}

console.log("Fatto. Notifiche inviate:", inviate);
