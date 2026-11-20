import admin from "firebase-admin";
import { calcolaNotifiche, inSilenzio } from "./logica.mjs";

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
    // Impegni che si ripetono: si preparano la prossima volta e quella dopo (per gli avvisi del giorno prima)
    const oggiR = new Date(adesso).toISOString().slice(0, 10);
    const isoR = (d) => d.toISOString().slice(0, 10);
    function ripete(a, iso) {
        if (iso < a.data || (a.ripetiFino && iso > a.ripetiFino)) return false;
        const d0 = new Date(a.data + "T12:00:00Z"), d = new Date(iso + "T12:00:00Z");
        if (a.ripeti === "giorno") return true;
        if (a.ripeti === "settimana") return d.getUTCDay() === d0.getUTCDay();
        if (a.ripeti === "mese") return d.getUTCDate() === d0.getUTCDate();
        if (a.ripeti === "anno") return d.getUTCDate() === d0.getUTCDate() && d.getUTCMonth() === d0.getUTCMonth();
        return false;
    }
    const espansi = [];
    appuntamenti.forEach((a) => {
        if (!a || !a.ripeti || !a.data) { espansi.push(a); return; }
        const d = new Date(oggiR + "T12:00:00Z");
        let trovati = 0;
        for (let i = 0; i < 400 && trovati < 2; i++) {
            const iso = isoR(d);
            if (ripete(a, iso)) { espansi.push(Object.assign({}, a, { data: iso })); trovati++; }
            d.setUTCDate(d.getUTCDate() + 1);
        }
    });
    appuntamenti = espansi;
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
    // pensierini lasciati dall'altra persona nelle ultime 6 ore
    const pensierini = leggi("biglietti").filter((b) => b && b.testo && b.daUid && b.daUid !== uid && ora - Number(b.quando || 0) < 6 * 3600 * 1000);
    // faccende di casa: nuove o appena fatte dall'altra persona (nelle ultime 6 ore)
    const sei = 6 * 3600 * 1000;
    const faccende = leggi("faccende");
    const faccendeNuove = faccende.filter((f) => f && f.testo && f.id && f.daUid && f.daUid !== uid && ora - Number(f.creata || 0) < sei);
    const faccendeFatte = [];
    faccende.forEach((f) => {
        if (!f || !f.testo || !f.id || !f.fatteAlle || !f.fatte) return;
        Object.keys(f.fatteAlle).forEach((k) => {
            const chi = f.fatte[k], q = Number(f.fatteAlle[k]);
            if (chi && chi !== uid && ora - q < sei) faccendeFatte.push({ id: f.id, testo: f.testo, quando: q, da: (f.fatteDa || {})[k] || "" });
        });
    });
    // lettere a tempo: arrivano a chi le riceve (chi usa l'agenda da solo riceve anche le sue)
    const lettere = leggi("lettere").filter((l) => l && (!spazio || l.daUid !== uid));
    const rinnovi = leggi("rinnovi");
    // faccende con i giorni e "🔔 Ricordamelo": avviso la mattina del loro giorno
    const faccendeRicorda = faccende.filter((f) => f && f.ricorda && Array.isArray(f.giorni) && f.giorni.length);
    return { promemoria: leggi("promemoria").filter((p) => !diAltri(p)), appuntamenti, compleanni: leggi("compleanni"), messaggi, pensierini, faccendeNuove, faccendeFatte, faccende: faccendeRicorda, rinnovi, lettere, tipi };
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
    // ore di silenzio: non si manda niente, le notifiche ancora valide partono dopo
    if (inSilenzio(dati.tipi, adesso)) { console.log("Ore di silenzio per", uid); continue; }
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
                    webpush: { headers: { Urgency: "high", TTL: "3600" } },
                    android: { priority: "high", ttl: 3600 * 1000 }
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
