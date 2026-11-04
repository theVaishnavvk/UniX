# UniX Project Report Sample Code

## 1. Firebase Initialization and Admin Check
```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, doc, getDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true
});
export const storage = getStorage(app);

export async function checkAdmin(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  const data = snap.data() || {};
  return data.role === "Admin" || data.isAdmin === true;
}
```
This snippet shows the basic project setup using Firebase Authentication, Firestore, and Storage. It also includes a simple role check used to identify administrator accounts.

## 2. User Registration with Firestore Profile Creation
```js
async function registerUser(name, email, password, role, regNo) {
  if (role === "Student") {
    const regQuery = query(collection(db, "users"), where("regNo", "==", regNo));
    const regSnap = await getDocs(regQuery);
    if (!regSnap.empty) throw new Error("Register number already exists");
  }

  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  const userData = {
    name, email, role,
    regNo: role === "Student" ? regNo : null,
    points: 100,
    status: "Offline",
    createdAt: serverTimestamp()
  };

  await setDoc(doc(db, "users", user.uid), userData);
  await setDoc(doc(db, "publicUsers", user.uid), { name, online: false, points: 100 });
  await sendEmailVerification(user);
}
```
This sample represents the signup module. It validates student register numbers, creates a Firebase user, stores profile data in Firestore, and sends an email verification link.

## 3. Login and Password Recovery Logic
```js
async function loginUser(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return "Login successful";
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Invalid email or password",
      "auth/too-many-requests": "Too many attempts",
      "auth/network-request-failed": "Network error"
    };
    throw new Error(messages[error.code] || "Login failed");
  }
}

async function sendResetLink(email) {
  if (!email.trim()) throw new Error("Email is required");
  await sendPasswordResetEmail(auth, email.trim());
}
```
This snippet captures the main authentication flow for existing users. It includes secure login handling and a password reset feature for account recovery.

## 4. First Login Bonus Using a Firestore Transaction
```js
async function grantFirstDashboardBonus(user) {
  const userRef = doc(db, "users", user.uid);
  let awarded = false;

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(userRef);
    const data = snap.data() || {};
    if (data.firstDashboardBonusAwarded) return;

    transaction.update(userRef, {
      points: (Number(data.points) || 0) + 1000,
      firstDashboardBonusAwarded: true,
      firstDashboardBonusAwardedAt: serverTimestamp()
    });
    awarded = true;
  });

  if (awarded) {
    await addDoc(collection(db, "transactions"), {
      userId: user.uid, title: "First login welcome bonus",
      pointsChange: 1000, createdAt: serverTimestamp()
    });
  }
}
```
This code demonstrates transaction-based database logic. It ensures the welcome bonus is awarded only once, even if multiple requests happen at nearly the same time.

## 5. Marketplace Image Upload and Listing Creation
```js
async function uploadMarketplaceImage(file, currentUser) {
  const safeName = file.name.replace(/\s+/g, "_");
  const path = `marketplace/${currentUser.uid}_${Date.now()}_${safeName}`;
  const imageRef = ref(storage, path);
  const uploadSnapshot = await uploadBytes(imageRef, file);
  return getDownloadURL(uploadSnapshot.ref);
}

async function createListing(formData, currentUser, imageFile) {
  const imageUrl = imageFile ? await uploadMarketplaceImage(imageFile, currentUser) : "";
  await addDoc(collection(db, "marketplace"), {
    ...formData,
    imageUrl,
    sellerId: currentUser.uid,
    createdAt: serverTimestamp()
  });
}
```
This sample represents the marketplace module. It uploads an image to Firebase Storage and stores the listing information in Firestore with seller and timestamp data.

## 6. Chat Message Storage and Thread Update
```js
async function sendMessage(chatId, currentUserId, text) {
  if (!text.trim()) return;

  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: currentUserId,
    text: text.trim(),
    timestamp: serverTimestamp()
  });

  await updateDoc(doc(db, "chats", chatId), {
    lastMessage: text.trim(),
    lastMessageTime: serverTimestamp(),
    lastSenderId: currentUserId
  });
}
```
This code shows the core chat logic. Each message is stored in a subcollection, while the parent chat document is updated to keep the latest message summary for quick conversation loading.

## 7. Tutoring Enrollment Sequence Generation
```js
async function generateStudentDisplayId(courseId, enrollmentCount, highestSequence) {
  const courseRef = doc(db, "courses", courseId);

  return runTransaction(db, async (transaction) => {
    const courseSnap = await transaction.get(courseRef);
    if (!courseSnap.exists()) throw new Error("Course not found");

    const courseData = courseSnap.data() || {};
    const currentSequence = Math.max(
      Number(courseData.studentSequence) || 0,
      enrollmentCount,
      highestSequence
    );

    const nextSequence = currentSequence + 1;
    transaction.update(courseRef, { studentSequence: nextSequence });
    return `STU-${String(nextSequence).padStart(3, "0")}`;
  });
}
```
This snippet represents a core tutoring feature. It uses a Firestore transaction to assign each enrolled student a unique sequential display ID without duplication.

## 8. Public Profile Synchronization
```js
async function syncPublicProfileFields(uid, updates) {
  const publicUpdates = {};

  if (updates.name) publicUpdates.name = updates.name.trim();
  if (updates.photoURL) publicUpdates.photoURL = updates.photoURL;
  if (typeof updates.points !== "undefined") {
    publicUpdates.points = Number(updates.points) || 0;
  }
  if (typeof updates.online !== "undefined") {
    publicUpdates.online = Boolean(updates.online);
  }

  if (Object.keys(publicUpdates).length > 0) {
    await setDoc(doc(db, "publicUsers", uid), publicUpdates, { merge: true });
  }
}
```
This sample shows how the project separates private and public user data. Only selected fields are copied into a public profile document for safer sharing across modules like chat and marketplace.
