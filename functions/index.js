const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// Fallback, falls die Rotation noch nicht in der Cloud angelegt wurde
const DEFAULT_ROTATION = ["FLEMMING", "VASILJEVS", "ASADI", "HAUSGEM.", "KNEER", "LISKE", "GHARBI", "DILETTO"];
// Sonntag, an dem laut Muellkalender FLEMMING (Index 0) dran war - siehe index.html (getPersonForDate)
const ANCHOR_UTC = Date.UTC(2026, 5, 21);

// Liest die aktuelle Bewohner-Liste aus der Cloud (vom Admin per App verwaltet, siehe index.html)
async function getRotation() {
    const snap = await db.doc("kehrwoche/rotation").get();
    if (snap.exists && Array.isArray(snap.data().names) && snap.data().names.length > 0) {
        return snap.data().names;
    }
    return DEFAULT_ROTATION;
}

// Liest die "Wochen pro Familie"-Einstellung (siehe index.html: weeksPerTurn)
async function getWeeksPerTurn() {
    const snap = await db.doc("kehrwoche/rotation").get();
    if (snap.exists && Number.isInteger(snap.data().weeksPerTurn) && snap.data().weeksPerTurn > 0) {
        return snap.data().weeksPerTurn;
    }
    return 1;
}

// Identisch zur DST-sicheren Logik im Client (index.html: getPersonForDate).
// Die Kehrwoche-Woche beginnt Sonntags (nicht Montags), siehe echter Muellkalender.
function getPersonForDate(date, rotationArr, weeksPerTurn) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const sunday = new Date(d.setDate(d.getDate() - day));
    const sundayUTC = Date.UTC(sunday.getFullYear(), sunday.getMonth(), sunday.getDate());
    const weeksDiff = Math.floor((sundayUTC - ANCHOR_UTC) / (7 * 24 * 60 * 60 * 1000));
    const turnIndex = Math.floor(weeksDiff / weeksPerTurn);
    let index = turnIndex % rotationArr.length;
    if (index < 0) index += rotationArr.length;
    return rotationArr[index] || "FREE";
}

function formatDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Kalendertag/Stunde in Europe/Berlin, unabhaengig von der Server-Zeitzone der Cloud Function
// (die intern in UTC laeuft) - wichtig, da dailyReminderCheck jetzt stuendlich prueft und nicht
// mehr nur einmal abends, wo eine grobe UTC-Naeherung frueher noch unauffaellig war.
function getBerlinDateString(date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(date);
}

function getBerlinHour(date) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).formatToParts(date);
    return parseInt(parts.find((p) => p.type === "hour").value, 10);
}

// Sendet an eine Liste von Token-Dokument-IDs und entfernt ungueltig gewordene Tokens
async function sendAndCleanup(tokenDocs, buildMessage) {
    if (tokenDocs.length === 0) return;
    const messages = tokenDocs.map((doc) => ({ token: doc.id, ...buildMessage(doc) }));
    const response = await admin.messaging().sendEach(messages);
    const cleanup = [];
    response.responses.forEach((res, i) => {
        if (!res.success && res.error && res.error.code === "messaging/registration-token-not-registered") {
            cleanup.push(db.collection("pushTokens").doc(tokenDocs[i].id).delete());
        }
    });
    if (cleanup.length > 0) await Promise.all(cleanup);
}

// Laeuft stuendlich, sendet aber nur einmal taeglich - zur vom Admin in der App eingestellten
// Stunde (Feld "reminderHour" in kehrwoche/rotation, Default 18 Uhr, siehe index.html:
// saveReminderHour). Prueft dann ob morgen Kehrwoche beginnt oder Muell faellig ist, und
// benachrichtigt die betroffenen Familien.
exports.dailyReminderCheck = onSchedule(
    { schedule: "0 * * * *", timeZone: "Europe/Berlin" },
    async () => {
        const now = new Date();
        const todayStr = getBerlinDateString(now);
        const currentHour = getBerlinHour(now);

        const rotationSnap = await db.doc("kehrwoche/rotation").get();
        const rotationData = rotationSnap.exists ? rotationSnap.data() : {};
        const configuredHour = Number.isInteger(rotationData.reminderHour) && rotationData.reminderHour >= 0 && rotationData.reminderHour <= 23
            ? rotationData.reminderHour
            : 18;

        if (currentHour !== configuredHour) return;
        if (rotationData.lastReminderRunDate === todayStr) return;
        await db.doc("kehrwoche/rotation").set({ lastReminderRunDate: todayStr }, { merge: true });

        // "Morgen" ueber den Berlin-Kalendertag berechnen (nicht ueber rohe Server-UTC-Zeit),
        // damit das auch fuer fruehe Stunden (z.B. reminderHour = 1) korrekt bleibt.
        const [y, m, d] = todayStr.split("-").map(Number);
        const today = new Date(Date.UTC(y, m - 1, d));
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

        const rotationArr = await getRotation();
        const weeksPerTurn = await getWeeksPerTurn();

        // Kehrwoche beginnt Sonntags (Samstag = 1 Tag vorher)
        if (tomorrow.getUTCDay() === 0) {
            const person = getPersonForDate(tomorrow, rotationArr, weeksPerTurn);
            if (person !== "FREE" && person !== "HAUSGEM.") {
                const snap = await db.collection("pushTokens").where("familyName", "==", person).get();
                await sendAndCleanup(snap.docs, () => ({
                    data: {
                        title: "🧹 Morgen beginnt eure Kehrwoche!",
                        body: `Familie ${person} – ab morgen seid ihr für das Treppenhaus zuständig!`,
                    },
                }));
            }
        }

        const scheduleSnap = await db.doc("kehrwoche/schedule").get();
        const schedule = scheduleSnap.exists ? scheduleSnap.data().schedule || {} : {};
        const tomorrowStr = formatDateString(tomorrow);
        if (schedule[tomorrowStr]) {
            const names = schedule[tomorrowStr].map((t) => t.name).join(" & ");
            const allTokens = await db.collection("pushTokens").get();
            await sendAndCleanup(allTokens.docs, () => ({
                data: {
                    title: `🗑️ Morgen: ${names} rausstellen!`,
                    body: `Nicht vergessen – morgen wird ${names} abgeholt!`,
                },
            }));
        }
    }
);

// Benachrichtigt alle anderen Familien, wenn jemand eine neue Nachricht auf die Info-Tafel schreibt
exports.notifyNewMessage = onDocumentCreated("messages/{msgId}", async (event) => {
    const msg = event.data.data();
    const allTokens = await db.collection("pushTokens").get();
    const relevantDocs = allTokens.docs.filter((doc) => doc.data().familyName !== msg.sender);
    await sendAndCleanup(relevantDocs, () => ({
        data: {
            title: `📢 ${msg.sender} schreibt:`,
            body: msg.text,
        },
    }));
});

// Benachrichtigt eine Familie, wenn eine weitere Person sich ebenfalls als diese Familie anmeldet
exports.notifyIdentityConflict = onDocumentCreated("identityConflicts/{id}", async (event) => {
    const conflict = event.data.data();
    const snap = await db.collection("pushTokens").where("familyName", "==", conflict.familyName).get();
    const joinedByText = conflict.joinedBy ? ` (Familie ${conflict.joinedBy})` : "";
    await sendAndCleanup(snap.docs, () => ({
        data: {
            title: `👋 Noch jemand ist jetzt Familie ${conflict.familyName}`,
            body: `Eine weitere Person${joinedByText} hat sich ebenfalls als eure Familie angemeldet.`,
        },
    }));
});

// Benachrichtigt den Admin, wenn sich eine Familie zum allerersten Mal in der App anmeldet
// (z.B. wenn der QR-Code an der Haustuer haengt und man wissen will, wer sich zuerst meldet).
exports.notifyAdminFirstJoin = onDocumentCreated("identityFirstJoins/{id}", async (event) => {
    const join = event.data.data();
    const snap = await db.collection("pushTokens").where("isAdmin", "==", true).get();
    await sendAndCleanup(snap.docs, () => ({
        data: {
            title: `👋 Familie ${join.familyName} ist jetzt in der App!`,
            body: `Familie ${join.familyName} hat sich gerade zum ersten Mal angemeldet.`,
        },
    }));
});
