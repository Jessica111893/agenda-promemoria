import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, deleteToken, isSupported }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyBFyh_kzds69VSEpmzQUNaPr2DrmCUaPhQ",
    authDomain: "miagenda-12c93.firebaseapp.com",
    projectId: "miagenda-12c93",
    storageBucket: "miagenda-12c93.firebasestorage.app",
    messagingSenderId: "355215056492",
    appId: "1:355215056492:web:a10a09f6a2a1b213698249"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CHIAVI = ["cose", "spese", "appuntamenti", "promemoria", "compleanni", "budget", "spesa", "countdown", "cestino", "bacheca"];   // condivise con l'altra persona
// Solo tue, anche se usi l'agenda condivisa: disposizione del Riepilogo, note, colori, tema e preferenze.
// Così, se disinstalli e reinstalli l'app, li ritrovi dopo l'accesso con Google.
const PERSONALE = "riepilogoLayout";
// (coloreAttivo e temaAttivo non si sincronizzano: sono solo una copia veloce dei colori in uso, non una scelta)
const ASPETTO = ["temaColori", "colorePrincipale", "vetro", "iconeMinimal", "animazioni", "coloriCategorie", "coloriCatApp", "meteoCitta",
    "densita", "notteAuto", "barraTab", "coloriSezioni", "sfondo", "intestazione", "fontApp", "categorieApp"];
const PERSONALI = [PERSONALE, "notificheTipi"].concat(ASPETTO);   // "notificheTipi": quali notifiche vuoi ricevere (le legge anche il server)
// Il Riepilogo (disposizione e note) è diverso tra telefono e computer: online si salva in due campi separati
const TIPO_DISPOSITIVO = (function () {
    try {
        const tocco = window.matchMedia("(pointer: coarse)").matches;
        const lato = Math.min(screen.width, screen.height);
        return tocco && lato < 820 ? "tel" : "pc";
    } catch (e) { return "pc"; }
})();
const campo = (k) => (k === PERSONALE ? PERSONALE + "_" + TIPO_DISPOSITIVO : k);
let annullaPersonale = null;
const attese = {};
let spazioId = null;
let riferimento = null;
let annulla = null;
let applicando = false;

// ---------- Salvataggio online ad ogni modifica ----------
const setItemOriginale = Storage.prototype.setItem;
Storage.prototype.setItem = function (chiave, valore) {
    setItemOriginale.call(this, chiave, valore);
    // disposizione e note: si salvano sul tuo spazio personale, poco dopo l'ultima modifica (non a ogni lettera)
    if (this === localStorage && !applicando && PERSONALI.indexOf(chiave) !== -1 && auth.currentUser) {
        clearTimeout(attese[chiave]);
        const uid = auth.currentUser.uid;
        attese[chiave] = setTimeout(() => {
            delete attese[chiave];
            const v = localStorage.getItem(chiave);
            setDoc(refPersonale(uid), { [campo(chiave)]: v === null ? "" : v }, { merge: true })
                .catch((e) => console.error("Salvataggio online:", e));
        }, 900);
        return;
    }
    if (this === localStorage && !applicando && riferimento && CHIAVI.indexOf(chiave) !== -1) {
        setDoc(riferimento, { [chiave]: valore }, { merge: true }).catch((e) => console.error("Salvataggio online:", e));
    }
};

// Anche quando una scelta personale viene TOLTA (es. "Colore del tema" toglie il colore scelto),
// lo si dice online: altrimenti alla riapertura tornerebbe il valore vecchio (es. il blu dello Stile sobrio).
const removeItemOriginale = Storage.prototype.removeItem;
Storage.prototype.removeItem = function (chiave) {
    removeItemOriginale.call(this, chiave);
    if (this === localStorage && !applicando && PERSONALI.indexOf(chiave) !== -1 && auth.currentUser) {
        clearTimeout(attese[chiave]);
        const uid = auth.currentUser.uid;
        attese[chiave] = setTimeout(() => {
            delete attese[chiave];
            const v = localStorage.getItem(chiave);
            setDoc(refPersonale(uid), { [campo(chiave)]: v === null ? "" : v }, { merge: true })
                .catch((e) => console.error("Salvataggio online:", e));
        }, 900);
    }
};

function ricarica() {
    cose = leggi("cose");
    spese = leggi("spese");
    appuntamenti = leggi("appuntamenti");
    promemoria = leggi("promemoria");
    compleanni = leggi("compleanni");
    budget = Number(localStorage.getItem("budget")) || 0;
    budgetInput.value = budget > 0 ? budget : "";
    mostraCose();
    mostraSpese();
    aggiornaTutto();
    aggiornaCompleanni();
    if (typeof mostraListaSpesa === "function") {
        vociSpesa = leggi("spesa");
        mostraListaSpesa();
    }
}

function applicaDati(dati) {
    applicando = true;
    CHIAVI.forEach((k) => {
        if (typeof dati[k] === "string") localStorage.setItem(k, dati[k]);
    });
    applicando = false;
    ricarica();
    window.dispatchEvent(new Event("dati-sincronizzati"));
}

function svuotaLocale(anchePersonali) {
    applicando = true;
    CHIAVI.forEach((k) => localStorage.removeItem(k));
    if (anchePersonali) PERSONALI.forEach((k) => localStorage.removeItem(k));
    applicando = false;
    ricarica();
}

// ---------- Percorsi dei dati ----------
const refPersonale = (uid) => doc(db, "utenti", uid, "dati", "principale");
const refImpostazioni = (uid) => doc(db, "utenti", uid, "dati", "impostazioni");
const refSpazio = (id) => doc(db, "spazi", id);
const refSpazioDati = (id) => doc(db, "spazi", id, "dati", "principale");

// ---------- Sincronizzazione ----------
function iniziaSincronizzazione(rif) {
    riferimento = rif;

    annulla = onSnapshot(rif, (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const dati = snap.exists() ? snap.data() : {};

        // I dati di questo dispositivo che online non ci sono ancora vengono caricati
        const mancanti = {};
        CHIAVI.forEach((k) => {
            const locale = localStorage.getItem(k);
            if (typeof dati[k] !== "string" && locale && locale !== "[]" && locale !== "0") {
                mancanti[k] = locale;
            }
        });
        if (Object.keys(mancanti).length > 0) {
            setDoc(rif, mancanti, { merge: true }).catch((e) => console.error(e));
        }

        applicaDati(dati);
    }, (errore) => {
        console.error("Lettura online:", errore);
        alert("Non riesco a leggere i dati online. Controlla le regole di Firestore.");
    });
}

// Le tue cose personali (disposizione, note, colori, tema): sempre dal tuo spazio personale
function iniziaPersonale(uid) {
    if (annullaPersonale) annullaPersonale();
    annullaPersonale = onSnapshot(refPersonale(uid), (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const dati = snap.exists() ? snap.data() : {};
        const a = document.activeElement;
        const staScrivendo = !!(a && a.tagName === "TEXTAREA");
        const mancanti = {};
        let cambiataLayout = false;
        let cambiatoAspetto = false;
        PERSONALI.forEach((k) => {
            const locale = localStorage.getItem(k);
            const remoto = dati[campo(k)];
            if (typeof remoto !== "string") {
                // online non c'è ancora: si carica quello di questo dispositivo
                if (locale && locale !== "[]") mancanti[campo(k)] = locale;
                return;
            }
            if (attese[k]) return;                                  // hai appena cambiato qualcosa: vale il tuo
            if (k === PERSONALE && staScrivendo) return;            // stai scrivendo una nota
            if (remoto === (locale === null ? "" : locale)) return;
            applicando = true;
            if (remoto === "") localStorage.removeItem(k); else localStorage.setItem(k, remoto);
            applicando = false;
            if (k === PERSONALE) cambiataLayout = true; else cambiatoAspetto = true;
        });
        if (Object.keys(mancanti).length > 0) {
            setDoc(refPersonale(uid), mancanti, { merge: true }).catch((e) => console.error(e));
        }
        if (cambiatoAspetto) {
            // colori e tema nuovi: si ricarica la pagina per applicarli (al massimo una volta ogni 5 minuti)
            let ultima = 0;
            try { ultima = Number(localStorage.getItem("ultimaRicaricaAuto") || 0); } catch (e) { }
            if (Date.now() - ultima > 5 * 60 * 1000) {
                try { setItemOriginale.call(localStorage, "ultimaRicaricaAuto", String(Date.now())); } catch (e) { }
                location.reload();
                return;
            }
        }
        if (cambiataLayout || cambiatoAspetto) window.dispatchEvent(new Event("dati-sincronizzati"));
    }, (errore) => console.error("Lettura online (personale):", errore));
}

function fermaSincronizzazione() {
    if (annulla) annulla();
    annulla = null;
    riferimento = null;
    if (annullaPersonale) annullaPersonale();
    annullaPersonale = null;
}

async function avvia(utente) {
    spazioId = null;
    try {
        const imp = await getDoc(refImpostazioni(utente.uid));
        if (imp.exists() && imp.data().spazio) spazioId = imp.data().spazio;
    } catch (e) {
        console.error("Impostazioni:", e);
    }
    if (auth.currentUser !== utente) return;
    // chi sei e se l'agenda è condivisa: servono per "Solo per me"
    window.mioUid = utente.uid;
    window.mioNome = utente.displayName || String(utente.email || "").split("@")[0];
    window.agendaCondivisa = !!spazioId;
    iniziaSincronizzazione(spazioId ? refSpazioDati(spazioId) : refPersonale(utente.uid));
    iniziaPersonale(utente.uid);
    aggiornaBottone();
}

function riavvia() {
    fermaSincronizzazione();
    if (auth.currentUser) avvia(auth.currentUser);
}

// ---------- Agenda condivisa ----------
function generaCodice() {
    const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const byte = new Uint8Array(10);
    crypto.getRandomValues(byte);
    let codice = "";
    byte.forEach((b) => { codice += alfabeto[b % alfabeto.length]; });
    return codice;
}

function mostraCodice(codice) {
    return codice.slice(0, 5) + "-" + codice.slice(5);
}

function messaggioErrore(e) {
    if (e && e.code === "permission-denied") {
        return "Permesso negato. Controlla di aver pubblicato le nuove regole di Firestore.";
    }
    return (e && (e.code || e.message)) || "errore sconosciuto";
}

async function creaSpazio() {
    const uid = auth.currentUser.uid;
    const codice = generaCodice();
    const dati = {};
    CHIAVI.forEach((k) => {
        const v = localStorage.getItem(k);
        if (v) dati[k] = v;
    });
    await setDoc(refSpazio(codice), { membri: [uid], creato: Date.now() });
    await setDoc(refSpazioDati(codice), dati);
    await setDoc(refImpostazioni(uid), { spazio: codice });
    riavvia();
    return codice;
}

async function uniscitiSpazio(testo) {
    const uid = auth.currentUser.uid;
    const codice = testo.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (codice.length < 6) throw new Error("Codice non valido");

    const ref = refSpazio(codice);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Codice non trovato");

    const membri = snap.data().membri || [];
    if (membri.indexOf(uid) === -1) {
        if (membri.length >= 2) throw new Error("Questa agenda ha già due persone");
        await updateDoc(ref, { membri: arrayUnion(uid) });
    }

    fermaSincronizzazione();
    svuotaLocale();
    await setDoc(refImpostazioni(uid), { spazio: codice });
    riavvia();
}

async function lasciaSpazio() {
    const uid = auth.currentUser.uid;
    const codice = spazioId;
    fermaSincronizzazione();
    try {
        if (codice) await updateDoc(refSpazio(codice), { membri: arrayRemove(uid) });
    } catch (e) {
        console.error(e);
    }
    await setDoc(refImpostazioni(uid), { spazio: null });
    svuotaLocale();
    riavvia();
}

// ---------- Pulsante nuvoletta e finestra ----------
const barra = document.querySelector(".comandi-alto");
const bottone = document.createElement("button");
bottone.className = "accesso-btn";
bottone.textContent = "☁️";
bottone.title = "Accedi con Google per sincronizzare i dati su tutti i dispositivi";
barra.appendChild(bottone);

function aggiornaBottone() {
    const utente = auth.currentUser;
    bottone.classList.toggle("connesso", !!utente);
    if (!utente) {
        bottone.title = "Accedi con Google per sincronizzare i dati su tutti i dispositivi";
        return;
    }
    const nome = (utente.displayName || "Connessa").split(" ")[0];
    bottone.title = spazioId
        ? "Connessa come " + nome + " · agenda condivisa"
        : "Connessa come " + nome;
}

function nodo(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined) e.textContent = testo;
    return e;
}

async function apriFinestra() {
    const velo = nodo("div", "velo");
    const fin = nodo("div", "finestra");
    velo.appendChild(fin);
    velo.addEventListener("click", (e) => { if (e.target === velo) velo.remove(); });
    document.body.appendChild(velo);

    const utente = auth.currentUser;
    fin.appendChild(nodo("h3", "", "Il tuo account"));
    fin.appendChild(nodo("p", "data-finestra", utente.displayName || utente.email || ""));

    function bottoneAzione(testo, classe, funzione) {
        const b = nodo("button", classe || "", testo);
        b.addEventListener("click", async () => {
            b.disabled = true;
            try {
                await funzione();
            } catch (e) {
                console.error(e);
                alert("Non riuscito: " + messaggioErrore(e));
                b.disabled = false;
            }
        });
        return b;
    }

    const esci = bottoneAzione("Esci dall'account", "annulla", async () => {
        if (!confirm("Vuoi uscire? I tuoi dati restano al sicuro online e li ritrovi con il prossimo accesso.")) {
            esci.disabled = false;
            return;
        }
        fermaSincronizzazione();
        svuotaLocale(true);
        await signOut(auth);
        location.reload();
    });

    const chiudi = bottoneAzione("Chiudi", "annulla", async () => { velo.remove(); });

    if (spazioId) {
        // ----- Già in un'agenda condivisa -----
        fin.appendChild(nodo("p", "nota", "Stai usando un'agenda condivisa. Condividi questo codice con l'altra persona:"));
        fin.appendChild(nodo("div", "codice-box", mostraCodice(spazioId)));

        let persone = "";
        try {
            const s = await getDoc(refSpazio(spazioId));
            if (s.exists()) persone = (s.data().membri || []).length + " persone collegate";
        } catch (e) { console.error(e); }
        if (persone) fin.appendChild(nodo("p", "nota", persone));

        const copia = bottoneAzione("Copia il codice", "", async () => {
            try { await navigator.clipboard.writeText(mostraCodice(spazioId)); } catch (e) { }
            copia.textContent = "Copiato ✓";
            copia.disabled = false;
        });
        fin.appendChild(copia);

        const lascia = bottoneAzione("Lascia l'agenda condivisa", "annulla", async () => {
            if (!confirm("Vuoi lasciare l'agenda condivisa? Tornerai alla tua agenda personale.")) {
                lascia.disabled = false;
                return;
            }
            await lasciaSpazio();
            velo.remove();
        });
        fin.appendChild(lascia);
    } else {
        // ----- Agenda personale: si può creare o unire -----
        fin.appendChild(nodo("p", "nota", "Condividi to do list, spese, appuntamenti, promemoria e compleanni con un'altra persona. Vedete e modificate le stesse cose, in tempo reale."));

        const crea = bottoneAzione("Crea un'agenda condivisa", "", async () => {
            const codice = await creaSpazio();
            velo.remove();
            alert("Fatto! Il codice da dare all'altra persona è:\n\n" + mostraCodice(codice) + "\n\nLo ritrovi in qualsiasi momento toccando la nuvoletta.");
        });
        fin.appendChild(crea);

        fin.appendChild(nodo("p", "nota", "Oppure inserisci il codice che ti ha dato l'altra persona (i tuoi dati attuali su questo dispositivo verranno sostituiti da quelli condivisi):"));
        const campo = nodo("input");
        campo.type = "text";
        campo.placeholder = "Codice (es. ABCDE-FGHJK)";
        fin.appendChild(campo);

        const unisci = bottoneAzione("Unisciti", "", async () => {
            await uniscitiSpazio(campo.value);
            velo.remove();
        });
        fin.appendChild(unisci);
    }

    const azioni = nodo("div", "azioni colonna");
    azioni.appendChild(esci);
    azioni.appendChild(chiudi);
    fin.appendChild(azioni);
}

bottone.addEventListener("click", async () => {
    if (auth.currentUser) {
        apriFinestra();
        return;
    }
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
        console.error(e);
        alert("Accesso non riuscito: " + (e.code || e.message));
    }
});

// Avviso quando non si è collegati: i dati restano solo su questo telefono e non si sincronizzano
function avvisoAccesso(utente) {
    const esistente = document.getElementById("avvisoAccesso");
    if (utente) {
        if (esistente) esistente.remove();
        return;
    }
    if (esistente) return;
    try {
        const nascosto = Number(localStorage.getItem("avvisoAccessoNascosto") || 0);
        if (Date.now() - nascosto < 12 * 3600 * 1000) return;   // chiuso da poco: non si ripresenta per 12 ore
    } catch (e) { }
    const b = nodo("div");
    b.id = "avvisoAccesso";
    b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom,0px));z-index:880;" +
        "display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;border-radius:999px;font:600 .9rem system-ui,sans-serif;" +
        "color:var(--testo,#333);background:color-mix(in srgb,var(--scheda,#fff) 82%,transparent);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);" +
        "box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:calc(100vw - 24px)";
    const testo = nodo("span", "", "☁️ Non sei collegato: i dati non si sincronizzano · ");
    const accedi = nodo("strong", "", "Accedi");
    accedi.style.color = "var(--colore-principale-scuro,var(--colore-principale,#cc7a8c))";
    testo.appendChild(accedi);
    testo.style.cursor = "pointer";
    testo.addEventListener("click", () => { bottone.click(); });
    const chiudi = nodo("button", "", "✕");
    chiudi.type = "button";
    chiudi.setAttribute("aria-label", "Chiudi");
    chiudi.style.cssText = "all:unset;cursor:pointer;padding:4px 8px;font-size:1rem;opacity:.6";
    chiudi.addEventListener("click", () => {
        try { setItemOriginale.call(localStorage, "avvisoAccessoNascosto", String(Date.now())); } catch (e) { }
        b.remove();
    });
    b.appendChild(testo);
    b.appendChild(chiudi);
    document.body.appendChild(b);
}

onAuthStateChanged(auth, (utente) => {
    fermaSincronizzazione();
    aggiornaBottone();
    if (utente) avvia(utente);
    setTimeout(() => avvisoAccesso(auth.currentUser), 1500);
});

// ---------- Notifiche push (promemoria con l'app chiusa) ----------
const CHIAVE_PUSH = "BI17F7P9c5LY5kh7MHManJ4Ve9CIKQ0mO5y4enbVY5_Cv_TfVPZ0apOt6cYJPK33bO2SpoV01bHUAqTHNTn0kTg";

async function registraPush() {
    const utente = auth.currentUser;
    if (!utente) return false;
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    if (!(await isSupported())) return false;

    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), { vapidKey: CHIAVE_PUSH, serviceWorkerRegistration: reg });
    if (!token) return false;

    localStorage.setItem("pushToken", token);
    await setDoc(doc(db, "utenti", utente.uid, "dispositivi", token), {
        aggiornato: Date.now(),
        dispositivo: navigator.userAgent.slice(0, 120)
    }, { merge: true });
    return true;
}

async function rimuoviPush() {
    const utente = auth.currentUser;
    const token = localStorage.getItem("pushToken");
    if (utente && token) {
        try { await deleteDoc(doc(db, "utenti", utente.uid, "dispositivi", token)); } catch (e) { console.error(e); }
    }
    try { await deleteToken(getMessaging(app)); } catch (e) { }
    localStorage.removeItem("pushToken");
}

window.pushRegistra = registraPush;
window.pushRimuovi = rimuoviPush;

// Dopo l'accesso, se le notifiche sono accese, il dispositivo si registra
onAuthStateChanged(auth, (u) => {
    if (u && localStorage.getItem("notificheOff") !== "si") {
        registraPush().catch((e) => console.error("Push:", e));
    }
});
