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

export function calcolaNotifiche({ promemoria = [], appuntamenti = [], compleanni = [], adesso, giaInviati }) {
    const risultato = [];
    const d = new Date(adesso);
    const oggi = d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
    const mattina = Date.parse(oggi + "T" + p2(ORA_MATTINA) + ":00:00Z");
    const nelMattino = adesso >= mattina && adesso <= mattina + FINESTRA_MATTINA_ORE * 3600 * 1000;

    // 1) Promemoria: all'ora esatta (come prima)
    promemoria.forEach((p) => {
        if (!p || !p.data || !p.testo || p.notificato) return;
        const chiave = chiavePromemoria(p);
        if (giaInviati.has(chiave)) return;
        const differenza = adesso - quando(p.data, p.ora);
        if (differenza >= 0 && differenza <= FINESTRA_ORE * 3600 * 1000) {
            risultato.push({ chiave, titolo: "🔔 Promemoria", corpo: p.testo, tag: chiave });
        }
    });

    // 2) Appuntamenti con l'ora: un'ora prima
    appuntamenti.forEach((a) => {
        if (!a || !a.data || !a.titolo || !a.ora) return;
        const chiave = "app1h|" + a.data + "|" + a.ora + "|" + a.titolo;
        if (giaInviati.has(chiave)) return;
        const mancano = (quando(a.data, a.ora) - adesso) / 60000;   // minuti all'appuntamento
        if (mancano > 0 && mancano <= MINUTI_PRIMA) {
            const tra = mancano >= 55 ? "Tra 1 ora" : "Tra " + Math.max(1, Math.round(mancano)) + " minuti";
            risultato.push({ chiave, titolo: "📅 " + tra, corpo: a.ora + " · " + a.titolo, tag: chiave });
        }
    });

    // 3) Mattina: riepilogo degli appuntamenti di oggi (anche quelli senza ora)
    if (nelMattino) {
        const oggiApp = appuntamenti
            .filter((a) => a && a.data === oggi && a.titolo)
            .sort((x, y) => (x.ora || "99:99").localeCompare(y.ora || "99:99"));
        const chiaveM = "mattina|" + oggi;
        if (oggiApp.length > 0 && !giaInviati.has(chiaveM)) {
            const righe = oggiApp.map((a) => (a.ora ? a.ora + " " : "") + a.titolo);
            risultato.push({
                chiave: chiaveM,
                titolo: oggiApp.length === 1 ? "☀️ Oggi hai 1 impegno" : "☀️ Oggi hai " + oggiApp.length + " impegni",
                corpo: righe.join("\n"),
                tag: chiaveM
            });
        }

        // 4) Mattina: compleanni di oggi
        compleanni.forEach((c) => {
            if (!c || !c.nome || Number(c.giorno) !== d.getUTCDate() || Number(c.mese) !== d.getUTCMonth() + 1) return;
            const chiave = "compl|" + oggi + "|" + c.nome;
            if (giaInviati.has(chiave)) return;
            const anni = c.anno ? d.getUTCFullYear() - Number(c.anno) : 0;
            risultato.push({
                chiave,
                titolo: "🎂 Compleanno",
                corpo: "Oggi è il compleanno di " + c.nome + (anni > 0 ? ", compie " + anni + " anni" : "") + "!",
                tag: chiave
            });
        });
    }
    return risultato;
}
