const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require("@firebase/rules-unit-testing");

const {
  doc,
  getDoc,
  setDoc,
  updateDoc
} = require("firebase/firestore");

const {
  before,
  after,
  beforeEach,
  test
} = require("node:test");

const { readFileSync } = require("node:fs");

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "unix-56a13",
    firestore: {
      rules: readFileSync("firebase.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedUser(uid, data = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users", uid), {
      name: uid,
      email: `${uid}@example.com`,
      role: "Student",
      isAdmin: false,
      points: 100,
      regNo: "TEST001",
      createdAt: "2026-11-05",
      ...data
    });
  });
}

test("Unauthenticated users cannot read private profiles", async () => {
  await seedUser("alice");

  const db = testEnv.unauthenticatedContext().firestore();

  await assertFails(
    getDoc(doc(db, "users", "alice"))
  );
});

test("Students cannot read another user's private profile", async () => {
  await seedUser("alice");
  await seedUser("bob");

  const db = testEnv.authenticatedContext("alice", {
    email: "alice@example.com"
  }).firestore();

  await assertFails(
    getDoc(doc(db, "users", "bob"))
  );
});

test("Students cannot promote themselves to Admin", async () => {
  await seedUser("alice");

  const db = testEnv.authenticatedContext("alice", {
    email: "alice@example.com"
  }).firestore();

  await assertFails(
    updateDoc(doc(db, "users", "alice"), {
      role: "Admin"
    })
  );
});

test("Students cannot modify their own points", async () => {
  await seedUser("alice");

  const db = testEnv.authenticatedContext("alice", {
    email: "alice@example.com"
  }).firestore();

  await assertFails(
    updateDoc(doc(db, "users", "alice"), {
      points: 999999
    })
  );
});

test("Users can create their own positive XP logs", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();

  await assertSucceeds(
    setDoc(doc(db, "xpLogs", "alice-log"), {
      userId: "alice",
      amount: 10,
      createdAt: "2026-11-05"
    })
  );
});

test("Users cannot create XP logs for another user", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();

  await assertFails(
    setDoc(doc(db, "xpLogs", "fake-log"), {
      userId: "bob",
      amount: 10000,
      createdAt: "2026-11-05"
    })
  );
});

test("Users cannot spoof another person's notification identity", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();

  await assertFails(
    setDoc(doc(db, "notifications", "forged"), {
      userId: "alice",
      actorId: "bob",
      message: "Fake notification",
      read: false,
      createdAt: "2026-11-05",
      type: "test"
    })
  );
});

test("Chat participants can read and send messages", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "chats", "alice_bob"),
      { participants: ["alice", "bob"] }
    );
  });

  const db = testEnv.authenticatedContext("alice").firestore();

  await assertSucceeds(
    getDoc(doc(db, "chats", "alice_bob"))
  );

  await assertSucceeds(
    setDoc(doc(db, "chats", "alice_bob", "messages", "message-1"), {
      senderId: "alice",
      text: "Hello",
      timestamp: "2026-11-05"
    })
  );
});

test("Non-participants cannot read private chats", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), "chats", "alice_bob"),
      { participants: ["alice", "bob"] }
    );
  });

  const db = testEnv.authenticatedContext("charlie").firestore();

  await assertFails(
    getDoc(doc(db, "chats", "alice_bob"))
  );
});
