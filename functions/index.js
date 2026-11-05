
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();

const db = getFirestore();

setGlobalOptions({
  maxInstances: 10,
  region: "asia-south1"
});

const APPLY_REWARD = 2;

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  return request.auth.uid;
}

function validateId(value, fieldName) {
  const id = String(value || "").trim();

  if (!id || id.includes("/") || id.length > 1500) {
    throw new HttpsError("invalid-argument", `Invalid ${fieldName}.`);
  }

  return id;
}

function safePoints(value) {
  const points = Number(value);
  return Number.isFinite(points) ? points : 0;
}

function applicationId(requestId, applicantId) {
  return `${requestId.replace(/\//g, "_")}__${applicantId.replace(/\//g, "_")}`;
}

function createTransactionRecord({
  userId,
  points,
  source,
  title,
  requestId,
  requestTitle
}) {
  return {
    userId,
    type: source === "apply_request"
      ? "skills_apply_request"
      : "skills_cancel_application",
    title,
    category: "skills",
    source,
    points,
    pointsChange: points,
    amount: points,
    requestId,
    requestTitle,
    createdAt: new Date()
  };
}

async function applyToRequestHandler(request) {
  const applicantId = requireAuth(request);
  const requestId = validateId(request.data?.requestId, "request ID");

  const requestRef = db.collection("requests").doc(requestId);
  const applicantRef = db.collection("users").doc(applicantId);
  const publicApplicantRef = db.collection("publicUsers").doc(applicantId);

  // Preserve the existing application document ID format.
  const applicationRef = db.collection("applications")
    .doc(applicationId(requestId, applicantId));

  const notificationRef = applicantRef.collection("notifications").doc();
  const transactionRef = db.collection("transactions").doc();

  return db.runTransaction(async (transaction) => {
    const [requestSnap, applicantSnap, publicSnap, applicationSnap] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(applicantRef),
        transaction.get(publicApplicantRef),
        transaction.get(applicationRef)
      ]);

    if (!requestSnap.exists) {
      throw new HttpsError("not-found", "This request does not exist.");
    }

    if (!applicantSnap.exists) {
      throw new HttpsError("failed-precondition", "Your user profile was not found.");
    }

    const requestData = requestSnap.data();
    const applicantData = applicantSnap.data();

    if (requestData.userId === applicantId) {
      throw new HttpsError(
        "permission-denied",
        "You cannot apply to your own request."
      );
    }

    if (requestData.status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        "This request is no longer open."
      );
    }

    if (applicationSnap.exists &&
        applicationSnap.data().status === "pending") {
      return {
        success: true,
        alreadyApplied: true,
        pointsChange: 0,
        message: "You already have a pending application."
      };
    }

    if (applicationSnap.exists &&
        applicationSnap.data().status === "accepted") {
      throw new HttpsError(
        "failed-precondition",
        "This application has already been accepted."
      );
    }

    const applicantName = String(
      applicantData.name || request.auth.token.name || "Student"
    ).trim();

    const requestTitle = String(requestData.title || "Request").trim();
    const newBalance = safePoints(applicantData.points) + APPLY_REWARD;
    const message = `+${APPLY_REWARD} pts earned for applying to help on "${requestTitle}".`;
    const now = new Date();

    // All reads have happened. Start the atomic writes.
    transaction.set(applicationRef, {
      requestId,
      applicantId,
      applicantName,
      requestTitle,
      status: "pending",
      appliedAt: now
    });

    transaction.update(applicantRef, {
      points: newBalance
    });

    if (publicSnap.exists) {
      transaction.update(publicApplicantRef, {
        points: safePoints(publicSnap.data().points) + APPLY_REWARD
      });
    }

    transaction.set(notificationRef, {
      userId: applicantId,
      actorId: applicantId,
      message,
      read: false,
      createdAt: now,
      type: "points",
      amount: APPLY_REWARD,
      source: "apply_request",
      requestId
    });

    transaction.set(transactionRef, createTransactionRecord({
      userId: applicantId,
      points: APPLY_REWARD,
      source: "apply_request",
      title: message,
      requestId,
      requestTitle
    }));

    return {
      success: true,
      alreadyApplied: false,
      pointsChange: APPLY_REWARD,
      newBalance,
      message: "Application submitted successfully."
    };
  });
}

async function removePendingApplicationHandler(request, action) {
  const applicantId = requireAuth(request);
  const requestId = validateId(request.data?.requestId, "request ID");

  const applicationRef = db.collection("applications")
    .doc(applicationId(requestId, applicantId));

  const applicantRef = db.collection("users").doc(applicantId);
  const publicApplicantRef = db.collection("publicUsers").doc(applicantId);

  const notificationRef = applicantRef.collection("notifications").doc();
  const transactionRef = db.collection("transactions").doc();

  return db.runTransaction(async (transaction) => {
    const [applicationSnap, applicantSnap, publicSnap] =
      await Promise.all([
        transaction.get(applicationRef),
        transaction.get(applicantRef),
        transaction.get(publicApplicantRef)
      ]);

    if (!applicationSnap.exists) {
      return {
        success: true,
        alreadyRemoved: true,
        pointsChange: 0,
        message: "No application was found."
      };
    }

    const applicationData = applicationSnap.data();

    if (applicationData.applicantId !== applicantId ||
        applicationData.requestId !== requestId) {
      throw new HttpsError(
        "permission-denied",
        "You cannot remove this application."
      );
    }

    if (applicationData.status !== "pending") {
      throw new HttpsError(
        "failed-precondition",
        "Only pending applications can be removed."
      );
    }

    if (!applicantSnap.exists) {
      throw new HttpsError("failed-precondition", "Your user profile was not found.");
    }

    const requestTitle = String(applicationData.requestTitle || "Request").trim();
    const newBalance = safePoints(applicantSnap.data().points) - APPLY_REWARD;
    const actionText = action === "withdraw" ? "withdrew" : "cancelled";
    const message = `-${APPLY_REWARD} pts deducted because you ${actionText} your application for "${requestTitle}".`;
    const now = new Date();

    // Delete and deduct in the same transaction.
    transaction.delete(applicationRef);

    transaction.update(applicantRef, {
      points: newBalance
    });

    if (publicSnap.exists) {
      transaction.update(publicApplicantRef, {
        points: safePoints(publicSnap.data().points) - APPLY_REWARD
      });
    }

    transaction.set(notificationRef, {
      userId: applicantId,
      actorId: applicantId,
      message,
      read: false,
      createdAt: now,
      type: "points",
      amount: -APPLY_REWARD,
      source: "cancel_application",
      requestId
    });

    transaction.set(transactionRef, createTransactionRecord({
      userId: applicantId,
      points: -APPLY_REWARD,
      source: "cancel_application",
      title: message,
      requestId,
      requestTitle
    }));

    return {
      success: true,
      alreadyRemoved: false,
      pointsChange: -APPLY_REWARD,
      newBalance,
      message: `Application ${action === "withdraw" ? "withdrawn" : "cancelled"}.`
    };
  });
}

exports.applyToRequest = onCall(async (request) => {
  return applyToRequestHandler(request);
});

exports.cancelApplication = onCall(async (request) => {
  return removePendingApplicationHandler(request, "cancel");
});

exports.withdrawApplication = onCall(async (request) => {
  return removePendingApplicationHandler(request, "withdraw");
});
