import { auth, db } from "./firebase.js";

import {
    collection,
    onSnapshot,
    query,
    orderBy,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

import { onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

/* ===============================
   NAVBAR LOAD
================================= */

fetch("navbar.html")
    .then(res => res.text())
    .then(data => {
        const navContainer = document.getElementById("navbar-container");
        if (navContainer) navContainer.innerHTML = data;
    });

/* ===============================
   DOM ELEMENTS
================================= */

const modal = document.getElementById("postModal");
const openBtn = document.getElementById("openPostModal");
const closeBtn = document.getElementById("closePostModal");
const grid = document.getElementById("marketplaceGrid");

/* ===============================
   MODAL OPEN / CLOSE
================================= */

if (openBtn && modal) {
    openBtn.addEventListener("click", () => {
        modal.style.display = "flex";
    });
}

if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
    });
}

/* ===============================
   AUTH CHECK
================================= */

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    loadMarketplace();

    const submitBtn = document.getElementById("submitItem");

    if (submitBtn) {
        submitBtn.addEventListener("click", async () => {

            const title = document.getElementById("itemTitle").value;
            const description = document.getElementById("itemDescription").value;
            const price = Number(document.getElementById("itemPrice").value);
            const category = document.getElementById("itemCategory").value;
            const condition = document.getElementById("itemCondition").value;

            if (!title || !price) {
                alert("Title and Price are required.");
                return;
            }

            await addDoc(collection(db, "marketplace"), {
                title,
                description,
                price,
                category,
                condition,
                status: "available",
                sellerId: user.uid,
                sellerName: user.email,
                createdAt: serverTimestamp()
            });

            modal.style.display = "none";
        });
    }
});

/* ===============================
   LOAD MARKETPLACE
================================= */

function loadMarketplace() {

    const q = query(
        collection(db, "marketplace"),
        orderBy("createdAt", "desc")
    );

    onSnapshot(q, (snapshot) => {

        if (!grid) return;

        grid.innerHTML = "";

        snapshot.forEach(docSnap => {

            const data = docSnap.data();

            const card = document.createElement("div");
            card.classList.add("product-card");

            card.innerHTML = `
        <div class="product-title">${data.title}</div>
        <div class="product-price">₹ ${data.price}</div>
        <div class="product-meta">
          ${data.category || ""} • ${data.condition || ""}
        </div>
        <div class="product-meta">
          Status: ${data.status}
        </div>
      `;

            grid.appendChild(card);

        });

    });
}
