
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { initializeFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";
import {
    getFunctions,
    connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-functions.js";

import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import { connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDQEhPKUc3ONpTHWpkombGJ_LOozkLPM3w",
    authDomain: "unix-56a13.firebaseapp.com",
    projectId: "unix-56a13",
    storageBucket: "unix-56a13.firebasestorage.app",
    messagingSenderId: "592543532512",
    appId: "1:592543532512:web:493768bdfad69dfb955785"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    // Helps on networks/browsers where HTTP3/QUIC transport is unstable.
    experimentalAutoDetectLongPolling: true
});
const storage = getStorage(app);

const functions = getFunctions(app, "asia-south1");

// Use local Firebase emulators only on localhost.
if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export { auth, db, storage, functions };

export async function checkAdmin(user, db) {
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.data();

    return (
        data?.role === "Admin" ||
        data?.isAdmin === true ||
        user.email === "admin@unix.com" ||
        user.email === "vaishnav@unix.com"
    );
}
