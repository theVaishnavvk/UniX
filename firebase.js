import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

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
const db = getFirestore(app);

export { auth, db };