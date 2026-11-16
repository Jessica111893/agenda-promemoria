// Decide quali notifiche mandare. Nessun accesso a internet qui: solo calcoli (così si può provare facilmente).

export const ORA_MATTINA = 8;          // alle 8:00: riepilogo degli appuntamenti di oggi + compleanni
export const FINESTRA_MATTINA_ORE = 6; // se il controllo arriva in ritardo, la notifica del mattino parte fino alle 14:00
export const MINUTI_PRIMA = 60;        // avviso un'ora prima di un appuntamento con l'ora
export const FINESTRA_ORE = 12;        // i promemoria scaduti da più di 12 ore non si mandano

const p2 = (n) => String(n).padStart(2, "0");

// "adesso" è un numero che rappresenta l'ora da orologio italiana (vedi oraItalia in notifiche.mjs)
export function quando(dataIso, ora) {
    return Date.parse(dataIso + "T" + (ora || "09:00") + ":00Z");
}

export function chiavePromemoria(p) {
    return p.data + "|" + (p.ora || "") + "|" + p.testo;
}

export function calcolaNotifiche({ promemoria = [], appuntamenti = [], compleanni = [], adesso, giaInviati, tipi = {} }) {
    const risultato = [];
    const acceso = (nome) => !tipi || tipi[nome] !== false;   // se non scelto, la notifica è accesa
    const d = new Date(adesso);
    const oggi = d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
    const mattina = Date.parse(oggi + "T" + p2(ORA_MATTINA) + ":00:00Z");
    const nelMattino = adesso >= mattina && adesso <= mattina + FINESTRA_MATTINA_ORE * 3600 * 1000;

    // 1) Promemoria: all'ora esatta (come prima)
    promemoria.forEach((p) => {
        if (!acceso("promemoria")) return;
        if (!p || !p.data || !p.testo || p.notificato) return;
        if (!p.ora) {
            // senza orario: una notifica la sera prima alle 20:00 e una la mattina alle 8:00
            const giorno = Date.parse(p.data + "T00:00:00Z");
            const sera = giorno - 4 * 3600 * 1000;
            const alle8 = giorno + ORA_MATTINA * 3600 * 1000;
            const finestra = FINESTRA_MATTINA_ORE * 3600 * 1000;
            const chiaveSera = "pmsera|" + p.data + "|" + p.testo;
            const chiaveMat = "pmmat|" + p.data + "|" + p.testo;
            if (adesso >= sera && adesso < sera + finestra && !giaInviati.has(chiaveSera)) {
                risultato.push({ chiave: chiaveSera, titolo: "🔔 Domani", corpo: p.testo, tag: chiaveSera });
            }
            if (adesso >= alle8 && adesso <= alle8 + finestra && !giaInviati.has(chiaveMat)) {
                risultato.push({ chiave: chiaveMat, titolo: "🔔 Oggi", corpo: p.testo, tag: chiaveMat });
            }
            return;
        }
        const chiave = chiavePromemoria(p);
        if (giaInviati.has(chiave)) return;
        const differenza = adesso - quando(p.data, p.ora);
        if (differenza >= 0 && differenza <= FINESTRA_ORE * 3600 * 1000) {
            risultato.push({ chiave, titolo: "🔔 Promemoria", corpo: p.testo, tag: chiave });
        }
    });

    // 2) Appuntamenti, scadenze ed eventi: l'avviso scelto nell'app (di base un'ora prima)
    const ORA_SERA = 20;
    const euro = (n) => Number(n).toFixed(2).replace(".", ",") + " €";
    appuntamenti.forEach((a) => {
        if (!acceso("appuntamenti")) return;
        if (!a || !a.data || !a.titolo) return;
        const giorno = Date.parse(a.data + "T00:00:00Z");
        const finestraSera = FINESTRA_MATTINA_ORE * 3600 * 1000;
        // scadenze: la sera prima (o 3 giorni prima) alle 20:00
        if (a.tipo === "scadenza") {
            if (a.pagata) return;
            const av = a.avviso || "giorno";
            if (av === "no") return;
            const prima = av === "3giorni" ? 3 : 1;
            const alle = giorno - prima * 86400000 + ORA_SERA * 3600 * 1000;
            const chiave = "sca" + prima + "|" + a.data + "|" + a.titolo;
            if (adesso >= alle && adesso < alle + finestraSera && !giaInviati.has(chiave)) {
                risultato.push({ chiave, titolo: prima === 1 ? "💳 Domani scade" : "💳 Tra 3 giorni scade", corpo: a.titolo + (a.importo ? " · " + euro(a.importo) : ""), tag: chiave });
            }
            return;
        }
        if (a.tipo === "evento") return;   // gli eventi di più giorni arrivano nel riepilogo del mattino
        const av = (a.avviso === undefined || a.avviso === null || a.avviso === "") ? "60" : String(a.avviso);
        if (av === "no") return;
        if (av === "giorno") {
            const alle = giorno - 86400000 + ORA_SERA * 3600 * 1000;
            const chiave = "appg|" + a.data + "|" + (a.ora || "") + "|" + a.titolo;
            if (adesso >= alle && adesso < alle + finestraSera && !giaInviati.has(chiave)) {
                risultato.push({ chiave, titolo: "📅 Domani", corpo: (a.ora ? a.ora + " · " : "") + a.titolo, tag: chiave });
            }
            return;
        }
        if (!a.ora) return;                 // senza orario: solo nel riepilogo del mattino
        const minuti = Number(av);
        if (isNaN(minuti)) return;
        const chiave = (minuti === MINUTI_PRIMA ? "app1h|" : "app" + minuti + "|") + a.data + "|" + a.ora + "|" + a.titolo;
        if (giaInviati.has(chiave)) return;
        const mancano = (quando(a.data, a.ora) - adesso) / 60000;   // minuti all'appuntamento
        const dentro = minuti === MINUTI_PRIMA ? (mancano > 0 && mancano <= minuti) : (mancano <= minuti && mancano > -15);
        if (dentro) {
            const tra = mancano <= 0 ? "Adesso" : mancano >= 55 ? "Tra 1 ora" : "Tra " + Math.max(1, Math.round(mancano)) + " minuti";
            risultato.push({ chiave, titolo: "📅 " + tra, corpo: a.ora + " · " + a.titolo + (a.luogo ? "\n📍 " + a.luogo : ""), tag: chiave });
        }
    });

    // 3) Mattina: riepilogo degli appuntamenti di oggi (anche quelli senza ora)
    if (nelMattino) {
        const oggiApp = appuntamenti
            .filter((a) => a && a.titolo && !a.pagata && (a.tipo === "evento" && a.fine ? (a.data <= oggi && oggi <= a.fine) : a.data === oggi))
            .sort((x, y) => (x.ora || "99:99").localeCompare(y.ora || "99:99"));
        const chiaveM = "mattina|" + oggi;
        if (acceso("mattina") && oggiApp.length > 0 && !giaInviati.has(chiaveM)) {
            const righe = oggiApp.map((a) => (a.tipo === "scadenza" ? "💳 " : a.tipo === "evento" ? "🌴 " : "") + (a.ora ? a.ora + " " : "") + a.titolo);
            risultato.push({
                chiave: chiaveM,
                titolo: oggiApp.length === 1 ? "☀️ Oggi hai 1 impegno" : "☀️ Oggi hai " + oggiApp.length + " impegni",
                corpo: righe.join("\n"),
                tag: chiaveM
            });
        }

        // 4) Mattina: compleanni di oggi
        compleanni.forEach((c) => {
            if (!acceso("compleanni")) return;
            if (!c || !c.nome || Number(c.giorno) !== d.getUTCDate() || Number(c.mese) !== d.getUTCMonth() + 1) return;
            const chiave = "compl|" + oggi + "|" + c.nome;
            if (giaInviati.has(chiave)) return;
            const anni = c.anno ? d.getUTCFullYear() - Number(c.anno) : 0;
            const anniv = c.tipo === "anniversario";
            risultato.push({
                chiave,
                titolo: anniv ? "💍 Anniversario" : "🎂 Compleanno",
                corpo: anniv ? "Oggi: " + c.nome + (anni > 0 ? " · " + anni + (anni === 1 ? " anno" : " anni") + " insieme" : "") + " 💕"
                    : "Oggi è il compleanno di " + c.nome + (anni > 0 ? ", compie " + anni + " anni" : "") + "!",
                tag: chiave
            });
        });
    }
    // 5) Sera alle 21: cosa c'è domani
    const ORA_SERA_RIEP = 21;
    const sera = Date.parse(oggi + "T" + p2(ORA_SERA_RIEP) + ":00:00Z");
    if (acceso("sera") && adesso >= sera && adesso <= sera + 3 * 3600 * 1000) {
        const dd = new Date(Date.parse(oggi + "T12:00:00Z") + 86400000);
        const domani = dd.getUTCFullYear() + "-" + p2(dd.getUTCMonth() + 1) + "-" + p2(dd.getUTCDate());
        const chiaveS = "sera|" + oggi;
        if (!giaInviati.has(chiaveS)) {
            const righe = [];
            appuntamenti
                .filter((a) => a && a.titolo && !a.pagata && (a.tipo === "evento" && a.fine ? (a.data <= domani && domani <= a.fine) : a.data === domani))
                .sort((x, y) => (x.ora || "99:99").localeCompare(y.ora || "99:99"))
                .forEach((a) => righe.push((a.tipo === "scadenza" ? "💳 " : a.tipo === "evento" ? "🌴 " : "") + (a.ora ? a.ora + " " : "") + a.titolo));
            promemoria
                .filter((p) => p && p.testo && !p.notificato && p.data === domani)
                .forEach((p) => righe.push("🔔 " + (p.ora ? p.ora + " " : "") + p.testo));
            compleanni
                .filter((c) => c && c.nome && Number(c.giorno) === dd.getUTCDate() && Number(c.mese) === dd.getUTCMonth() + 1)
                .forEach((c) => righe.push((c.tipo === "anniversario" ? "💍 " : "🎂 ") + c.nome));
            if (righe.length > 0) {
                risultato.push({
                    chiave: chiaveS,
                    titolo: righe.length === 1 ? "🌙 Domani hai 1 impegno" : "🌙 Domani hai " + righe.length + " impegni",
                    corpo: righe.join("\n"),
                    tag: chiaveS
                });
            }
        }
    }
    return risultato;
}
