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

export function calcolaNotifiche({ promemoria = [], appuntamenti = [], compleanni = [], messaggi = [], pensierini = [], faccendeNuove = [], faccendeFatte = [], faccende = [], faccendeTutte = [], spese = [], budget = 0, rinnovi = [], lettere = [], adesso, giaInviati, tipi = {} }) {
    const risultato = [];
    const acceso = (nome) => !tipi || tipi[nome] !== false;   // se non scelto, la notifica è accesa
    const d = new Date(adesso);
    const oggi = d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
    const mattina = Date.parse(oggi + "T" + p2(ORA_MATTINA) + ":00:00Z");
    const nelMattino = adesso >= mattina && adesso <= mattina + FINESTRA_MATTINA_ORE * 3600 * 1000;

    // 1) Promemoria: all'ora esatta (come prima)
    promemoria.forEach((p) => {
        if (!acceso("promemoria")) return;
        if (!p || !p.data || !p.testo || p.notificato || p.fatto) return;
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
    // 6) Chat e "Pensavo a te" dall'altra persona
    messaggi.forEach((m) => {
        if (!acceso("messaggi") || !m || !m.testo || !m.id) return;
        const chiave = "msg|" + m.id;
        if (giaInviati.has(chiave)) return;
        if (m.tipo === "pensiero") {
            risultato.push({ chiave, titolo: "💭 " + (m.da ? m.da + " ti sta pensando" : "Qualcuno ti sta pensando"), corpo: "Un pensiero per te 💕", tag: chiave });
        } else {
            risultato.push({ chiave, titolo: "💬 " + (m.da ? m.da : "Nuovo messaggio"), corpo: m.testo, tag: chiave });
        }
    });
    // 6b) Pensierini: uno nuovo lasciato dall'altra persona
    pensierini.forEach((b) => {
        if (!acceso("pensierini") || !b || !b.testo || !b.id) return;
        const chiave = "pens|" + b.id;
        if (giaInviati.has(chiave)) return;
        risultato.push({ chiave, titolo: "📝 " + (b.da ? "Un pensierino da " + b.da : "Un nuovo pensierino"), corpo: b.testo, tag: chiave });
    });
    // 6c) Faccende di casa: una nuova aggiunta dall'altra persona, o una segnata come fatta
    faccendeNuove.forEach((f) => {
        if (!acceso("faccende") || !f || !f.testo || !f.id) return;
        const chiave = "facn|" + f.id;
        if (giaInviati.has(chiave)) return;
        risultato.push({ chiave, titolo: "🧹 " + (f.da ? f.da + " ha aggiunto una faccenda" : "Una nuova faccenda"), corpo: f.testo, tag: chiave });
    });
    faccendeFatte.forEach((f) => {
        if (!acceso("faccende") || !f || !f.testo || !f.id) return;
        const chiave = "facf|" + f.id + "|" + f.quando;
        if (giaInviati.has(chiave)) return;
        risultato.push({ chiave, titolo: "✅ " + (f.da ? f.da + " ha fatto una faccenda" : "Una faccenda è fatta"), corpo: f.testo, tag: chiave });
    });
    // 6d) Faccende con i giorni e "🔔 Ricordamelo": la mattina del loro giorno, se nessuno l'ha ancora segnata fatta
    if (nelMattino && acceso("faccende")) {
        const gOggi = d.getUTCDay() || 7;   // 1 = lunedì … 7 = domenica, come nell'app
        const sett = settimanaIso(d);
        faccende.forEach((f) => {
            if (!f || !f.id || !f.testo || !f.ricorda || !Array.isArray(f.giorni) || f.giorni.indexOf(gOggi) < 0) return;
            const fatte = f.fatte || {};
            if (fatte[sett + "-" + gOggi] || (fatte[sett] && f.giorni.length === 1)) return;   // già fatta oggi
            const chiave = "facr|" + oggi + "|" + f.id;
            if (giaInviati.has(chiave)) return;
            risultato.push({ chiave, titolo: "🔔 Oggi: " + f.testo, corpo: "Da fare oggi · segnala fatta nell'agenda", tag: chiave });
        });
    }
    // 7) Da rinnovare: un mese prima, una settimana prima e il giorno stesso (la mattina)
    if (nelMattino && acceso("rinnovi")) {
        rinnovi.forEach((r) => {
            if (!r || !r.nome || !r.data) return;
            const mancano = Math.round((Date.parse(r.data + "T00:00:00Z") - Date.parse(oggi + "T00:00:00Z")) / 86400000);
            if ([30, 7, 0].indexOf(mancano) < 0) return;
            const chiave = "rinn" + mancano + "|" + r.data + "|" + r.nome;
            if (giaInviati.has(chiave)) return;
            const titolo = mancano === 0 ? "📋 Scade oggi" : mancano === 7 ? "📋 Scade tra una settimana" : "📋 Scade tra un mese";
            risultato.push({ chiave, titolo, corpo: r.nome + (mancano === 0 ? "" : " · " + Number(r.data.slice(8, 10)) + "/" + Number(r.data.slice(5, 7))), tag: chiave });
        });
    }
    // 8) Lettere a tempo: la mattina del giorno in cui si possono aprire
    if (nelMattino && acceso("lettere")) {
        lettere.forEach((l) => {
            if (!l || !l.id || l.apri !== oggi) return;
            const chiave = "lett|" + l.id;
            if (giaInviati.has(chiave)) return;
            risultato.push({ chiave, titolo: "💌 Oggi si apre una lettera", corpo: l.da ? "Te l'ha scritta " + l.da + ": aprila nell'agenda" : "Aprila nell'agenda", tag: chiave });
        });
    }
    // 9) Domenica sera: "La vostra settimana" (faccende fatte, spese della settimana, impegni della prossima)
    if (acceso("settimana") && d.getUTCDay() === 0 && d.getUTCHours() >= 20 && d.getUTCHours() < 23) {
        const sett = settimanaIso(d);
        const chiave = "sett|" + sett;
        if (!giaInviati.has(chiave)) {
            const righe = [];
            // faccende: quante ne ha fatte ognuno questa settimana (🌟 a chi ne ha fatte di più)
            const conta = {};
            faccendeTutte.forEach((f) => {
                if (!f || !f.fatte) return;
                Object.keys(f.fatte).forEach((k) => {
                    if (k !== sett && k.indexOf(sett + "-") !== 0) return;
                    const nome = ((f.fatteDa || {})[k] || "").split(" ")[0] || "?";
                    conta[nome] = (conta[nome] || 0) + 1;
                });
            });
            const nomi = Object.keys(conta).sort((a, b) => conta[b] - conta[a]);
            if (nomi.length) {
                const max = conta[nomi[0]];
                righe.push("🧹 Faccende: " + nomi.map((n) => n + " " + conta[n] + (conta[n] === max && max > 0 ? " 🌟" : "")).join(" · "));
            }
            // spese da lunedì a oggi
            const iso = (x) => x.toISOString().slice(0, 10);
            const lun = iso(new Date(Date.parse(oggi + "T12:00:00Z") - 6 * 86400000));
            const spesi = spese.reduce((t, x) => t + (x && x.data >= lun && x.data <= oggi ? Number(x.importo) || 0 : 0), 0);
            if (spesi > 0) righe.push("💶 Spesi questa settimana: " + euro(spesi));
            // impegni della prossima settimana
            const da = iso(new Date(Date.parse(oggi + "T12:00:00Z") + 86400000)), a7 = iso(new Date(Date.parse(oggi + "T12:00:00Z") + 7 * 86400000));
            const prossimi = appuntamenti.filter((x) => x && x.titolo && !x.pagata && x.data >= da && x.data <= a7)
                .sort((x, y) => (x.data + (x.ora || "99:99")).localeCompare(y.data + (y.ora || "99:99")));
            if (prossimi.length) {
                const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
                const p1 = prossimi[0], g1 = GIORNI[new Date(p1.data + "T12:00:00Z").getUTCDay()];
                righe.push("📅 La prossima: " + (prossimi.length === 1 ? "1 impegno" : prossimi.length + " impegni") + ", il primo " + g1 + (p1.ora ? " alle " + p1.ora : "") + " (" + p1.titolo + ")");
            } else righe.push("📅 La prossima settimana è libera");
            risultato.push({ chiave, titolo: "🌟 La vostra settimana", corpo: righe.join("\n"), tag: chiave });
        }
    }
    // 10) Budget del mese: un avviso all'80% e uno al 100% (di giorno)
    const budgetN = Number(budget) || 0;
    if (acceso("budget") && budgetN > 0 && d.getUTCHours() >= 9 && d.getUTCHours() < 21) {
        const mese = oggi.slice(0, 7);
        const tot = spese.reduce((t, x) => t + (x && typeof x.data === "string" && x.data.indexOf(mese) === 0 ? Number(x.importo) || 0 : 0), 0);
        const fineMese = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        const restano = fineMese - d.getUTCDate();
        const quando = restano === 0 ? "oggi è l'ultimo giorno" : restano === 1 ? "manca 1 giorno" : "mancano " + restano + " giorni";
        const corpo = "Spesi " + euro(tot) + " su " + euro(budgetN) + " · " + quando;
        if (tot >= budgetN) {
            const chiave = "bud100|" + mese;
            if (!giaInviati.has(chiave)) risultato.push({ chiave, titolo: "💶 Budget del mese superato", corpo, tag: chiave });
        } else if (tot >= budgetN * 0.8) {
            const chiave = "bud80|" + mese;
            if (!giaInviati.has(chiave)) risultato.push({ chiave, titolo: "💶 Budget del mese all'" + Math.floor(tot / budgetN * 100) + "%", corpo, tag: chiave });
        }
    }
    return risultato;
}

// Settimana come nell'app (es. "2026-W47"): serve per sapere se una faccenda è già fatta
export function settimanaIso(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const g = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - g);
    const a = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - a) / 864e5 + 1) / 7)).padStart(2, "0");
}

// Ore di silenzio: true se adesso le notifiche devono aspettare
export function inSilenzio(tipi, adesso) {
    if (!tipi || tipi.silenzio !== true) return false;
    const da = Number(tipi.silenzioDa), a = Number(tipi.silenzioA);
    if (isNaN(da) || isNaN(a) || da === a) return false;
    const h = new Date(adesso).getUTCHours();
    return da < a ? (h >= da && h < a) : (h >= da || h < a);
}

// Bottoni e comportamento di ogni notifica: li usano sia l'app Android sia la web app,
// così per cambiarli basta modificare questo file (niente ricostruzione dell'app).
// Ogni bottone: { t: testo, u: indirizzo da aprire nell'agenda (es. "?vai=chat") }
export function extraNotifica(n, adesso) {
    const tag = n.tag || "", titolo = n.titolo || "";
    const testo = encodeURIComponent(String(n.corpo || titolo).split("\n")[0].slice(0, 160));
    const ora = new Date(adesso).getUTCHours();   // ora italiana (vedi oraItalia)
    const tardi = ora < 19 ? { t: "🌙 Stasera", u: "?rimanda=sera&testo=" + testo } : { t: "☀️ Domani", u: "?rimanda=domani&testo=" + testo };
    const tra1 = { t: "⏰ Tra 1 ora", u: "?rimanda=60&testo=" + testo };
    let azioni = [], apri = "", canale = "agenda", silenziosa = false, sostituisci = "";
    if (/^mattina\|/.test(tag)) {
        // riepilogo del mattino: silenzioso, resta finché non lo togli, quello di oggi prende il posto di quello di ieri
        azioni = [{ t: "📅 Apri l'agenda", u: "?vai=agenda" }]; apri = "?vai=agenda";
        canale = "mattina"; silenziosa = true; sostituisci = "oggi";
    } else if (/^msg|Biglietto|💌/.test(tag + " " + titolo)) {
        azioni = [{ t: "💬 Rispondi", u: "?vai=chat" }]; apri = "?vai=chat";
    } else if (/^sca\d\|/.test(tag)) {
        // scadenza: "Pagata" la segna pagata (come il ✓ nell'agenda)
        const pz = tag.split("|"), giorno = pz[1] || "", cosa = pz.slice(2).join("|");
        azioni = [{ t: "✅ Pagata", u: "?pagata=" + encodeURIComponent(cosa) + "&giorno=" + giorno }, tardi];
    } else if (/^(pmsera|pmmat)\|/.test(tag) || /^\d{4}-\d{2}-\d{2}\|/.test(tag)) {
        // promemoria ("giorno|ora|testo", "pmsera|giorno|testo", "pmmat|giorno|testo"): "Fatto" lo segna fatto
        const pz = tag.split("|"), giorno = /^\d/.test(tag) ? pz[0] : pz[1], cosa = pz.slice(2).join("|");
        azioni = [{ t: "✅ Fatto", u: "?fatto=" + encodeURIComponent(cosa) + "&giorno=" + giorno }, tra1];
    } else if (/^sett\|/.test(tag)) {
        azioni = [{ t: "📊 Apri il riepilogo", u: "" }];
    } else if (/^bud(80|100)\|/.test(tag)) {
        azioni = [{ t: "💶 Apri le spese", u: "?vai=spese" }]; apri = "?vai=spese";
    } else if (/^facr\|/.test(tag)) {
        // promemoria faccenda: "Fatta" la segna fatta per oggi
        const id = tag.split("|")[2] || "";
        const cosa = encodeURIComponent(titolo.replace(/^🔔 Oggi: /, ""));
        azioni = [{ t: "✅ Fatta", u: "?fatta=" + encodeURIComponent(id) }, { t: tardi.t, u: tardi.u.replace(/testo=.*$/, "testo=" + cosa) }];
    } else if (/^(sera|compl|facn|facf|pens)\|/.test(tag) || /Oggi hai|Domani hai|Compleanno|Anniversario/i.test(titolo)) {
        azioni = [];
    } else {
        azioni = [tra1, tardi];
    }
    return { azioni: JSON.stringify(azioni), apri, canale, silenziosa: silenziosa ? "1" : "", sostituisci };
}
