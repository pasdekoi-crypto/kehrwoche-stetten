const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const ROTATION = ["FLEMMING", "VASILJEVS", "ASADI", "HAUSGEM.", "KNEER", "LISKE", "GHARBI", "DILETTO"];
const ANCHOR_UTC = Date.UTC(2026, 0, 5);

// Identisch zur DST-sicheren Logik im Client (index.html: getPersonForDate)
function getPersonForDate(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const mondayUTC = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate());
    const weeksDiff = Math.floor((mondayUTC - ANCHOR_UTC) / (7 * 24 * 60 * 60 * 1000));
    let index = weeksDiff % ROTATION.length;
    if (index < 0) index += ROTATION.length;
    return ROTATION[index] || "FREE";
}

function formatDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

// Laeuft taeglich um 18:00 (Europe/Berlin): prueft ob morgen Kehrwoche beginnt
// oder Muell faellig ist, und benachrichtigt die betroffenen Familien.
exports.dailyReminderCheck = onSchedule(
    { schedule: "0 18 * * *", timeZone: "Europe/Berlin" },
    async () => {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        if (tomorrow.getDay() === 1) {
            const person = getPersonForDate(tomorrow);
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
