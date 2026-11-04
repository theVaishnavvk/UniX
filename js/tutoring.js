import { auth, db, storage } from "./firebase.js";
import { optimizeImageFileForUpload } from "./image-upload-utils.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { collection, getDocs, addDoc, doc, getDoc, setDoc, query, where, updateDoc, runTransaction, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

console.log("Tutoring module initialized.");

let allCoursesData = [];
let courseReviewSummaryMap = new Map();
let authReadyPromise = null;

const manageDashboardState = {
  courses: [],
  courseId: "",
  course: null,
  applicants: [],
  filter: "all",
  actionInFlightId: "",
  attendanceInFlightId: "",
  applicantsRequestToken: 0,
  assetRemovals: {
    qrCode: false,
    image: false
  }
};

const myLearningState = {
  currentUserId: "",
  entries: [],
  tab: "active"
};

const sessionPageState = {
  courseId: "",
  course: null,
  currentUser: null,
  currentEnrollment: null,
  reviews: [],
  reviewSort: "helpful",
  reviewRating: 0,
  reviewSubmitting: false,
  reviewEventsBound: false
};

function waitForInitialAuthState() {
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve(user || null);
      }, () => {
        resolve(auth.currentUser || null);
      });
    });
  }

  return authReadyPromise;
}

async function addTutoringNotification(userId, message, options = {}) {
  const safeUserId = String(userId || "").trim();
  const safeMessage = String(message || "").trim();
  if (!safeUserId || !safeMessage) return false;

  const payload = {
    userId: safeUserId,
    message: safeMessage,
    read: false,
    createdAt: serverTimestamp(),
    source: "tutoring",
    type: String(options.type || "tutoring_update").trim() || "tutoring_update"
  };

  if (options.courseId) {
    payload.courseId = String(options.courseId);
  }

  if (options.enrollmentId) {
    payload.enrollmentId = String(options.enrollmentId);
  }

  try {
    await Promise.allSettled([
      addDoc(collection(db, "notifications"), payload),
      addDoc(collection(db, "users", safeUserId, "notifications"), payload)
    ]);
    return true;
  } catch (error) {
    console.error("Failed to write tutoring notification:", error);
    return false;
  }
}

async function addTutoringTransaction(userId, title, options = {}) {
  const safeUserId = String(userId || "").trim();
  const safeTitle = String(title || "").trim();
  if (!safeUserId || !safeTitle) return false;

  const payload = {
    userId: safeUserId,
    title: safeTitle,
    category: "tutoring",
    source: "tutoring",
    type: String(options.type || "tutoring_update").trim() || "tutoring_update",
    createdAt: serverTimestamp()
  };

  if (options.courseId) {
    payload.courseId = String(options.courseId).trim();
  }

  if (options.courseTitle) {
    payload.courseTitle = String(options.courseTitle).trim();
  }

  if (options.enrollmentId) {
    payload.enrollmentId = String(options.enrollmentId).trim();
  }

  const numericAmount = Number(options.amount);
  if (Number.isFinite(numericAmount) && numericAmount > 0) {
    payload.amount = numericAmount;
  }

  try {
    await addDoc(collection(db, "transactions"), payload);
    return true;
  } catch (error) {
    console.warn("Tutoring transaction write failed:", error);
    return false;
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveDisplayName(data, fallbackId = "") {
  const candidates = [
    data?.name,
    data?.username,
    data?.displayName,
    data?.fullName,
    data?.userName
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const email = data?.email;
  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0];
  }

  return fallbackId || "User";
}

function isDeletedAccountProfile(data = {}) {
  const status = String(data?.status || "").trim().toLowerCase();
  return Boolean(data?.deletedAt) || status === "deleted";
}

function formatCoursePrice(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return "Free";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(numericValue) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(numericValue) ? 0 : 2
  }).format(numericValue);
}

function isFreeCourse(course) {
  const numericValue = Number(course?.price);
  return Number.isFinite(numericValue) && numericValue <= 0;
}

function getCourseImageUrl(course) {
  const candidates = [
    course?.image,
    course?.imageUrl,
    course?.coverImage,
    course?.thumbnailUrl,
    course?.thumbnail
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function setAssetActionButtonContent(buttonEl, iconClass, text) {
  if (!buttonEl) return;
  buttonEl.innerHTML = `<i class="${iconClass}"></i><span>${escapeHTML(text)}</span>`;
}

function getCreateAssetConfig(assetKey) {
  if (assetKey === "qrCode") {
    return {
      inputId: "qrCodeUpload",
      imageId: "qrCodeUploadPreview",
      emptyId: "qrCodeUploadEmpty",
      textId: "qrCodeUploadText",
      actionBtnId: "clearQrCodeUploadBtn",
      defaultLabel: "Click to upload a payment QR code"
    };
  }

  if (assetKey === "image") {
    return {
      inputId: "imageUpload",
      imageId: "imageUploadPreview",
      emptyId: "imageUploadEmpty",
      textId: "imageUploadText",
      actionBtnId: "clearImageUploadBtn",
      defaultLabel: "Click to upload a course image"
    };
  }

  return null;
}

function getManageAssetConfig(assetKey) {
  if (assetKey === "qrCode") {
    return {
      inputId: "manageQrCodeUpload",
      imageId: "manageQrCodePreview",
      emptyId: "manageQrCodeEmpty",
      textId: "manageQrCodeUploadText",
      actionBtnId: "manageQrCodeActionBtn",
      getCurrentValue: () => manageDashboardState.course?.qrCode || "",
      loadedText: "Current QR code loaded. Click to replace it.",
      emptyText: "Click to upload a payment QR code",
      removedText: "QR code will be removed when you save.",
      removeLabel: "Remove QR code",
      clearSelectionLabel: "Clear selected QR code",
      undoLabel: "Undo QR code removal",
      emptyLabel: "No QR code uploaded"
    };
  }

  if (assetKey === "image") {
    return {
      inputId: "manageCourseImageUpload",
      imageId: "manageCourseImagePreview",
      emptyId: "manageCourseImageEmpty",
      textId: "manageCourseImageUploadText",
      actionBtnId: "manageCourseImageActionBtn",
      getCurrentValue: () => getCourseImageUrl(manageDashboardState.course),
      loadedText: "Current course image loaded. Click to replace it.",
      emptyText: "Click to upload a course image",
      removedText: "Course image will be removed when you save.",
      removeLabel: "Remove course image",
      clearSelectionLabel: "Clear selected image",
      undoLabel: "Undo course image removal",
      emptyLabel: "No course image uploaded"
    };
  }

  return null;
}

function resetManageAssetRemovalState() {
  manageDashboardState.assetRemovals.qrCode = false;
  manageDashboardState.assetRemovals.image = false;
}

function updateCreateAssetActionButton(assetKey) {
  const config = getCreateAssetConfig(assetKey);
  if (!config) return;

  const inputEl = document.getElementById(config.inputId);
  const buttonEl = document.getElementById(config.actionBtnId);
  if (!buttonEl) return;

  const hasSelectedFile = Boolean(inputEl && inputEl.files && inputEl.files[0]);
  buttonEl.disabled = !hasSelectedFile;
  buttonEl.classList.toggle("is-danger", hasSelectedFile);
}

function clearCreateAssetSelection(assetKey) {
  const config = getCreateAssetConfig(assetKey);
  if (!config) return;

  const inputEl = document.getElementById(config.inputId);
  const imageEl = document.getElementById(config.imageId);
  const emptyEl = document.getElementById(config.emptyId);
  const textEl = document.getElementById(config.textId);

  if (inputEl) inputEl.value = "";
  setManagedAssetPreview(imageEl, emptyEl, textEl, "", config.defaultLabel);
  updateCreateAssetActionButton(assetKey);
}

function updateManageAssetActionButton(assetKey) {
  const config = getManageAssetConfig(assetKey);
  if (!config) return;

  const inputEl = document.getElementById(config.inputId);
  const buttonEl = document.getElementById(config.actionBtnId);
  if (!buttonEl) return;

  const currentValue = config.getCurrentValue();
  const hasSelectedFile = Boolean(inputEl && inputEl.files && inputEl.files[0]);
  const markedForRemoval = manageDashboardState.assetRemovals?.[assetKey] === true;

  buttonEl.classList.remove("is-danger");

  if (hasSelectedFile) {
    buttonEl.disabled = false;
    buttonEl.classList.add("is-danger");
    setAssetActionButtonContent(buttonEl, "fa-solid fa-xmark", config.clearSelectionLabel);
    return;
  }

  if (currentValue && markedForRemoval) {
    buttonEl.disabled = false;
    setAssetActionButtonContent(buttonEl, "fa-solid fa-rotate-left", config.undoLabel);
    return;
  }

  if (currentValue) {
    buttonEl.disabled = false;
    buttonEl.classList.add("is-danger");
    setAssetActionButtonContent(buttonEl, "fa-solid fa-trash-can", config.removeLabel);
    return;
  }

  buttonEl.disabled = true;
  setAssetActionButtonContent(buttonEl, "fa-solid fa-trash-can", config.emptyLabel);
}

function refreshManageAssetControl(assetKey) {
  const config = getManageAssetConfig(assetKey);
  if (!config) return;

  refreshManagedAssetInputPreview({
    inputId: config.inputId,
    imageId: config.imageId,
    emptyId: config.emptyId,
    textId: config.textId,
    currentValue: config.getCurrentValue(),
    loadedText: config.loadedText,
    emptyText: config.emptyText,
    removed: manageDashboardState.assetRemovals?.[assetKey] === true,
    removedText: config.removedText
  });

  updateManageAssetActionButton(assetKey);
}

function toggleManageAssetRemoval(assetKey) {
  const config = getManageAssetConfig(assetKey);
  if (!config) return;

  const inputEl = document.getElementById(config.inputId);
  const hasSelectedFile = Boolean(inputEl && inputEl.files && inputEl.files[0]);

  if (hasSelectedFile) {
    inputEl.value = "";
    manageDashboardState.assetRemovals[assetKey] = false;
    refreshManageAssetControl(assetKey);
    return;
  }

  if (!config.getCurrentValue()) return;

  manageDashboardState.assetRemovals[assetKey] = !(manageDashboardState.assetRemovals?.[assetKey] === true);
  refreshManageAssetControl(assetKey);
}

function formatDateLabel(value) {
  if (!value) return "Date not available";

  const rawValue = String(value).trim();
  const dateOnlyMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateValue = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(value);

  if (Number.isNaN(dateValue.getTime())) {
    return "Date not available";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(dateValue);
}

function parseDateValue(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const dateValue = value.toDate();
    return Number.isNaN(dateValue.getTime()) ? null : dateValue;
  }

  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    const dateValue = new Date(value.seconds * 1000);
    return Number.isNaN(dateValue.getTime()) ? null : dateValue;
  }

  const dateValue = new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

function getTimestampValue(...values) {
  for (const value of values) {
    const parsedDate = parseDateValue(value);
    if (parsedDate) {
      return parsedDate.getTime();
    }
  }

  return 0;
}

function formatCourseStartDateLabel(value) {
  if (!value) return "Start date not updated";

  const formattedValue = formatDateLabel(value);
  return formattedValue === "Date not available" ? "Start date not updated" : formattedValue;
}

function formatCourseSummary(value) {
  const normalizedValue = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalizedValue) return "";
  if (normalizedValue.length <= 170) return normalizedValue;

  const truncatedValue = normalizedValue.slice(0, 167).trimEnd();
  const lastSpaceIndex = truncatedValue.lastIndexOf(" ");
  return `${(lastSpaceIndex > 110 ? truncatedValue.slice(0, lastSpaceIndex) : truncatedValue)}...`;
}

function openCourseSession(courseId, options = {}) {
  const safeCourseId = String(courseId || "").trim();
  if (!safeCourseId) return;

  const params = new URLSearchParams({ id: safeCourseId });
  if (options.action) {
    params.set("action", String(options.action).trim());
  }

  localStorage.setItem("selectedCourse", safeCourseId);
  window.location.href = `session.html?${params.toString()}`;
}

function normalizeCount(value) {
  return Math.max(Number(value) || 0, 0);
}

function getCourseTotalSessions(course) {
  return normalizeCount(course?.totalSessions);
}

function formatAttendanceProgress(attendanceCount, totalSessions) {
  const safeAttendanceCount = normalizeCount(attendanceCount);
  const safeTotalSessions = normalizeCount(totalSessions);

  if (safeTotalSessions > 0) {
    return `${safeAttendanceCount} / ${safeTotalSessions} sessions`;
  }

  return `${safeAttendanceCount} ${safeAttendanceCount === 1 ? "session" : "sessions"}`;
}

function normalizeEnrollmentStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return ["pending", "approved", "completed", "rejected"].includes(normalized) ? normalized : "";
}

function clampReviewRating(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.min(Math.max(numericValue, 0), 5);
}

function normalizeReviewInputRating(value) {
  return Math.round(clampReviewRating(value));
}

function buildReviewDocId(courseId, studentId) {
  const safeCourseId = String(courseId || "").trim();
  const safeStudentId = String(studentId || "").trim();
  return safeCourseId && safeStudentId ? `${safeCourseId}__${safeStudentId}` : "";
}

function formatReviewDateLabel(value) {
  const parsedDate = parseDateValue(value);
  if (!parsedDate) return "Recently";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsedDate);
}

function formatRelativeTime(value) {
  const parsedDate = parseDateValue(value);
  if (!parsedDate) return "Recently";

  const diffMs = Math.max(Date.now() - parsedDate.getTime(), 0);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const oneMonthMs = 30 * oneDayMs;
  const oneYearMs = 365 * oneDayMs;

  if (diffMs < oneDayMs) return "Today";

  if (diffMs < oneMonthMs) {
    const days = Math.max(Math.floor(diffMs / oneDayMs), 1);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }

  if (diffMs < oneYearMs) {
    const months = Math.max(Math.floor(diffMs / oneMonthMs), 1);
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  }

  const years = Math.max(Math.floor(diffMs / oneYearMs), 1);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

function getStarRatingMarkup(rating, options = {}) {
  const safeRating = clampReviewRating(rating);
  const fillPercent = `${Math.max(Math.min((safeRating / 5) * 100, 100), 0)}%`;
  const sizeClass = options.size === "small" ? " small" : " large";
  const label = String(options.label || `${safeRating.toFixed(1)} out of 5 stars`);
  const baseStars = Array.from({ length: 5 }, () => `<i class="fa-regular fa-star"></i>`).join("");
  const filledStars = Array.from({ length: 5 }, () => `<i class="fa-solid fa-star"></i>`).join("");

  return `
    <span class="star-rating${sizeClass}" style="--rating-fill:${fillPercent};" aria-label="${escapeHTML(label)}">
      <span class="star-rating-base" aria-hidden="true">${baseStars}</span>
      <span class="star-rating-fill" aria-hidden="true">${filledStars}</span>
    </span>
  `;
}

function calculateCourseReviewSummary(reviews = []) {
  const validRatings = reviews
    .map((review) => clampReviewRating(review.rating))
    .filter((rating) => rating > 0);

  const count = validRatings.length;
  const sum = validRatings.reduce((total, rating) => total + rating, 0);

  return {
    count,
    avgRating: count > 0 ? sum / count : 0
  };
}

function buildCourseReviewSummaryMap(reviews = []) {
  const aggregates = new Map();

  reviews.forEach((review) => {
    const courseId = String(review?.courseId || "").trim();
    const rating = clampReviewRating(review?.rating);
    if (!courseId || rating < 1) return;

    const currentAggregate = aggregates.get(courseId) || { sum: 0, count: 0 };
    currentAggregate.sum += rating;
    currentAggregate.count += 1;
    aggregates.set(courseId, currentAggregate);
  });

  return new Map(
    [...aggregates.entries()].map(([courseId, aggregate]) => [
      courseId,
      {
        count: aggregate.count,
        avgRating: aggregate.count > 0 ? aggregate.sum / aggregate.count : 0
      }
    ])
  );
}

function getCourseReviewCardSummary(courseId) {
  const safeCourseId = String(courseId || "").trim();
  if (!safeCourseId) {
    return { count: 0, avgRating: 0 };
  }

  return courseReviewSummaryMap.get(safeCourseId) || { count: 0, avgRating: 0 };
}

async function loadCourseReviewSummaryMap(courseIds = []) {
  const safeCourseIds = [...new Set(courseIds.map((courseId) => String(courseId || "").trim()).filter(Boolean))];
  if (safeCourseIds.length === 0) {
    courseReviewSummaryMap = new Map();
    return;
  }

  try {
    const reviewsSnap = await getDocs(collection(db, "reviews"));
    const relevantReviews = reviewsSnap.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
      .filter((review) => safeCourseIds.includes(String(review.courseId || "").trim()));

    courseReviewSummaryMap = buildCourseReviewSummaryMap(relevantReviews);
  } catch (error) {
    console.warn("Failed to fetch course review summaries:", error);
    courseReviewSummaryMap = new Map();
  }
}

function buildCourseReviewBreakdown(reviews = []) {
  const buckets = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let ratingsCount = 0;
  let reviewCount = 0;

  reviews.forEach((review) => {
    const rating = normalizeReviewInputRating(review.rating);
    if (rating >= 1) {
      buckets[rating] = (buckets[rating] || 0) + 1;
      ratingsCount += 1;
    }

    if (String(review.comment || "").trim()) {
      reviewCount += 1;
    }
  });

  return {
    ratingsCount,
    reviewCount,
    buckets
  };
}

function buildReviewHeadline(review) {
  const reviewRating = normalizeReviewInputRating(review?.rating);
  const titles = {
    5: "Excellent course",
    4: "Very good session",
    3: "Good overall experience",
    2: "Needs improvement",
    1: "Poor learning experience"
  };

  return titles[reviewRating] || "Student feedback";
}

function getFilteredSortedCourseReviews(reviews = [], sortMode = "helpful") {
  const normalizedMode = String(sortMode || "helpful").trim().toLowerCase();
  let filteredReviews = [...reviews];

  if (normalizedMode === "positive") {
    filteredReviews = filteredReviews.filter((review) => clampReviewRating(review.rating) >= 4);
  } else if (normalizedMode === "negative") {
    filteredReviews = filteredReviews.filter((review) => {
      const rating = clampReviewRating(review.rating);
      return rating > 0 && rating <= 2;
    });
  }

  return filteredReviews.sort((a, b) => {
    const ratingDelta = clampReviewRating(b.rating) - clampReviewRating(a.rating);
    const timeDelta = getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt);

    if (normalizedMode === "latest") {
      if (timeDelta !== 0) return timeDelta;
      return ratingDelta;
    }

    if (normalizedMode === "positive") {
      if (ratingDelta !== 0) return ratingDelta;
      return timeDelta;
    }

    if (normalizedMode === "negative") {
      if (ratingDelta !== 0) return -ratingDelta;
      return timeDelta;
    }

    if (ratingDelta !== 0) return ratingDelta;
    return timeDelta;
  });
}

function sortCourseReviews(reviews = []) {
  return [...reviews].sort((a, b) => {
    const timeDelta = getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt);
    if (timeDelta !== 0) return timeDelta;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

function setSessionActionState(activeStateId) {
  ["stateNotBooked", "statePending", "stateApproved", "stateCompleted"].forEach((stateId) => {
    const stateEl = document.getElementById(stateId);
    if (!stateEl) return;
    stateEl.style.display = stateId === activeStateId ? "" : "none";
  });
}

function setSelectedReviewRating(rating) {
  const safeRating = Math.min(Math.max(normalizeReviewInputRating(rating), 0), 5);
  const ratingValueInput = document.getElementById("reviewRatingValue");
  const ratingCaption = document.getElementById("reviewRatingCaption");
  const labels = {
    1: "1 star selected. Needs improvement.",
    2: "2 stars selected. Fair overall.",
    3: "3 stars selected. Good experience.",
    4: "4 stars selected. Very good course.",
    5: "5 stars selected. Excellent course."
  };

  sessionPageState.reviewRating = safeRating;

  if (ratingValueInput) {
    ratingValueInput.value = safeRating > 0 ? String(safeRating) : "";
  }

  document.querySelectorAll("[data-review-star]").forEach((button) => {
    const buttonRating = Number(button.getAttribute("data-review-star")) || 0;
    button.classList.toggle("is-selected", buttonRating <= safeRating && safeRating > 0);
    button.setAttribute("aria-pressed", String(buttonRating === safeRating));
  });

  if (ratingCaption) {
    ratingCaption.textContent = safeRating > 0
      ? labels[safeRating]
      : "Select a rating to continue.";
  }
}

function applySessionEnrollmentState(course, currentUser, enrollment) {
  if (isTutorOwnCourse(course, currentUser)) {
    setSessionActionState("stateNotBooked");
    return;
  }

  const openModalBtn = document.getElementById("openModalBtn");
  const actionDesc = document.getElementById("actionDesc");
  const approvedAttendanceValue = document.getElementById("approvedAttendanceValue");
  const approvedAttendanceProgress = document.getElementById("approvedAttendanceProgress");
  const enrollmentStatus = normalizeEnrollmentStatus(enrollment?.status);

  if (!enrollmentStatus) {
    setSessionActionState("stateNotBooked");
    return;
  }

  if (enrollmentStatus === "pending") {
    setSessionActionState("statePending");
    return;
  }

  if (enrollmentStatus === "approved" || enrollmentStatus === "completed") {
    const attendanceCount = normalizeCount(enrollment?.attendanceCount);
    const totalSessions = getCourseTotalSessions(course);
    const attendancePercent = totalSessions > 0 ? Math.min((attendanceCount / totalSessions) * 100, 100) : 0;

    setSessionActionState("stateApproved");
    if (approvedAttendanceValue) {
      approvedAttendanceValue.textContent = formatAttendanceProgress(attendanceCount, totalSessions);
    }
    if (approvedAttendanceProgress) {
      approvedAttendanceProgress.style.width = `${attendancePercent}%`;
    }
    return;
  }

  if (enrollmentStatus === "rejected") {
    setSessionActionState("stateNotBooked");
    if (openModalBtn) {
      openModalBtn.disabled = true;
      openModalBtn.classList.remove("btn-primary-full");
      openModalBtn.classList.add("btn-disabled-full");
      openModalBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Request Rejected`;
      openModalBtn.dataset.action = "rejected";
      delete openModalBtn.dataset.manageHref;
    }
    if (actionDesc) {
      actionDesc.textContent = "This booking request was not approved. Contact the tutor if you need more details.";
    }
  }
}

function renderSessionReviewSection() {
  const ratingOverview = document.getElementById("courseRatingOverview");
  const averageStars = document.getElementById("courseAverageRatingStars");
  const averageValue = document.getElementById("courseAverageRatingValue");
  const averageMeta = document.getElementById("courseAverageRatingMeta");
  const reviewsSummaryBadge = document.getElementById("reviewsSummaryBadge");
  const reviewSummaryAverage = document.getElementById("reviewSummaryAverage");
  const reviewSummaryStars = document.getElementById("reviewSummaryStars");
  const reviewSummaryCountText = document.getElementById("reviewSummaryCountText");
  const reviewBreakdownList = document.getElementById("reviewBreakdownList");
  const reviewSortControls = document.getElementById("reviewSortControls");
  const reviewsList = document.getElementById("reviewsList");
  const reviewFormCard = document.getElementById("reviewFormCard");
  const reviewGateMessage = document.getElementById("reviewGateMessage");

  if (!ratingOverview || !averageStars || !averageValue || !averageMeta || !reviewsSummaryBadge || !reviewSummaryAverage || !reviewSummaryStars || !reviewSummaryCountText || !reviewBreakdownList || !reviewsList || !reviewFormCard || !reviewGateMessage) {
    return;
  }

  const { count, avgRating } = calculateCourseReviewSummary(sessionPageState.reviews);
  const breakdown = buildCourseReviewBreakdown(sessionPageState.reviews);
  const currentUserId = sessionPageState.currentUser?.uid || "";
  const currentReview = currentUserId
    ? sessionPageState.reviews.find((review) => String(review.studentId || "").trim() === currentUserId) || null
    : null;
  const enrollmentStatus = normalizeEnrollmentStatus(sessionPageState.currentEnrollment?.status);
  const isTutorView = isTutorOwnCourse(sessionPageState.course, sessionPageState.currentUser);
  const ratingsSummaryText = `${breakdown.ratingsCount} ${breakdown.ratingsCount === 1 ? "rating" : "ratings"} and ${breakdown.reviewCount} ${breakdown.reviewCount === 1 ? "review" : "reviews"}`;
  const visibleReviews = getFilteredSortedCourseReviews(sessionPageState.reviews, sessionPageState.reviewSort);
  const emptyAverageMetaText = isTutorView
    ? "Ratings from approved learners will appear here."
    : enrollmentStatus === "pending"
      ? "Reviews unlock after the tutor approves your booking."
      : enrollmentStatus === "approved"
        ? "Approved learners can share a review below."
        : "Approved learners can review this course.";
  const emptySummaryText = isTutorView
    ? "No ratings yet from enrolled learners."
    : enrollmentStatus === "approved"
      ? "No ratings yet. Approved learners can review this course below."
      : "No ratings yet. Approved learners can review this course.";

  averageStars.innerHTML = getStarRatingMarkup(avgRating, {
    size: "large",
    label: count > 0 ? `${avgRating.toFixed(1)} out of 5 stars` : "No ratings yet"
  });
  averageValue.textContent = count > 0 ? `${avgRating.toFixed(1)} / 5` : "No ratings yet";
  averageMeta.textContent = count > 0
    ? `${ratingsSummaryText} from enrolled learners.`
    : emptyAverageMetaText;
  reviewsSummaryBadge.innerHTML = count > 0
    ? `<i class="fa-solid fa-star"></i> ${escapeHTML(avgRating.toFixed(1))} average | ${breakdown.reviewCount} ${breakdown.reviewCount === 1 ? "review" : "reviews"}`
    : `<i class="fa-solid fa-star-half-stroke"></i> No ratings yet`;

  reviewSummaryAverage.textContent = count > 0 ? avgRating.toFixed(1) : "0.0";
  reviewSummaryStars.innerHTML = getStarRatingMarkup(avgRating, {
    size: "large",
    label: count > 0 ? `${avgRating.toFixed(1)} out of 5 stars` : "No ratings yet"
  });
  reviewSummaryCountText.textContent = count > 0
    ? ratingsSummaryText
    : emptySummaryText;

  reviewBreakdownList.innerHTML = [5, 4, 3, 2, 1].map((starValue) => {
    const ratingCount = breakdown.buckets[starValue] || 0;
    const fillWidth = breakdown.ratingsCount > 0 ? (ratingCount / breakdown.ratingsCount) * 100 : 0;

    return `
      <div class="review-breakdown-row">
        <span class="review-breakdown-label">${starValue} <i class="fa-solid fa-star"></i></span>
        <div class="review-breakdown-track" aria-hidden="true">
          <div class="review-breakdown-fill" style="width: ${fillWidth}%"></div>
        </div>
        <span class="review-breakdown-count">${ratingCount}</span>
      </div>
    `;
  }).join("");

  if (reviewSortControls) {
    reviewSortControls.querySelectorAll("[data-review-sort]").forEach((button) => {
      button.classList.toggle("is-active", (button.getAttribute("data-review-sort") || "") === sessionPageState.reviewSort);
    });
  }

  if (visibleReviews.length === 0) {
    const emptyText = sessionPageState.reviews.length === 0
      ? "No reviews have been shared for this course yet."
      : sessionPageState.reviewSort === "positive"
        ? "No positive reviews are available for this course yet."
        : sessionPageState.reviewSort === "negative"
          ? "No low-rating reviews are available for this course."
          : "No reviews match the selected sort right now.";
    reviewsList.innerHTML = `<div class="review-empty-card">${escapeHTML(emptyText)}</div>`;
  } else {
    reviewsList.innerHTML = visibleReviews.map((review) => {
      const reviewRating = clampReviewRating(review.rating);
      const isOwnReview = currentUserId && String(review.studentId || "").trim() === currentUserId;
      const comment = String(review.comment || "").trim();
      const reviewerName = isOwnReview
        ? "You"
        : String(review.studentName || "").trim() || "Enrolled learner";
      const reviewerMeta = isOwnReview ? "Your verified booking" : "Enrolled learner";
      const reviewHeadline = buildReviewHeadline(review);

      return `
        <article class="review-card${isOwnReview ? " is-own" : ""}">
          <div class="review-card-top">
            <div class="review-card-header">
              <div class="review-rating-line">
                <span class="review-rating-badge">${escapeHTML(reviewRating.toFixed(1))} <i class="fa-solid fa-star"></i></span>
                ${getStarRatingMarkup(reviewRating, {
                  size: "small",
                  label: `${reviewRating.toFixed(1)} out of 5 stars`
                })}
                <h3 class="review-card-title">${escapeHTML(reviewHeadline)}</h3>
              </div>
            </div>
            <span class="review-card-date">${escapeHTML(formatReviewDateLabel(review.createdAt))}</span>
          </div>
          <p class="review-comment">${escapeHTML(comment || "No written comment provided.")}</p>
          <div class="review-card-footer">
            <div class="review-card-reviewer">
              <strong>${escapeHTML(reviewerName)}</strong>
              <span>${escapeHTML(reviewerMeta)}</span>
            </div>
            <span class="review-card-verified"><i class="fa-solid fa-circle-check"></i> Verified booking | ${escapeHTML(formatRelativeTime(review.createdAt))}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  reviewFormCard.hidden = true;
  reviewGateMessage.hidden = true;
  reviewGateMessage.className = "review-notice";
  reviewGateMessage.textContent = "";

  if (!currentUserId || isTutorView) {
    return;
  }

  if (currentReview) {
    reviewGateMessage.hidden = false;
    reviewGateMessage.classList.add("success");
    reviewGateMessage.textContent = "Your review has already been submitted for this course.";
    return;
  }

  if (!sessionPageState.currentEnrollment) {
    return;
  }

  if (enrollmentStatus !== "approved") {
    reviewGateMessage.hidden = false;
    reviewGateMessage.textContent = enrollmentStatus === "pending"
      ? "Reviews unlock after the tutor approves your booking."
      : enrollmentStatus === "rejected"
        ? "This booking was rejected, so a review cannot be submitted for it."
        : "Reviews are only available for approved course bookings.";
    return;
  }

  reviewFormCard.hidden = false;
}

async function fetchCourseReviews(courseId) {
  const safeCourseId = String(courseId || "").trim();
  if (!safeCourseId) return [];

  try {
    const reviewsSnap = await getDocs(
      query(collection(db, "reviews"), where("courseId", "==", safeCourseId))
    );

    const rawReviews = reviewsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    const uniqueStudentIds = [...new Set(rawReviews.map((review) => String(review.studentId || "").trim()).filter(Boolean))];
    const userEntries = await Promise.all(
      uniqueStudentIds.map(async (studentId) => {
        try {
          const userSnap = await getDoc(doc(db, "users", studentId));
          return [studentId, userSnap.exists() ? userSnap.data() || null : null];
        } catch (error) {
          console.warn("Failed to fetch review author profile:", error);
          return [studentId, null];
        }
      })
    );
    const userMap = new Map(userEntries);

    return sortCourseReviews(
      rawReviews
        .filter((review) => {
          const authorProfile = userMap.get(String(review.studentId || "").trim());
          return Boolean(authorProfile) && !isDeletedAccountProfile(authorProfile);
        })
        .map((review) => ({
          ...review,
          studentName: resolveDisplayName(userMap.get(String(review.studentId || "").trim()), "Enrolled learner")
        }))
    );
  } catch (error) {
    console.error("Failed to fetch course reviews:", error);
    return [];
  }
}

async function fetchStudentEnrollmentForCourse(courseId, studentId) {
  const safeCourseId = String(courseId || "").trim();
  const safeStudentId = String(studentId || "").trim();
  if (!safeCourseId || !safeStudentId) return null;

  try {
    const enrollmentSnap = await getDocs(
      query(
        collection(db, "enrollments"),
        where("courseId", "==", safeCourseId),
        where("studentId", "==", safeStudentId)
      )
    );

    if (enrollmentSnap.empty) {
      return null;
    }

    const enrollments = enrollmentSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    enrollments.sort((a, b) => {
      const timeDelta = getTimestampValue(b.reviewedAt, b.updatedAt, b.enrolledAt) - getTimestampValue(a.reviewedAt, a.updatedAt, a.enrolledAt);
      if (timeDelta !== 0) return timeDelta;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });

    return enrollments[0] || null;
  } catch (error) {
    console.error("Failed to fetch learner enrollment:", error);
    return null;
  }
}

async function handleSessionReviewSubmit(event) {
  event.preventDefault();

  if (sessionPageState.reviewSubmitting) return;

  const currentUser = sessionPageState.currentUser || auth.currentUser || await waitForInitialAuthState();
  const courseId = String(sessionPageState.courseId || "").trim();
  const reviewComment = document.getElementById("reviewComment");
  const submitReviewBtn = document.getElementById("submitReviewBtn");
  const ratingValueInput = document.getElementById("reviewRatingValue");
  const rating = normalizeReviewInputRating(ratingValueInput?.value || sessionPageState.reviewRating);
  const comment = String(reviewComment?.value || "").trim();

  if (!currentUser) {
    alert("You must be logged in to leave a review.");
    return;
  }

  if (!courseId) {
    alert("Course identification failed.");
    return;
  }

  if (rating < 1) {
    alert("Please select a star rating before submitting.");
    return;
  }

  if (!comment) {
    alert("Please add a short comment before submitting your review.");
    return;
  }

  const latestEnrollment = await fetchStudentEnrollmentForCourse(courseId, currentUser.uid);
  sessionPageState.currentUser = currentUser;
  sessionPageState.currentEnrollment = latestEnrollment;

  if (!latestEnrollment || normalizeEnrollmentStatus(latestEnrollment.status) !== "approved") {
    renderSessionReviewSection();
    alert("Only approved students can submit a review for this course.");
    return;
  }

  const reviewId = buildReviewDocId(courseId, currentUser.uid);
  if (!reviewId) {
    alert("Review submission failed.");
    return;
  }

  const originalButtonHTML = submitReviewBtn ? submitReviewBtn.innerHTML : "";

  try {
    sessionPageState.reviewSubmitting = true;
    if (submitReviewBtn) {
      submitReviewBtn.disabled = true;
      submitReviewBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...`;
    }

    await runTransaction(db, async (transaction) => {
      const reviewRef = doc(db, "reviews", reviewId);
      const reviewSnap = await transaction.get(reviewRef);

      if (reviewSnap.exists()) {
        throw new Error("You have already submitted a review for this course.");
      }

      transaction.set(reviewRef, {
        courseId,
        studentId: currentUser.uid,
        rating,
        comment,
        createdAt: new Date().toISOString()
      });
    });

    if (reviewComment) {
      reviewComment.value = "";
    }
    setSelectedReviewRating(0);

    sessionPageState.reviews = await fetchCourseReviews(courseId);
    renderSessionReviewSection();
    alert("Review submitted successfully.");
  } catch (error) {
    console.error("Failed to submit review:", error);
    alert(error?.message || "Could not submit your review right now.");
  } finally {
    sessionPageState.reviewSubmitting = false;
    if (submitReviewBtn) {
      submitReviewBtn.disabled = false;
      submitReviewBtn.innerHTML = originalButtonHTML;
    }
  }
}

function bindSessionReviewEvents() {
  if (sessionPageState.reviewEventsBound) return;

  const reviewStarInput = document.getElementById("reviewStarInput");
  const reviewFormCard = document.getElementById("reviewFormCard");
  const reviewSortControls = document.getElementById("reviewSortControls");
  if (!reviewStarInput || !reviewFormCard) return;

  reviewStarInput.addEventListener("click", (event) => {
    const starButton = event.target.closest("[data-review-star]");
    if (!starButton) return;

    setSelectedReviewRating(starButton.getAttribute("data-review-star"));
  });

  if (reviewSortControls) {
    reviewSortControls.addEventListener("click", (event) => {
      const sortButton = event.target.closest("[data-review-sort]");
      if (!sortButton) return;

      const nextSort = String(sortButton.getAttribute("data-review-sort") || "helpful").trim().toLowerCase();
      if (!nextSort || sessionPageState.reviewSort === nextSort) return;

      sessionPageState.reviewSort = nextSort;
      renderSessionReviewSection();
    });
  }

  reviewFormCard.addEventListener("submit", handleSessionReviewSubmit);
  sessionPageState.reviewEventsBound = true;
}

function buildChatHref(targetUserId, currentUserId = "") {
  const safeTargetUserId = String(targetUserId || "").trim();
  const safeCurrentUserId = String(currentUserId || "").trim();

  if (!safeTargetUserId || (safeCurrentUserId && safeTargetUserId === safeCurrentUserId)) {
    return "";
  }

  return `../chat.html?uid=${encodeURIComponent(safeTargetUserId)}`;
}

function getInitials(name) {
  const safeName = String(name || "User").trim();
  if (!safeName) return "U";

  const tokens = safeName.split(/\s+/).filter(Boolean);
  return tokens.slice(0, 2).map((token) => token.charAt(0).toUpperCase()).join("") || safeName.charAt(0).toUpperCase();
}

function normalizeApplicantStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized) ? normalized : "pending";
}

function formatApplicantStatus(status) {
  const normalized = normalizeApplicantStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getNormalizedCourseStatus(course) {
  const explicitStatus = String(course?.status || "open").trim().toLowerCase();
  const seatsFilled = Math.max(Number(course?.seatsFilled) || 0, 0);
  const totalSeats = Math.max(Number(course?.totalSeats) || 0, 0);

  if (explicitStatus === "closed") return "closed";
  if (explicitStatus === "draft") return "draft";
  if (totalSeats > 0 && seatsFilled >= totalSeats) return "closed";
  return "open";
}

function formatCourseStatus(status) {
  const normalized = String(status || "open").trim().toLowerCase();
  if (normalized === "closed") return "Closed";
  if (normalized === "draft") return "Draft";
  return "Open";
}

function isCourseCertified(course) {
  const rawValue = course?.isCertified;
  if (rawValue === true || rawValue === false) {
    return rawValue;
  }

  return String(rawValue || "").trim().toLowerCase() === "true";
}

function isCourseFeatured(course) {
  const rawValue = course?.isFeatured;
  if (rawValue === true || rawValue === false) {
    return rawValue;
  }

  return String(rawValue || "").trim().toLowerCase() === "true";
}

function isCourseOpenForApplicants(course) {
  return getNormalizedCourseStatus(course) === "open";
}

function isCourseFull(course) {
  const seatsFilled = Math.max(Number(course?.seatsFilled) || 0, 0);
  const totalSeats = Math.max(Number(course?.totalSeats) || 0, 0);
  return totalSeats > 0 && seatsFilled >= totalSeats;
}

function isTutorOwnCourse(course, user) {
  const currentUserId = typeof user === "string" ? user : user?.uid;
  return Boolean(currentUserId && course?.tutorId && course.tutorId === currentUserId);
}

function sortManagedCourses(courses) {
  return [...courses].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
    const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

async function countReservedSeatsForCourse(courseId, tutorId = "") {
  if (!courseId) return 0;

  const enrollmentsSnap = await getDocs(
    query(collection(db, "enrollments"), where("courseId", "==", courseId))
  );

  let reservedSeats = 0;
  enrollmentsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const studentId = String(data.studentId || "").trim();
    const status = normalizeApplicantStatus(data.status);

    if (!studentId) return;
    if (tutorId && studentId === tutorId) return;
    if (status === "rejected") return;

    reservedSeats += 1;
  });

  return reservedSeats;
}

async function reconcileCourseSeatUsage(course) {
  if (!course?.id) return course;

  const reservedSeats = await countReservedSeatsForCourse(course.id, course.tutorId || "");
  const currentSeatsFilled = Math.max(Number(course.seatsFilled) || 0, 0);
  if (reservedSeats === currentSeatsFilled) {
    return course;
  }

  const updatedCourse = {
    ...course,
    seatsFilled: reservedSeats
  };

  try {
    await updateDoc(doc(db, "courses", course.id), {
      seatsFilled: reservedSeats
    });
  } catch (error) {
    console.error("Failed to reconcile course seat usage:", error);
  }

  return updatedCourse;
}

async function reconcileManagedCoursesSeatUsage(courses) {
  const reconciledCourses = await Promise.all(
    courses.map((course) => reconcileCourseSeatUsage(course))
  );

  return sortManagedCourses(reconciledCourses);
}

function syncManagedCourseCollection(course) {
  const courseIndex = manageDashboardState.courses.findIndex((entry) => entry.id === course.id);
  if (courseIndex === -1) return;

  manageDashboardState.courses[courseIndex] = course;
}

function updateManagedCourseLocation(courseId) {
  if (!courseId) return;

  localStorage.setItem("selectedCourse", courseId);

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("id", courseId);
  window.history.replaceState({}, "", nextUrl);
}

function getMyLearningRoot() {
  return document.getElementById("myLearningRoot");
}

function normalizeLearningStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  if (normalized === "approved" || normalized === "active") return "active";
  if (normalized === "completed") return "completed";
  if (normalized === "rejected") return "rejected";
  return "pending";
}

function formatLearningStatusLabel(status) {
  const normalized = normalizeLearningStatus(status);
  if (normalized === "active") return "Approved";
  if (normalized === "completed") return "Completed";
  if (normalized === "rejected") return "Rejected";
  return "Pending";
}

function getLearningEmptyMessage(status) {
  const normalized = normalizeLearningStatus(status);
  if (normalized === "active") return "No active courses yet.";
  if (normalized === "completed") return "No completed courses yet.";
  if (normalized === "rejected") return "No rejected enrollments.";
  return "No pending requests right now.";
}

function sortLearningEntries(entries) {
  const order = { active: 0, pending: 1, completed: 2, rejected: 3 };
  return [...entries].sort((a, b) => {
    const statusDelta = (order[a.learningStatus] ?? 99) - (order[b.learningStatus] ?? 99);
    if (statusDelta !== 0) return statusDelta;

    const dateA = new Date(a.enrolledAt || 0).getTime() || 0;
    const dateB = new Date(b.enrolledAt || 0).getTime() || 0;
    if (dateA !== dateB) return dateB - dateA;

    return String(a.courseTitle || "").localeCompare(String(b.courseTitle || ""));
  });
}

function getLearningCounts() {
  return myLearningState.entries.reduce((counts, entry) => {
    const status = normalizeLearningStatus(entry.learningStatus);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {
    active: 0,
    pending: 0,
    completed: 0,
    rejected: 0
  });
}

function chooseDefaultLearningTab(entries = myLearningState.entries) {
  const availableStatuses = ["active", "pending", "completed", "rejected"];
  return availableStatuses.find((status) => entries.some((entry) => entry.learningStatus === status)) || "active";
}

function setMyLearningShellState(type, title, message) {
  const root = getMyLearningRoot();
  if (!root) return;

  const stateCard = document.getElementById("myLearningStateCard");
  const stateIcon = document.getElementById("myLearningStateIcon");
  const stateTitle = document.getElementById("myLearningStateTitle");
  const stateText = document.getElementById("myLearningStateText");
  const tabs = document.getElementById("myLearningTabs");
  const list = document.getElementById("myLearningList");

  root.dataset.shellState = type;

  if (stateTitle) stateTitle.textContent = title;
  if (stateText) stateText.textContent = message;

  if (stateIcon) {
    stateIcon.className = type === "error" ? "learning-state-icon error" : "learning-state-icon";
    stateIcon.innerHTML = type === "loading"
      ? `<i class="fa-solid fa-circle-notch fa-spin"></i>`
      : type === "empty"
        ? `<i class="fa-solid fa-book-open-reader"></i>`
        : `<i class="fa-solid fa-circle-exclamation"></i>`;
  }

  const isReady = type === "ready";
  if (stateCard) stateCard.hidden = isReady;
  if (tabs) tabs.hidden = !isReady;
  if (list) list.hidden = !isReady;

  if (!isReady && list) {
    list.innerHTML = "";
  }
}

function updateMyLearningTabs() {
  const root = getMyLearningRoot();
  if (!root) return;

  const counts = getLearningCounts();
  const tabButtons = root.querySelectorAll("[data-learning-tab]");
  tabButtons.forEach((button) => {
    const tabName = button.dataset.learningTab || "active";
    button.classList.toggle("is-active", tabName === myLearningState.tab);
  });

  root.querySelectorAll("[data-learning-count]").forEach((element) => {
    const tabName = element.dataset.learningCount || "active";
    element.textContent = String(counts[tabName] || 0);
  });
}

function renderMyLearningCards() {
  const list = document.getElementById("myLearningList");
  if (!list) return;

  const currentTab = normalizeLearningStatus(myLearningState.tab);
  const visibleEntries = myLearningState.entries.filter((entry) => entry.learningStatus === currentTab);

  if (visibleEntries.length === 0) {
    list.innerHTML = `<div class="learning-empty-card">${escapeHTML(getLearningEmptyMessage(currentTab))}</div>`;
    return;
  }

  list.innerHTML = visibleEntries.map((entry) => {
    const statusLabel = formatLearningStatusLabel(entry.learningStatus);
    const showAttendance = entry.learningStatus === "active" || entry.learningStatus === "completed";
    const attendanceLabel = showAttendance
      ? formatAttendanceProgress(entry.attendanceCount, entry.totalSessions)
      : "";
    const chatHref = buildChatHref(entry.tutorId, myLearningState.currentUserId);

    return `
      <article class="learning-card" data-learning-course-id="${escapeHTML(entry.courseId)}" tabindex="0" role="link" aria-label="Open ${escapeHTML(entry.courseTitle || "course")}">
        <div class="learning-card-top">
          <div>
            <h3 class="learning-card-title">${escapeHTML(entry.courseTitle || "Course unavailable")}</h3>
            <p class="learning-card-subtitle">Tutor ID: ${escapeHTML(entry.tutorDisplayId || "Unavailable")}</p>
            ${entry.isCertified ? `
              <div class="learning-course-badges">
                <span class="learning-course-badge certificate"><i class="fa-solid fa-award"></i> Certificate Available</span>
              </div>
            ` : ""}
          </div>
          <span class="learning-status-badge ${escapeHTML(entry.learningStatus)}">${escapeHTML(statusLabel)}</span>
        </div>
        <div class="learning-card-details">
          <div class="learning-detail-item">
            <span>Enrolled</span>
            <strong>${escapeHTML(formatDateLabel(entry.enrolledAt))}</strong>
          </div>
          <div class="learning-detail-item">
            <span>Starts</span>
            <strong>${escapeHTML(formatCourseStartDateLabel(entry.startDate))}</strong>
          </div>
          ${showAttendance ? `
            <div class="learning-detail-item">
              <span>Student ID</span>
              <strong>${escapeHTML(entry.studentDisplayId || "Pending")}</strong>
            </div>
            <div class="learning-detail-item">
              <span>Attendance</span>
              <strong>${escapeHTML(attendanceLabel)}</strong>
            </div>
          ` : ""}
        </div>
        ${chatHref ? `
          <div class="learning-card-actions">
            <a href="${escapeHTML(chatHref)}" class="learning-chat-btn">Contact Tutor</a>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

function bindMyLearningEvents() {
  const root = getMyLearningRoot();
  if (!root || root.__myLearningEventsBound === true) return;

  root.__myLearningEventsBound = true;

  root.addEventListener("click", (event) => {
    const tabBtn = event.target.closest("[data-learning-tab]");
    if (!tabBtn) return;

    myLearningState.tab = normalizeLearningStatus(tabBtn.dataset.learningTab || "active");
    updateMyLearningTabs();
    renderMyLearningCards();
  });

  root.addEventListener("click", (event) => {
    if (event.target.closest(".learning-chat-btn")) return;

    const courseCard = event.target.closest("[data-learning-course-id]");
    if (!courseCard) return;

    openCourseSession(courseCard.dataset.learningCourseId);
  });

  root.addEventListener("keydown", (event) => {
    const courseCard = event.target.matches("[data-learning-course-id]") ? event.target : null;
    if (!courseCard || !["Enter", " "].includes(event.key)) return;

    event.preventDefault();
    openCourseSession(courseCard.dataset.learningCourseId);
  });
}

async function fetchCoursesByIds(courseIds) {
  const uniqueCourseIds = [...new Set(courseIds.filter(Boolean))];
  const courseEntries = await Promise.all(
    uniqueCourseIds.map(async (courseId) => {
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        return [courseId, courseSnap.exists() ? { id: courseSnap.id, ...courseSnap.data() } : null];
      } catch (error) {
        console.error("Failed to fetch enrolled course:", error);
        return [courseId, null];
      }
    })
  );

  return new Map(courseEntries);
}

async function loadMyLearningPage() {
  const root = getMyLearningRoot();
  if (!root) return;

  bindMyLearningEvents();
  setMyLearningShellState("loading", "Loading your courses", "Fetching your enrolled tutoring courses and attendance progress.");

  try {
    const user = auth.currentUser || await waitForInitialAuthState();
    if (!user) {
      setMyLearningShellState("error", "Login required", "Sign in to view the courses you have enrolled in.");
      return;
    }

    myLearningState.currentUserId = user.uid;

    const enrollmentsSnap = await getDocs(
      query(collection(db, "enrollments"), where("studentId", "==", user.uid))
    );

    if (enrollmentsSnap.empty) {
      myLearningState.entries = [];
      setMyLearningShellState("empty", "No courses yet", "You haven't enrolled in any courses yet.");
      return;
    }

    const rawEnrollments = enrollmentsSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    const courseMap = await fetchCoursesByIds(rawEnrollments.map((entry) => entry.courseId));

    const entries = rawEnrollments
      .map((enrollment) => {
        const course = courseMap.get(enrollment.courseId) || null;
        if (!course) {
          return null;
        }
        if (course?.tutorId && course.tutorId === user.uid) {
          return null;
        }

        const learningStatus = normalizeLearningStatus(enrollment.status);
        return {
          id: enrollment.id,
          courseId: enrollment.courseId || "",
          learningStatus,
          studentDisplayId: enrollment.studentDisplayId || enrollment.courseStudentId || "",
          attendanceCount: normalizeCount(enrollment.attendanceCount),
          enrolledAt: enrollment.enrolledAt || "",
          startDate: course.startDate || "",
          courseTitle: course.title || "Course unavailable",
          tutorDisplayId: course.tutorDisplayId || "Unavailable",
          tutorId: course.tutorId || "",
          totalSessions: getCourseTotalSessions(course),
          isCertified: isCourseCertified(course)
        };
      })
      .filter(Boolean);

    if (entries.length === 0) {
      myLearningState.entries = [];
      setMyLearningShellState("empty", "No courses yet", "You haven't enrolled in any valid tutoring courses yet.");
      return;
    }

    myLearningState.entries = sortLearningEntries(entries);
    myLearningState.tab = chooseDefaultLearningTab(entries);
    updateMyLearningTabs();
    renderMyLearningCards();
    setMyLearningShellState("ready", "", "");
  } catch (error) {
    console.error("Failed to load My Learning page:", error);
    setMyLearningShellState("error", "Unable to load courses", "Something went wrong while fetching your tutoring enrollments. Please try again.");
  }
}

function formatStudentDisplayId(sequence) {
  const normalizedSequence = Math.max(Number(sequence) || 0, 0);
  return `ST-${String(normalizedSequence).padStart(3, "0")}`;
}

function extractStudentDisplaySequence(value) {
  const match = String(value || "").trim().match(/(\d+)$/);
  if (!match) return 0;

  return Math.max(parseInt(match[1], 10) || 0, 0);
}

function compareApplicantEnrollmentOrder(a, b) {
  const dateA = new Date(a.enrolledAt || 0).getTime() || 0;
  const dateB = new Date(b.enrolledAt || 0).getTime() || 0;

  if (dateA !== dateB) {
    return dateA - dateB;
  }

  return String(a.id || "").localeCompare(String(b.id || ""));
}

async function getNextStudentDisplayId(courseId) {
  if (!courseId) {
    throw new Error("Course not found.");
  }

  const enrollmentsSnap = await getDocs(
    query(collection(db, "enrollments"), where("courseId", "==", courseId))
  );
  const enrollmentCount = enrollmentsSnap.size;
  const highestAssignedSequence = enrollmentsSnap.docs.reduce((highest, docSnap) => {
    const data = docSnap.data() || {};
    const assignedSequence = extractStudentDisplaySequence(data.studentDisplayId || data.courseStudentId);
    return Math.max(highest, assignedSequence);
  }, 0);
  const courseRef = doc(db, "courses", courseId);

  return runTransaction(db, async (transaction) => {
    const courseSnap = await transaction.get(courseRef);
    if (!courseSnap.exists()) {
      throw new Error("Course not found.");
    }

    const courseData = courseSnap.data() || {};
    const currentSequence = Math.max(Number(courseData.studentSequence) || 0, enrollmentCount, highestAssignedSequence);
    const nextSequence = currentSequence + 1;

    transaction.update(courseRef, {
      studentSequence: nextSequence
    });

    return {
      sequence: nextSequence,
      studentDisplayId: formatStudentDisplayId(nextSequence)
    };
  });
}

async function ensureStudentDisplayIds(courseId, applicants) {
  if (!courseId || !Array.isArray(applicants) || applicants.length === 0) {
    return applicants;
  }

  const orderedApplicants = [...applicants].sort(compareApplicantEnrollmentOrder);
  const usedSequences = new Set();

  orderedApplicants.forEach((applicant) => {
    const assignedSequence = extractStudentDisplaySequence(applicant.studentDisplayId);
    if (assignedSequence > 0) {
      usedSequences.add(assignedSequence);
    }
  });

  let nextSequence = 1;
  const updates = [];
  const normalizedApplicants = orderedApplicants.map((applicant) => {
    if (applicant.studentDisplayId) {
      return applicant;
    }

    while (usedSequences.has(nextSequence)) {
      nextSequence += 1;
    }

    const recoveredId = formatStudentDisplayId(nextSequence);
    usedSequences.add(nextSequence);
    nextSequence += 1;

    updates.push(
      updateDoc(doc(db, "enrollments", applicant.id), {
        studentDisplayId: recoveredId
      }).catch((error) => {
        console.error("Failed to backfill student display ID:", error);
      })
    );

    return {
      ...applicant,
      studentDisplayId: recoveredId
    };
  });

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return applicants.map((applicant) => (
    normalizedApplicants.find((entry) => entry.id === applicant.id) || applicant
  ));
}

const searchInput = document.getElementById("courseSearchInput");
const statusFilter = document.getElementById("statusFilter");
const priceFilter = document.getElementById("priceFilter");
const sortFilter = document.getElementById("sortFilter");
const courseGrid = document.getElementById("courseGrid");
const featuredCourseSection = document.getElementById("featuredCoursesSection");
const featuredCourseGrid = document.getElementById("featuredCourseGrid");
const recommendedCourseSection = document.getElementById("recommendedCoursesSection");
const recommendedCourseGrid = document.getElementById("recommendedCourseGrid");

const getStatusColor = (status) => {
  if (status.toLowerCase() === "open") return "linear-gradient(135deg, #10b981, #0ea5e9)";
  if (status.toLowerCase() === "closed") return "linear-gradient(135deg, #ef4444, #7f1d1d)";
  if (status.toLowerCase() === "draft") return "linear-gradient(135deg, #f59e0b, #d97706)";
  return "linear-gradient(135deg, #6366f1, #3b82f6)";
};

function compareCoursesForRecommendation(a, b) {
  const seatDelta = normalizeCount(b?.seatsFilled) - normalizeCount(a?.seatsFilled);
  if (seatDelta !== 0) return seatDelta;

  const timeDelta = getTimestampValue(b?.createdAt, b?.updatedAt) - getTimestampValue(a?.createdAt, a?.updatedAt);
  if (timeDelta !== 0) return timeDelta;

  return String(a?.title || "").localeCompare(String(b?.title || ""));
}

function getFeaturedCourses(courses, currentUser, limit = 2) {
  const safeLimit = Math.max(Number(limit) || 0, 0);
  if (safeLimit === 0) return [];

  const visibleFeaturedCourses = courses.filter((course) => (
    course?.id
    && isCourseFeatured(course)
    && getNormalizedCourseStatus(course) !== "draft"
  ));
  const openFeaturedCourses = visibleFeaturedCourses.filter((course) => isCourseOpenForApplicants(course));
  const sourceCourses = openFeaturedCourses.length > 0 ? openFeaturedCourses : visibleFeaturedCourses;

  return [...sourceCourses]
    .sort(compareCoursesForRecommendation)
    .slice(0, safeLimit);
}

function getRecommendedCourses(courses, currentUser, limit = 3) {
  const safeLimit = Math.max(Number(limit) || 0, 0);
  if (safeLimit === 0) return [];

  const visibleCourses = courses.filter((course) => course?.id && !isTutorOwnCourse(course, currentUser) && !isCourseFeatured(course));
  const openCourses = visibleCourses.filter((course) => isCourseOpenForApplicants(course));
  const sourceCourses = openCourses.length > 0 ? openCourses : visibleCourses;

  return [...sourceCourses]
    .sort(compareCoursesForRecommendation)
    .slice(0, safeLimit);
}

function getCourseCardMarkup(course, currentUser, options = {}) {
  const highlightFeatured = options.highlightFeatured === true;
  const statusToken = getNormalizedCourseStatus(course);
  const statusText = formatCourseStatus(statusToken).toUpperCase();
  const bgStyle = getStatusColor(statusToken);
  const safeImage = escapeHTML(getCourseImageUrl(course));
  const seatsFilled = Number(course.seatsFilled) || 0;
  const totalSeats = Number(course.totalSeats) || 0;
  const startDateLabel = formatCourseStartDateLabel(course.startDate);
  const certified = isCourseCertified(course);
  const isOwnCourse = isTutorOwnCourse(course, currentUser);
  const canBook = isCourseOpenForApplicants(course) && !isOwnCourse;
  const freeCourse = isFreeCourse(course);
  const { count: ratingCount, avgRating } = getCourseReviewCardSummary(course.id);
  const bookLabel = isOwnCourse ? "Manage Course" : canBook ? (freeCourse ? "Join Free" : "Book Seat") : "Closed";
  const bookDisabledAttr = !canBook && !isOwnCourse ? "disabled" : "";
  const bookIcon = isOwnCourse
    ? "fa-list-check"
    : canBook
      ? freeCourse
        ? "fa-gift"
        : "fa-bolt"
      : "fa-lock";

  return `
    <a href="#" class="course-card${highlightFeatured ? " is-featured-card" : ""}${freeCourse ? " is-free-card" : ""}" data-id="${escapeHTML(course.id)}">
      <div class="card-banner" style="background: ${bgStyle};">
        ${safeImage ? `<img class="course-banner-image" src="${safeImage}" alt="${escapeHTML(course.title || "Course banner")}" loading="lazy">` : ""}
        ${certified ? `<span class="course-certified-badge"><i class="fa-solid fa-award"></i> Certified</span>` : ""}
        <span class="status-badge">${escapeHTML(statusText)}</span>
        ${highlightFeatured ? `<span class="course-featured-badge"><i class="fa-solid fa-star"></i> Featured</span>` : ""}
        ${freeCourse ? `<span class="course-free-badge"><i class="fa-solid fa-gift"></i> Free</span>` : ""}
      </div>
      <div class="card-content">
        <h3 class="course-title">${escapeHTML(course.title || "Untitled Course")}</h3>
        <p class="course-desc">${escapeHTML(course.description || "No description available.")}</p>
        <div class="course-rating-row${ratingCount === 0 ? " is-empty" : ""}">
          <div class="course-rating-inline">
            ${getStarRatingMarkup(avgRating, {
              size: "small",
              label: ratingCount > 0 ? `${avgRating.toFixed(1)} out of 5 stars` : "No ratings yet"
            })}
            <span class="course-rating-score">${escapeHTML(ratingCount > 0 ? avgRating.toFixed(1) : "0.0")}</span>
          </div>
          <span class="course-rating-meta">${escapeHTML(ratingCount > 0 ? `${ratingCount} ${ratingCount === 1 ? "rating" : "ratings"}` : "No ratings yet")}</span>
        </div>
        <div class="card-info-row">
          <span class="tutor-id"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHTML(course.tutorDisplayId || "Tutor ID unavailable")}</span>
          <span class="price${freeCourse ? " is-free" : ""}">${escapeHTML(formatCoursePrice(course.price))}</span>
        </div>
        <div class="card-bottom">
          <span class="seats-info"><i class="fa-solid fa-users"></i> ${seatsFilled} / ${totalSeats} seats filled</span>
          <span class="session-info"><i class="fa-regular fa-calendar"></i> ${escapeHTML(startDateLabel)}</span>
        </div>
        <div class="card-actions">
          <button class="btn-book${isOwnCourse ? " btn-manage-course" : ""}" ${bookDisabledAttr}><i class="fa-solid ${bookIcon}"></i> ${bookLabel}</button>
          ${isOwnCourse ? "" : `<button class="btn-chat"><i class="fa-solid fa-comment-dots"></i></button>`}
        </div>
      </div>
    </a>
  `;
}

function renderFeaturedCourses(currentUser) {
  if (!featuredCourseSection || !featuredCourseGrid) return;

  const featuredCourses = getFeaturedCourses(allCoursesData, currentUser, 2);
  if (featuredCourses.length === 0) {
    featuredCourseSection.hidden = true;
    featuredCourseGrid.innerHTML = "";
    return;
  }

  featuredCourseSection.hidden = false;
  featuredCourseGrid.innerHTML = featuredCourses
    .map((course) => getCourseCardMarkup(course, currentUser, { highlightFeatured: true }))
    .join("");
  setupCards(featuredCourseGrid);
}

function renderRecommendedCourses(currentUser) {
  if (!recommendedCourseSection || !recommendedCourseGrid) return;

  const recommendedCourses = getRecommendedCourses(allCoursesData, currentUser, 3);
  if (recommendedCourses.length === 0) {
    recommendedCourseSection.hidden = true;
    recommendedCourseGrid.innerHTML = "";
    return;
  }

  recommendedCourseSection.hidden = false;
  recommendedCourseGrid.innerHTML = recommendedCourses
    .map((course) => getCourseCardMarkup(course, currentUser))
    .join("");
  setupCards(recommendedCourseGrid);
}

function renderTutorQrPreview(imageEl, labelEl, qrCode) {
  const normalizedQrCode = String(qrCode || "").trim();

  if (imageEl) {
    if (normalizedQrCode) {
      imageEl.src = normalizedQrCode;
      imageEl.hidden = false;
    } else {
      imageEl.hidden = true;
      imageEl.removeAttribute("src");
    }
  }

  if (labelEl) {
    labelEl.textContent = normalizedQrCode
      ? "Scan and pay"
      : "Tutor QR code will appear when available.";
  }
}

function resetPaymentProofUploadState(defaultText = "Click or drag to upload screenshot") {
  const proofUpload = document.getElementById("proofUpload");
  const proofUploadText = document.getElementById("proofUploadText");

  if (proofUpload) {
    proofUpload.value = "";
  }

  if (proofUploadText) {
    proofUploadText.textContent = defaultText;
    proofUploadText.style.removeProperty("color");
  }
}

function configureBookingModalForCourse(course) {
  const modalTitle = document.getElementById("paymentModalTitle");
  const modalDesc = document.getElementById("paymentModalDesc");
  const qrContainer = document.getElementById("paymentQrContainer");
  const tutorQrImage = document.getElementById("tutorQrImage");
  const tutorQrLabel = document.getElementById("tutorQrLabel");
  const paymentProofField = document.getElementById("paymentProofField");
  const submitProofBtn = document.getElementById("submitProofBtn");
  const freeCourse = isFreeCourse(course);

  if (modalTitle) {
    modalTitle.textContent = freeCourse ? "Join Free Course" : "Complete Your Booking";
  }

  if (modalDesc) {
    modalDesc.textContent = freeCourse
      ? "This course is free. No payment or QR scan is required. Submit your request to join and wait for tutor approval."
      : "Please scan the tutor's QR code to pay the course fee. Then, upload your payment screenshot to verify enrollment.";
  }

  if (paymentProofField) {
    paymentProofField.hidden = freeCourse;
  }

  if (qrContainer) {
    qrContainer.hidden = freeCourse;
  }

  if (submitProofBtn) {
    submitProofBtn.innerHTML = freeCourse
      ? `<i class="fa-solid fa-gift"></i> Join Free Course`
      : "Submit Payment Proof";
  }

  resetPaymentProofUploadState(
    freeCourse
      ? "No payment proof needed for this free course."
      : "Click or drag to upload screenshot"
  );

  if (freeCourse) {
    if (tutorQrImage) {
      tutorQrImage.hidden = true;
      tutorQrImage.removeAttribute("src");
    }
    if (tutorQrLabel) {
      tutorQrLabel.textContent = "No payment required for this free course.";
    }
    return;
  }

  renderTutorQrPreview(tutorQrImage, tutorQrLabel, course?.qrCode);
}

function clearManagedObjectUrl(imageEl) {
  if (!imageEl || !imageEl.dataset.objectUrl) return;

  URL.revokeObjectURL(imageEl.dataset.objectUrl);
  delete imageEl.dataset.objectUrl;
}

function setManagedAssetPreview(imageEl, emptyEl, textEl, src, text, options = {}) {
  const isObjectUrl = options.isObjectUrl === true;
  const uploadCard = imageEl?.closest(".media-upload-card")
    || emptyEl?.closest(".media-upload-card")
    || textEl?.closest(".media-upload-card");
  if (imageEl) {
    clearManagedObjectUrl(imageEl);

    if (src) {
      imageEl.src = src;
      imageEl.hidden = false;
      if (emptyEl) emptyEl.hidden = true;
      if (isObjectUrl) {
        imageEl.dataset.objectUrl = src;
      }
    } else {
      imageEl.hidden = true;
      imageEl.removeAttribute("src");
      if (emptyEl) emptyEl.hidden = false;
    }
  }

  if (uploadCard) {
    uploadCard.classList.toggle("is-filled", Boolean(src));
  }

  if (textEl) {
    textEl.textContent = text;
  }
}

function refreshManagedAssetInputPreview(config) {
  const {
    inputId,
    imageId,
    emptyId,
    textId,
    currentValue,
    loadedText,
    emptyText,
    removed = false,
    removedText = emptyText
  } = config;

  const inputEl = document.getElementById(inputId);
  const imageEl = document.getElementById(imageId);
  const emptyEl = document.getElementById(emptyId);
  const textEl = document.getElementById(textId);
  const selectedFile = inputEl && inputEl.files ? inputEl.files[0] : null;
  const uploadCard = imageEl?.closest(".media-upload-card")
    || emptyEl?.closest(".media-upload-card")
    || textEl?.closest(".media-upload-card");

  if (uploadCard) {
    uploadCard.classList.toggle("is-pending-removal", removed);
  }

  if (removed) {
    if (inputEl) inputEl.value = "";
    setManagedAssetPreview(imageEl, emptyEl, textEl, "", removedText);
    return;
  }

  if (selectedFile) {
    const objectUrl = URL.createObjectURL(selectedFile);
    setManagedAssetPreview(imageEl, emptyEl, textEl, objectUrl, `Selected: ${selectedFile.name}`, { isObjectUrl: true });
    return;
  }

  setManagedAssetPreview(
    imageEl,
    emptyEl,
    textEl,
    currentValue,
    currentValue ? loadedText : emptyText
  );
}

function populateManagedAssetInputs(course) {
  if (!course) return;

  const qrInput = document.getElementById("manageQrCodeUpload");
  const imageInput = document.getElementById("manageCourseImageUpload");
  if (qrInput) qrInput.value = "";
  if (imageInput) imageInput.value = "";

  refreshManagedAssetInputPreview({
    inputId: "manageQrCodeUpload",
    imageId: "manageQrCodePreview",
    emptyId: "manageQrCodeEmpty",
    textId: "manageQrCodeUploadText",
    currentValue: course.qrCode || "",
    loadedText: "Current QR code loaded. Click to replace it.",
    emptyText: "Click to upload a payment QR code"
  });

  refreshManagedAssetInputPreview({
    inputId: "manageCourseImageUpload",
    imageId: "manageCourseImagePreview",
    emptyId: "manageCourseImageEmpty",
    textId: "manageCourseImageUploadText",
    currentValue: getCourseImageUrl(course),
    loadedText: "Current course image loaded. Click to replace it.",
    emptyText: "Click to upload a course image"
  });

  updateManageAssetActionButton("qrCode");
  updateManageAssetActionButton("image");
}

async function uploadCourseAsset(file, folder, courseId, options = {}) {
  if (!file) return "";

  const uploadFile = options.optimizeImage
    ? await optimizeImageFileForUpload(file, {
      maxWidth: options.maxWidth || 1800,
      maxHeight: options.maxHeight || 1800,
      quality: options.quality || 0.82
    })
    : file;
  const safeName = String(uploadFile.name || file.name || "asset").replace(/\s+/g, "_");
  const storageRefPath = ref(storage, `${folder}/${courseId || "course"}_${Date.now()}_${safeName}`);
  const uploadSnapshot = await uploadBytes(storageRefPath, uploadFile);
  return getDownloadURL(uploadSnapshot.ref);
}

async function getOrCreateTutorDisplayId(user) {
  const userDocRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userDocRef);
  const existingDisplayId = String(userSnap.data()?.tutorDisplayId || "").trim();

  if (existingDisplayId) {
    return existingDisplayId;
  }

  const randomId = Math.floor(1000 + Math.random() * 9000);
  const tutorDisplayId = `TUT-${randomId}`;
  await setDoc(userDocRef, { tutorDisplayId }, { merge: true });
  return tutorDisplayId;
}

async function fetchAndRenderCourses() {
  if (!courseGrid) return;

  const emptyStateElem = document.getElementById("noCoursesMessage");
  const baseEmptyStateHTML = emptyStateElem ? emptyStateElem.outerHTML : "";

  if (emptyStateElem) {
    emptyStateElem.style.display = "block";
    emptyStateElem.innerHTML = `
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size:2.5rem; color:var(--color-primary); margin-bottom:1rem;"></i>
        <h3>Fetching Data...</h3>
        <p>Loading the latest courses from the database.</p>
      `;
  }

  try {
    const currentUser = auth.currentUser || await waitForInitialAuthState();
    const [coursesResult, reviewsResult] = await Promise.allSettled([
      getDocs(collection(db, "courses")),
      getDocs(collection(db, "reviews"))
    ]);
    if (coursesResult.status !== "fulfilled") {
      throw coursesResult.reason;
    }

    const querySnapshot = coursesResult.value;
    allCoursesData = [];
    courseReviewSummaryMap = new Map();

    querySnapshot.forEach((docSnap) => {
      allCoursesData.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (reviewsResult.status === "fulfilled") {
      courseReviewSummaryMap = buildCourseReviewSummaryMap(
        reviewsResult.value.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
      );
    } else {
      console.warn("Failed to fetch browse review summaries:", reviewsResult.reason);
    }

    renderFeaturedCourses(currentUser);
    renderRecommendedCourses(currentUser);

    let gridHTML = baseEmptyStateHTML;

    allCoursesData.forEach((course) => {
      gridHTML += getCourseCardMarkup(course, currentUser);
    });

    courseGrid.innerHTML = gridHTML;
    setupCards();
    applyFilters();
  } catch (error) {
    console.error("Error fetching courses:", error);
      courseReviewSummaryMap = new Map();
      if (emptyStateElem) {
        emptyStateElem.style.display = "block";
        emptyStateElem.innerHTML = `
          <i class="fa-solid fa-circle-exclamation" style="font-size:2.5rem; color:#ef4444; margin-bottom:1rem;"></i>
          <h3>Failed to load</h3>
          <p>We couldn't reach the database. Please check your connection.</p>
        `;
      }
      if (recommendedCourseSection) {
        recommendedCourseSection.hidden = true;
      }
      if (featuredCourseSection) {
        featuredCourseSection.hidden = true;
      }
    }
}

function setupCards(root = courseGrid) {
  if (!root) return;

  const cards = Array.from(root.querySelectorAll(".course-card"));

  cards.forEach((card, index) => {
    card.dataset.index = index;

    card.addEventListener("click", (event) => {
      event.preventDefault();
      const courseId = card.getAttribute("data-id");
      if (courseId) {
        openCourseSession(courseId);
      }
    });

    const btnBook = card.querySelector(".btn-book");
    if (btnBook) {
      btnBook.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const courseId = card.getAttribute("data-id");
        if (!courseId) return;

        const courseData = allCoursesData.find((entry) => entry.id === courseId);
        const currentUser = auth.currentUser || await waitForInitialAuthState();
        if (courseData && isTutorOwnCourse(courseData, currentUser)) {
          localStorage.setItem("selectedCourse", courseId);
          window.location.href = `manage.html?id=${encodeURIComponent(courseId)}`;
          return;
        }

        if (!courseData || !isCourseOpenForApplicants(courseData)) {
          alert("This course is closed for new applicants.");
          return;
        }

          const paymentModal = document.getElementById("paymentModal");

          if (paymentModal) {
            configureBookingModalForCourse(courseData);
            paymentModal.setAttribute("data-course-id", courseId);
            paymentModal.classList.add("active");
          } else {
          openCourseSession(courseId, { action: "book" });
        }
      });
    }

    const btnChat = card.querySelector(".btn-chat");
    if (btnChat) {
      btnChat.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const courseId = card.getAttribute("data-id");
        if (!courseId) return;

        const courseData = allCoursesData.find((entry) => entry.id === courseId);
        const currentUser = auth.currentUser || await waitForInitialAuthState();
        const chatHref = buildChatHref(courseData?.tutorId, currentUser?.uid || "");
        if (!chatHref) return;

        window.location.href = chatHref;
      });
    }
  });
}

function parsePrice(priceStr) {
  if (!priceStr || priceStr.toLowerCase().includes("free")) return 0;
  const numericStr = priceStr.replace(/[^\d]/g, "");
  return numericStr ? parseInt(numericStr, 10) : 0;
}

function applyFilters() {
  if (!courseGrid || !searchInput || !statusFilter || !priceFilter || !sortFilter) return;

  const searchTerm = searchInput.value.toLowerCase().trim();
  const statusVal = statusFilter.value;
  const priceVal = priceFilter.value;
  const sortVal = sortFilter.value;
  const cards = Array.from(courseGrid.querySelectorAll(".course-card"));
  const visibleCards = [];

  cards.forEach((card) => {
    const titleEl = card.querySelector(".course-title");
    const badgeEl = card.querySelector(".status-badge");
    const priceEl = card.querySelector(".price");
    const descEl = card.querySelector(".course-desc");

    const titleText = titleEl ? titleEl.textContent.toLowerCase() : "";
    const descText = descEl ? descEl.textContent.toLowerCase() : "";
    const statusText = badgeEl ? badgeEl.textContent.toLowerCase() : "open";
    const priceText = priceEl ? priceEl.textContent : "0";
    const priceNum = parsePrice(priceText);

    const matchesSearch = searchTerm === "" || titleText.includes(searchTerm) || descText.includes(searchTerm);
    const matchesStatus = statusVal === "all" || statusText.includes(statusVal);

    let matchesPrice = true;
    if (priceVal === "free") matchesPrice = priceNum === 0;
    else if (priceVal === "under_500") matchesPrice = priceNum > 0 && priceNum < 500;
    else if (priceVal === "over_500") matchesPrice = priceNum >= 500;

    if (matchesSearch && matchesStatus && matchesPrice) {
      card.style.display = "flex";
      visibleCards.push({ card, priceNum, origIndex: parseInt(card.dataset.index || "0", 10) });
    } else {
      card.style.display = "none";
    }
  });

  const freshEmptyState = document.getElementById("noCoursesMessage");
  if (freshEmptyState) {
    freshEmptyState.style.display = visibleCards.length === 0 ? "block" : "none";
  }

  visibleCards.sort((a, b) => {
    if (sortVal === "price_low") return a.priceNum - b.priceNum;
    if (sortVal === "price_high") return b.priceNum - a.priceNum;
    return a.origIndex - b.origIndex;
  });

  visibleCards.forEach((item) => {
    courseGrid.appendChild(item.card);
  });
}

if (courseGrid && searchInput && statusFilter && priceFilter && sortFilter) {
  searchInput.addEventListener("input", applyFilters);
  statusFilter.addEventListener("change", applyFilters);
  priceFilter.addEventListener("change", applyFilters);
  sortFilter.addEventListener("change", applyFilters);
  fetchAndRenderCourses();
}

const createCourseForm = document.getElementById("createCourseForm");
const imageUpload = document.getElementById("imageUpload");
const imageUploadText = document.getElementById("imageUploadText");
const imageUploadPreview = document.getElementById("imageUploadPreview");
const imageUploadEmpty = document.getElementById("imageUploadEmpty");
const clearImageUploadBtn = document.getElementById("clearImageUploadBtn");
const qrCodeUpload = document.getElementById("qrCodeUpload");
const qrCodeUploadText = document.getElementById("qrCodeUploadText");
const qrCodeUploadPreview = document.getElementById("qrCodeUploadPreview");
const qrCodeUploadEmpty = document.getElementById("qrCodeUploadEmpty");
const clearQrCodeUploadBtn = document.getElementById("clearQrCodeUploadBtn");

function updateCreateUploadState(inputEvent, textElement, previewElement, emptyElement, defaultLabel) {
  const selectedFile = inputEvent?.target?.files && inputEvent.target.files[0] ? inputEvent.target.files[0] : null;

  if (selectedFile) {
    const objectUrl = URL.createObjectURL(selectedFile);
    setManagedAssetPreview(previewElement, emptyElement, textElement, objectUrl, `Selected: ${selectedFile.name}`, { isObjectUrl: true });
    return;
  }

  setManagedAssetPreview(previewElement, emptyElement, textElement, "", defaultLabel);
}

if (imageUpload && imageUploadText) {
  imageUpload.addEventListener("change", (event) => {
    updateCreateUploadState(event, imageUploadText, imageUploadPreview, imageUploadEmpty, "Click to upload a course image");
    updateCreateAssetActionButton("image");
  });
}

if (qrCodeUpload && qrCodeUploadText) {
  qrCodeUpload.addEventListener("change", (event) => {
    updateCreateUploadState(event, qrCodeUploadText, qrCodeUploadPreview, qrCodeUploadEmpty, "Click to upload a payment QR code");
    updateCreateAssetActionButton("qrCode");
  });
}

if (clearImageUploadBtn) {
  clearImageUploadBtn.addEventListener("click", () => {
    clearCreateAssetSelection("image");
  });
}

if (clearQrCodeUploadBtn) {
  clearQrCodeUploadBtn.addEventListener("click", () => {
    clearCreateAssetSelection("qrCode");
  });
}

updateCreateAssetActionButton("image");
updateCreateAssetActionButton("qrCode");

if (createCourseForm) {
  createCourseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const user = auth.currentUser;
    if (!user) {
      alert("You must be logged in to create a course.");
      return;
    }

    const submitBtn = createCourseForm.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : "Create Course";

    try {
      if (submitBtn) {
        submitBtn.textContent = "Creating...";
        submitBtn.disabled = true;
      }

      const title = document.getElementById("title").value;
      const description = document.getElementById("description").value;
      const price = parseFloat(document.getElementById("price").value);
      const totalSeats = parseInt(document.getElementById("seats").value, 10);
      const totalSessionsRaw = document.getElementById("totalSessions") ? document.getElementById("totalSessions").value.trim() : "";
      const totalSessions = totalSessionsRaw === "" ? 0 : parseInt(totalSessionsRaw, 10);
      const startDate = document.getElementById("startDate") ? document.getElementById("startDate").value.trim() : "";
      const status = document.getElementById("courseStatus").value;
      const rawOutcomes = document.getElementById("courseOutcomes") ? document.getElementById("courseOutcomes").value : "";
      const outcomes = rawOutcomes.split("\n").map((line) => line.trim()).filter((line) => line !== "");
      const isCertified = Boolean(document.getElementById("isCertified")?.checked);
      const isFeatured = Boolean(document.getElementById("isFeatured")?.checked);

      if (!Number.isInteger(totalSessions) || totalSessions < 0) {
        alert("Total sessions must be 0 or greater.");
        if (submitBtn) {
          submitBtn.textContent = originalBtnText;
          submitBtn.disabled = false;
        }
        return;
      }

      const qrFile = qrCodeUpload && qrCodeUpload.files ? qrCodeUpload.files[0] : null;
      const imageFile = imageUpload && imageUpload.files ? imageUpload.files[0] : null;
      const tutorDisplayIdPromise = getOrCreateTutorDisplayId(user);

      if (submitBtn) {
        if (qrFile && imageFile) {
          submitBtn.textContent = "Uploading assets...";
        } else if (imageFile) {
          submitBtn.textContent = "Preparing image...";
        } else if (qrFile) {
          submitBtn.textContent = "Uploading QR Code...";
        }
      }

      const qrUploadPromise = qrFile
        ? uploadCourseAsset(qrFile, "courseQRCodes", user.uid)
        : Promise.resolve("");
      const imageUploadPromise = imageFile
        ? uploadCourseAsset(imageFile, "courseImages", user.uid, {
          optimizeImage: true,
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82
        })
        : Promise.resolve("");

      const [tutorDisplayId, qrCodeUrl, imageUrl] = await Promise.all([
        tutorDisplayIdPromise,
        qrUploadPromise,
        imageUploadPromise
      ]);

      if (submitBtn) submitBtn.textContent = "Finalizing...";

      const createdCourseRef = await addDoc(collection(db, "courses"), {
        title,
        description,
        price,
        totalSeats,
        seatsFilled: 0,
        totalSessions,
        startDate,
        studentSequence: 0,
        status,
        isCertified,
        isFeatured,
        tutorId: user.uid,
        tutorDisplayId,
        image: imageUrl,
        imageUrl,
        qrCode: qrCodeUrl,
        outcomes,
        createdAt: new Date().toISOString()
      });

      await addTutoringTransaction(
        user.uid,
        `Created tutoring course: ${title || "Untitled Course"}`,
        {
          type: "tutoring_course_created",
          courseId: createdCourseRef.id,
          courseTitle: title || "Untitled Course"
        }
      );

      alert("Course created successfully!");
      window.location.href = "browse.html";
    } catch (error) {
      console.error("Error creating course:", error);
      alert("Failed to create course. Please check the console for details.");
      if (submitBtn) {
        submitBtn.textContent = originalBtnText;
        submitBtn.disabled = false;
      }
    }
  });
}

async function loadSessionPage() {
  const container = document.querySelector(".tutoring-session-container");
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const courseId = urlParams.get("id");

  if (!courseId) {
    container.innerHTML = `
      <div style="text-align: center; margin-top: 5rem;">
        <i class="fa-solid fa-circle-exclamation" style="font-size:3rem; color:#ef4444; margin-bottom:1rem;"></i>
        <h2>Invalid Course Link</h2>
        <p style="color:var(--color-text-muted);">No valid course identifier was provided in the link.</p>
        <a href="browse.html" class="btn-primary-full" style="display:inline-block; width:auto; margin-top:2rem; padding: 0.75rem 1.5rem;">Back to Browse</a>
      </div>`;
    return;
  }

  try {
    const courseRef = doc(db, "courses", courseId);
    const courseSnap = await getDoc(courseRef);

    if (!courseSnap.exists()) {
      container.innerHTML = `
        <div style="text-align: center; margin-top: 5rem;">
          <i class="fa-solid fa-magnifying-glass" style="font-size:3rem; color:var(--color-text-muted); margin-bottom:1rem;"></i>
          <h2>Course Not Found</h2>
          <p style="color:var(--color-text-muted);">The requested course does not exist or has been removed.</p>
          <a href="browse.html" class="btn-primary-full" style="display:inline-block; width:auto; margin-top:2rem; padding: 0.75rem 1.5rem;">Browse Courses</a>
        </div>`;
      return;
    }

    const course = { id: courseSnap.id, ...courseSnap.data() };
    const currentUser = auth.currentUser || await waitForInitialAuthState();
    const statusToken = getNormalizedCourseStatus(course);
    const isOpen = isCourseOpenForApplicants(course);
    const isFull = isCourseFull(course);
    const isOwnCourse = isTutorOwnCourse(course, currentUser);

    const displayTitle = document.getElementById("displayTitle");
    const displayShortDesc = document.getElementById("displayShortDesc");
    const displayFullDesc = document.getElementById("displayFullDesc");
    const displayTutorId = document.getElementById("displayTutorId");
    const displaySeats = document.getElementById("displaySeats");
    const displayStartDate = document.getElementById("displayStartDate");
    const displayPrice = document.getElementById("displayPrice");
    const displayImage = document.getElementById("displayImage");
    const displayOutcomes = document.getElementById("displayOutcomes");
    const tutorQrImage = document.getElementById("tutorQrImage");
    const tutorQrLabel = document.getElementById("tutorQrLabel");
    const displayStatusBadge = document.getElementById("displayStatusBadge");
    const displayCertifiedBadge = document.getElementById("displayCertifiedBadge");
    const openModalBtn = document.getElementById("openModalBtn");
    const actionDesc = document.getElementById("actionDesc");
    const secondaryActionBtn = document.getElementById("chatTutorBtn");
    const approvedChatBtn = document.getElementById("approvedChatTutorBtn");
    const chatHref = buildChatHref(course.tutorId, currentUser?.uid || "");
    const reviewComment = document.getElementById("reviewComment");
    const [currentEnrollment, courseReviews] = await Promise.all([
      currentUser && !isOwnCourse
        ? fetchStudentEnrollmentForCourse(courseId, currentUser.uid)
        : Promise.resolve(null),
      fetchCourseReviews(courseId)
    ]);

    sessionPageState.courseId = courseId;
    sessionPageState.course = course;
    sessionPageState.currentUser = currentUser;
    sessionPageState.currentEnrollment = currentEnrollment;
    sessionPageState.reviews = courseReviews;
    sessionPageState.reviewSort = "helpful";

    if (displayTitle) displayTitle.textContent = course.title || "Untitled Course";
    if (displayShortDesc) {
      const summaryText = formatCourseSummary(course.description);
      displayShortDesc.textContent = summaryText;
      displayShortDesc.hidden = !summaryText;
    }
    if (displayFullDesc) displayFullDesc.textContent = course.description || "No description available";
    if (displayTutorId) displayTutorId.textContent = course.tutorDisplayId || "Unknown Tutor";
    if (displaySeats) displaySeats.textContent = `${Number(course.seatsFilled) || 0} / ${Number(course.totalSeats) || 0}`;
    if (displayStartDate) displayStartDate.textContent = formatCourseStartDateLabel(course.startDate);
    if (displayPrice) {
      displayPrice.textContent = formatCoursePrice(course.price);
      displayPrice.classList.toggle("is-free", isFreeCourse(course));
      displayPrice.style.visibility = "visible";
    }

    if (displayOutcomes) {
      if (Array.isArray(course.outcomes) && course.outcomes.length > 0) {
        displayOutcomes.innerHTML = course.outcomes
          .map((item) => `<li><i class="fa-solid fa-check"></i> ${escapeHTML(item)}</li>`)
          .join("");
      } else {
        displayOutcomes.innerHTML = `<li><i class="fa-solid fa-minus" style="color:var(--color-text-muted);"></i> <span style="color:var(--color-text-muted);">No specific outcomes listed</span></li>`;
      }
    }

    if (displayStatusBadge) {
      displayStatusBadge.textContent = formatCourseStatus(statusToken).toUpperCase();
      displayStatusBadge.className = "status-badge";
      if (statusToken === "draft") displayStatusBadge.classList.add("ongoing");
      if (statusToken === "closed") displayStatusBadge.classList.add("completed");
    }

    if (displayCertifiedBadge) {
      displayCertifiedBadge.hidden = !isCourseCertified(course);
    }

    if (displayImage) {
      const courseImage = getCourseImageUrl(course);
      if (courseImage) {
        displayImage.src = courseImage;
        displayImage.style.display = "block";
      } else {
        displayImage.style.display = "none";
      }
    }

    configureBookingModalForCourse(course);

    if (secondaryActionBtn) {
      if (chatHref) {
        secondaryActionBtn.hidden = false;
        secondaryActionBtn.style.display = "";
        secondaryActionBtn.disabled = false;
        secondaryActionBtn.dataset.chatHref = chatHref;
      } else {
        secondaryActionBtn.hidden = true;
        secondaryActionBtn.style.display = "none";
        secondaryActionBtn.disabled = true;
        delete secondaryActionBtn.dataset.chatHref;
      }
    }

    if (approvedChatBtn) {
      if (chatHref) {
        approvedChatBtn.hidden = false;
        approvedChatBtn.style.display = "";
        approvedChatBtn.disabled = false;
        approvedChatBtn.dataset.chatHref = chatHref;
      } else {
        approvedChatBtn.hidden = true;
        approvedChatBtn.style.display = "none";
        approvedChatBtn.disabled = true;
        delete approvedChatBtn.dataset.chatHref;
      }
    }

    if (openModalBtn) {
      if (isOwnCourse) {
        openModalBtn.disabled = false;
        openModalBtn.classList.remove("btn-disabled-full");
        openModalBtn.classList.add("btn-primary-full");
        openModalBtn.innerHTML = `<i class="fa-solid fa-list-check"></i> Manage Course`;
        openModalBtn.dataset.action = "manage";
        openModalBtn.dataset.manageHref = `manage.html?id=${encodeURIComponent(courseId)}`;
        if (actionDesc) actionDesc.textContent = "Open your tutor dashboard to manage applicants, settings, and attendance.";
        if (secondaryActionBtn) {
          secondaryActionBtn.hidden = true;
          secondaryActionBtn.style.display = "none";
          secondaryActionBtn.disabled = true;
          delete secondaryActionBtn.dataset.chatHref;
        }
        if (approvedChatBtn) {
          approvedChatBtn.hidden = true;
          approvedChatBtn.style.display = "none";
          approvedChatBtn.disabled = true;
          delete approvedChatBtn.dataset.chatHref;
        }
      } else if (isOpen) {
        openModalBtn.disabled = false;
        openModalBtn.classList.remove("btn-disabled-full");
        openModalBtn.classList.add("btn-primary-full");
        openModalBtn.innerHTML = isFreeCourse(course)
          ? `<i class="fa-solid fa-gift"></i> Join Free`
          : `<i class="fa-solid fa-bolt"></i> Book Seat`;
        openModalBtn.dataset.action = "book";
        delete openModalBtn.dataset.manageHref;
        if (actionDesc) {
          actionDesc.textContent = isFreeCourse(course)
            ? "Join this free course while seats are available."
            : "Secure your seat before the course closes.";
        }
        if (secondaryActionBtn) {
          secondaryActionBtn.hidden = false;
          secondaryActionBtn.style.display = "";
        }
      } else if (isFull) {
        openModalBtn.disabled = true;
        openModalBtn.classList.remove("btn-primary-full");
        openModalBtn.classList.add("btn-disabled-full");
        openModalBtn.innerHTML = `<i class="fa-solid fa-users-slash"></i> Course Full`;
        openModalBtn.dataset.action = "full";
        delete openModalBtn.dataset.manageHref;
        if (actionDesc) actionDesc.textContent = "All seats for this course are currently filled.";
        if (secondaryActionBtn) {
          secondaryActionBtn.hidden = false;
          secondaryActionBtn.style.display = "";
        }
      } else {
        openModalBtn.disabled = true;
        openModalBtn.classList.remove("btn-primary-full");
        openModalBtn.classList.add("btn-disabled-full");
        openModalBtn.innerHTML = `<i class="fa-solid fa-lock"></i> Course Closed`;
        openModalBtn.dataset.action = "closed";
        delete openModalBtn.dataset.manageHref;
        if (actionDesc) actionDesc.textContent = "This course is currently closed for new applicants.";
        if (secondaryActionBtn) {
          secondaryActionBtn.hidden = false;
          secondaryActionBtn.style.display = "";
        }
      }
    }

    bindSessionReviewEvents();
    setSelectedReviewRating(0);
    if (reviewComment) {
      reviewComment.value = "";
    }
    applySessionEnrollmentState(course, currentUser, currentEnrollment);
    renderSessionReviewSection();

    localStorage.setItem("selectedCourse", courseId);

    const paymentModal = document.getElementById("paymentModal");
    if (urlParams.get("action") === "book" && paymentModal && isOpen && !isOwnCourse && !currentEnrollment) {
      paymentModal.setAttribute("data-course-id", courseId);
      paymentModal.classList.add("active");
    }
  } catch (error) {
    console.error("Error fetching session details:", error);
    container.innerHTML = `
      <div style="text-align: center; margin-top: 5rem;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:3rem; color:#f59e0b; margin-bottom:1rem;"></i>
        <h2>Database Error</h2>
        <p style="color:var(--color-text-muted);">Could not fetch course details. Please try again later.</p>
      </div>`;
  }
}

function getManageRoot() {
  return document.getElementById("manageDashboardRoot");
}

function getManageListRoot() {
  return document.getElementById("manageCourseListRoot");
}

function setManageShellState(type, title, message) {
  const root = getManageRoot();
  const stateCard = document.getElementById("manageStateCard");
  const stateIcon = document.getElementById("manageStateIcon");
  const stateTitle = document.getElementById("manageStateTitle");
  const stateText = document.getElementById("manageStateText");
  const content = document.getElementById("manageDashboardContent");
  const tutorIdHighlight = document.getElementById("manageTutorIdHighlight");

  if (!root) return;

  root.dataset.shellState = type;

  if (type === "ready") {
    if (stateCard) {
      stateCard.hidden = true;
      stateCard.style.display = "none";
    }

    if (content) {
      content.hidden = !manageDashboardState.course;
      content.style.display = manageDashboardState.course ? "" : "none";
    }

    if (tutorIdHighlight) {
      tutorIdHighlight.hidden = !manageDashboardState.course;
    }

    return;
  }

  if (content) {
    content.hidden = true;
    content.style.display = "none";
  }

  if (stateCard) {
    stateCard.hidden = false;
    stateCard.style.display = "";
  }

  if (tutorIdHighlight) {
    tutorIdHighlight.hidden = true;
  }

  if (stateTitle) {
    stateTitle.textContent = title;
  }

  if (stateText) {
    stateText.textContent = message;
  }

  if (stateIcon) {
    const isErrorState = type === "error";
    const isEmptyState = type === "empty";

    stateIcon.className = isErrorState ? "state-icon error" : "state-icon";
    stateIcon.innerHTML = isErrorState
      ? `<i class="fa-solid fa-circle-exclamation"></i>`
      : isEmptyState
        ? `<i class="fa-solid fa-layer-group"></i>`
        : `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
  }
}

function setManageListShellState(type, title, message) {
  const root = getManageListRoot();
  const stateCard = document.getElementById("manageStateCard");
  const stateIcon = document.getElementById("manageStateIcon");
  const stateTitle = document.getElementById("manageStateTitle");
  const stateText = document.getElementById("manageStateText");
  const courseCountText = document.getElementById("manageCourseCountText");
  const courseGrid = document.getElementById("manageCourseGrid");

  if (!root) return;

  root.dataset.shellState = type;

  if (type === "ready") {
    if (stateCard) {
      stateCard.hidden = true;
      stateCard.style.display = "none";
    }

    if (courseGrid) {
      courseGrid.hidden = manageDashboardState.courses.length === 0;
      courseGrid.style.display = "";
    }

    return;
  }

  if (courseCountText) {
    courseCountText.textContent = type === "loading"
      ? "Loading courses..."
      : type === "empty"
        ? "0 courses"
        : "Unavailable";
  }

  if (courseGrid) {
    courseGrid.hidden = true;
    courseGrid.style.display = "none";
  }

  if (stateCard) {
    stateCard.hidden = false;
    stateCard.style.display = "";
  }

  if (stateTitle) {
    stateTitle.textContent = title;
  }

  if (stateText) {
    stateText.textContent = message;
  }

  if (stateIcon) {
    const isErrorState = type === "error";
    const isEmptyState = type === "empty";

    stateIcon.className = isErrorState ? "state-icon error" : "state-icon";
    stateIcon.innerHTML = isErrorState
      ? `<i class="fa-solid fa-circle-exclamation"></i>`
      : isEmptyState
        ? `<i class="fa-solid fa-layer-group"></i>`
        : `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
  }
}

function showManageFeedback(message, type = "success") {
  const feedbackEl = document.getElementById("manageFeedback");
  if (!feedbackEl) return;

  feedbackEl.hidden = false;
  feedbackEl.className = `feedback-banner ${type}`;
  feedbackEl.textContent = message;
}

function clearManageFeedback() {
  const feedbackEl = document.getElementById("manageFeedback");
  if (!feedbackEl) return;

  feedbackEl.hidden = true;
  feedbackEl.className = "feedback-banner";
  feedbackEl.textContent = "";
}

function renderManageCourseTiles() {
  const courseGrid = document.getElementById("manageCourseGrid");
  const courseCountText = document.getElementById("manageCourseCountText");
  if (!courseGrid) return;

  const courseTotal = manageDashboardState.courses.length;

  if (courseCountText) {
    courseCountText.textContent = courseTotal === 1 ? "1 course" : `${courseTotal} courses`;
  }

  if (courseTotal === 0) {
    courseGrid.innerHTML = "";
    courseGrid.hidden = true;
    return;
  }

  courseGrid.hidden = false;
  courseGrid.innerHTML = manageDashboardState.courses.map((course) => {
    const seatsFilled = Math.max(Number(course.seatsFilled) || 0, 0);
    const totalSeats = Math.max(Number(course.totalSeats) || 0, 0);
    const progress = totalSeats > 0 ? Math.min((seatsFilled / totalSeats) * 100, 100) : 0;
    const statusToken = getNormalizedCourseStatus(course);
    const isActive = course.id === manageDashboardState.courseId;
    const safeImage = escapeHTML(getCourseImageUrl(course));
    const statusText = formatCourseStatus(statusToken).toUpperCase();
    const startDateLabel = formatCourseStartDateLabel(course.startDate);
    const freeCourse = isFreeCourse(course);
    const { count: ratingCount, avgRating } = getCourseReviewCardSummary(course.id);

    return `
      <article
        class="course-card manage-course-card${isActive ? " active" : ""}${freeCourse ? " is-free-card" : ""}"
        data-manage-course-id="${escapeHTML(course.id)}"
        tabindex="0"
        role="link"
        aria-label="Open ${escapeHTML(course.title || "course")}"
      >
        <div class="card-banner" style="background: ${getStatusColor(statusToken)};">
          ${safeImage ? `<img class="manage-course-banner-image" src="${safeImage}" alt="${escapeHTML(course.title || "Course banner")}">` : ""}
          <span class="status-badge">${escapeHTML(statusText)}</span>
          ${freeCourse ? `<span class="course-free-badge"><i class="fa-solid fa-gift"></i> Free</span>` : ""}
        </div>

        <div class="card-content">
          <h3 class="course-title">${escapeHTML(course.title || "Untitled Course")}</h3>
          <p class="course-desc">${escapeHTML(course.description || "No description added for this course yet.")}</p>

          <div class="course-rating-row${ratingCount === 0 ? " is-empty" : ""}">
            <div class="course-rating-inline">
              ${getStarRatingMarkup(avgRating, {
                size: "small",
                label: ratingCount > 0 ? `${avgRating.toFixed(1)} out of 5 stars` : "No ratings yet"
              })}
              <span class="course-rating-score">${escapeHTML(ratingCount > 0 ? avgRating.toFixed(1) : "0.0")}</span>
            </div>
            <span class="course-rating-meta">${escapeHTML(ratingCount > 0 ? `${ratingCount} ${ratingCount === 1 ? "rating" : "ratings"}` : "No ratings yet")}</span>
          </div>

          <div class="card-info-row">
            <span class="tutor-id"><i class="fa-solid fa-chalkboard-user"></i> ${escapeHTML(course.tutorDisplayId || "Tutor ID unavailable")}</span>
            <span class="price${freeCourse ? " is-free" : ""}">${escapeHTML(formatCoursePrice(course.price))}</span>
          </div>

          <div class="card-bottom">
            <span class="seats-info"><i class="fa-solid fa-users"></i> ${seatsFilled} / ${totalSeats} seats filled</span>
            <span class="progress-info"><i class="fa-solid fa-chart-line"></i> ${Math.round(progress)}%</span>
            <span class="session-info"><i class="fa-regular fa-calendar"></i> ${escapeHTML(startDateLabel)}</span>
          </div>

          <div class="card-actions">
            <button type="button" class="btn-book" data-manage-select-id="${escapeHTML(course.id)}">${isActive ? "Selected Course" : "Manage Course"}</button>
            <span class="btn-chat"><i class="fa-solid ${isActive ? "fa-circle-check" : "fa-arrow-right"}"></i></span>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function primeManageApplicantsLoadingState() {
  const applicantsList = document.getElementById("applicantsList");
  const summaryText = document.getElementById("applicantSummaryText");

  if (summaryText) {
    summaryText.textContent = "Loading applicants...";
  }

  if (applicantsList) {
    applicantsList.innerHTML = `<div class="empty-card">Fetching applicants...</div>`;
  }
}

function formatAverageAttendanceValue(approvedApplicants, totalSessions) {
  if (!Array.isArray(approvedApplicants) || approvedApplicants.length === 0) {
    return "0.0 sessions";
  }

  const totalAttendance = approvedApplicants.reduce(
    (sum, applicant) => sum + normalizeCount(applicant.attendanceCount),
    0
  );
  const averageAttendance = totalAttendance / approvedApplicants.length;
  const roundedAverageAttendance = averageAttendance.toFixed(1);

  if (normalizeCount(totalSessions) > 0) {
    return `${roundedAverageAttendance} / ${normalizeCount(totalSessions)}`;
  }

  return `${roundedAverageAttendance} sessions`;
}

function renderManageOverview() {
  const course = manageDashboardState.course;
  if (!course) return;

  const heading = document.getElementById("managePageHeading");
  const subtitle = document.getElementById("managePageSubtitle");
  const backLink = document.getElementById("manageBackLink");
  const overviewTitle = document.getElementById("overviewCourseTitle");
  const overviewDescription = document.getElementById("overviewCourseDescription");
  const overviewStatusBadge = document.getElementById("overviewStatusBadge");
  const overviewPrice = document.getElementById("overviewCoursePrice");
  const overviewSeats = document.getElementById("overviewSeatsFilled");
  const overviewTotalStudents = document.getElementById("overviewTotalStudents");
  const overviewPendingStudents = document.getElementById("overviewPendingStudents");
  const overviewAverageAttendance = document.getElementById("overviewAverageAttendance");
  const overviewProgressLabel = document.getElementById("overviewProgressLabel");
  const overviewProgressFill = document.getElementById("overviewProgressFill");
  const tutorIdHighlight = document.getElementById("manageTutorIdHighlight");
  const tutorIdValue = document.getElementById("manageTutorIdValue");

  const seatsFilled = Math.max(Number(course.seatsFilled) || 0, 0);
  const totalSeats = Math.max(Number(course.totalSeats) || 0, 0);
  const approvedApplicants = manageDashboardState.applicants.filter((entry) => normalizeApplicantStatus(entry.status) === "approved");
  const totalStudents = approvedApplicants.length;
  const pendingStudents = manageDashboardState.applicants.filter((entry) => normalizeApplicantStatus(entry.status) === "pending").length;
  const averageAttendanceValue = formatAverageAttendanceValue(approvedApplicants, getCourseTotalSessions(course));
  const statusToken = getNormalizedCourseStatus(course);
  const statusLabel = formatCourseStatus(statusToken);
  const progress = totalSeats > 0 ? Math.min((seatsFilled / totalSeats) * 100, 100) : 0;
  const badgeClass = statusToken === "draft" ? "pending" : statusToken;

  if (heading) heading.textContent = "Manage Courses";
  if (subtitle) subtitle.textContent = "Select one of your created courses to review applicants, track seat usage, and update settings.";
  if (backLink) backLink.href = manageDashboardState.courseId ? `session.html?id=${encodeURIComponent(manageDashboardState.courseId)}` : "browse.html";
  if (overviewTitle) overviewTitle.textContent = course.title || "Untitled Course";
  if (overviewDescription) overviewDescription.textContent = course.description || "No description available.";
  if (overviewPrice) {
    overviewPrice.textContent = formatCoursePrice(course.price);
    overviewPrice.classList.toggle("is-free", isFreeCourse(course));
  }
  if (overviewSeats) overviewSeats.textContent = `${seatsFilled} / ${totalSeats}`;
  if (overviewTotalStudents) overviewTotalStudents.textContent = String(totalStudents);
  if (overviewPendingStudents) overviewPendingStudents.textContent = String(pendingStudents);
  if (overviewAverageAttendance) overviewAverageAttendance.textContent = averageAttendanceValue;
  if (overviewProgressLabel) overviewProgressLabel.textContent = `${Math.round(progress)}% utilized`;
  if (overviewProgressFill) overviewProgressFill.style.width = `${progress}%`;
  if (tutorIdValue) tutorIdValue.textContent = course.tutorDisplayId || "Unavailable";
  if (tutorIdHighlight) tutorIdHighlight.hidden = false;

  if (overviewStatusBadge) {
    overviewStatusBadge.className = `status-badge ${badgeClass}`;
    overviewStatusBadge.textContent = statusLabel;
  }
}

function populateManageSettingsForm() {
  const course = manageDashboardState.course;
  if (!course) return;

  const descriptionField = document.getElementById("manageCourseDescription");
  const priceField = document.getElementById("manageCoursePrice");
  const seatsField = document.getElementById("manageCourseSeats");
  const totalSessionsField = document.getElementById("manageCourseTotalSessions");
  const startDateField = document.getElementById("manageCourseStartDate");
  const statusField = document.getElementById("manageCourseStatus");
  const isCertifiedField = document.getElementById("manageIsCertified");
  const isFeaturedField = document.getElementById("manageIsFeatured");

  if (descriptionField) descriptionField.value = course.description || "";
  if (priceField) priceField.value = Number(course.price) || 0;
  if (seatsField) seatsField.value = Math.max(Number(course.totalSeats) || 0, 1);
  if (totalSessionsField) totalSessionsField.value = getCourseTotalSessions(course);
  if (startDateField) startDateField.value = course.startDate || "";
  if (statusField) {
    statusField.value = String(course.status || "").trim().toLowerCase() === "closed" ? "closed" : "open";
  }
  if (isCertifiedField) {
    isCertifiedField.checked = isCourseCertified(course);
  }
  if (isFeaturedField) {
    isFeaturedField.checked = isCourseFeatured(course);
  }

  resetManageAssetRemovalState();
  populateManagedAssetInputs(course);
}

function sortApplicants(applicants) {
  const orderMap = { pending: 0, approved: 1, rejected: 2 };

  return [...applicants].sort((a, b) => {
    const statusDelta = (orderMap[normalizeApplicantStatus(a.status)] ?? 99) - (orderMap[normalizeApplicantStatus(b.status)] ?? 99);
    if (statusDelta !== 0) return statusDelta;

    const dateA = new Date(a.enrolledAt || 0).getTime() || 0;
    const dateB = new Date(b.enrolledAt || 0).getTime() || 0;
    return dateB - dateA;
  });
}

function renderApplicants() {
  const applicantsList = document.getElementById("applicantsList");
  const summaryText = document.getElementById("applicantSummaryText");
  const filterButtons = document.querySelectorAll("[data-filter-status]");
  if (!applicantsList) return;

  filterButtons.forEach((button) => {
    const isActive = button.dataset.filterStatus === manageDashboardState.filter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const totalApplicants = manageDashboardState.applicants.length;
  const filteredApplicants = manageDashboardState.filter === "all"
    ? manageDashboardState.applicants
    : manageDashboardState.applicants.filter((entry) => normalizeApplicantStatus(entry.status) === manageDashboardState.filter);

  if (summaryText) {
    summaryText.textContent = totalApplicants === 0
      ? "No applicants yet"
      : `Showing ${filteredApplicants.length} of ${totalApplicants} applicants`;
  }

  if (totalApplicants === 0) {
    applicantsList.innerHTML = `<div class="empty-card">No enrollments have been submitted for this course yet.</div>`;
    return;
  }

  if (filteredApplicants.length === 0) {
    applicantsList.innerHTML = `<div class="empty-card">No ${escapeHTML(manageDashboardState.filter)} applicants found for this filter.</div>`;
    return;
  }

  applicantsList.innerHTML = filteredApplicants.map((applicant) => {
    const status = normalizeApplicantStatus(applicant.status);
    const isPending = status === "pending";
    const isApproved = status === "approved";
    const isDecisionWorking = manageDashboardState.actionInFlightId === applicant.id;
    const isAttendanceWorking = manageDashboardState.attendanceInFlightId === applicant.id;
    const attendanceCount = normalizeCount(applicant.attendanceCount);
    const totalSessions = getCourseTotalSessions(manageDashboardState.course);
    const attendanceSummary = formatAttendanceProgress(attendanceCount, totalSessions);
    const attendancePercent = totalSessions > 0 ? Math.min((attendanceCount / totalSessions) * 100, 100) : 0;
    const hasCompletedAttendance = totalSessions > 0 && attendanceCount >= totalSessions;
    const chatHref = buildChatHref(applicant.studentId, manageDashboardState.course?.tutorId || "");
    return `
      <article class="applicant-card">
        <div class="applicant-info">
          <div class="applicant-avatar">${escapeHTML(getInitials(applicant.studentName))}</div>
          <div class="applicant-copy">
            <div class="applicant-top">
              <div>
                <h3 class="applicant-name">${escapeHTML(applicant.studentName)}</h3>
                <p class="applicant-meta">Student ID: ${escapeHTML(applicant.studentDisplayId || "Unavailable")}</p>
              </div>
              <span class="status-badge ${escapeHTML(status)}">${escapeHTML(formatApplicantStatus(status))}</span>
            </div>
            <div class="applicant-detail-row">
              <span><i class="fa-regular fa-calendar"></i> Applied ${escapeHTML(formatDateLabel(applicant.enrolledAt))}</span>
            </div>
            <div class="attendance-progress${hasCompletedAttendance ? " completed" : ""}">
              <div class="attendance-progress-top">
                <span class="attendance-label"><i class="fa-solid fa-user-check"></i> Attendance</span>
                <strong class="attendance-value">${escapeHTML(attendanceSummary)}</strong>
              </div>
              <div class="attendance-track-mini">
                <div class="attendance-fill-mini" style="width: ${attendancePercent}%"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="applicant-actions">
          ${chatHref ? `<a href="${escapeHTML(chatHref)}" class="btn-chat-action" aria-label="Chat with ${escapeHTML(applicant.studentName)}"><i class="fa-solid fa-comment-dots"></i></a>` : ""}
          ${isPending ? `<button type="button" class="btn-secondary" data-proof-id="${escapeHTML(applicant.id)}">View Proof</button>` : ""}
          ${isApproved ? `<button type="button" class="btn-primary" data-attendance-id="${escapeHTML(applicant.id)}" ${isAttendanceWorking || hasCompletedAttendance ? "disabled" : ""}>${hasCompletedAttendance ? "Completed" : isAttendanceWorking ? "Marking..." : "Mark Present"}</button>` : ""}
          ${isPending ? `<button type="button" class="btn-primary" data-applicant-action="approve" data-applicant-id="${escapeHTML(applicant.id)}" ${isDecisionWorking ? "disabled" : ""}>${isDecisionWorking ? "Working..." : "Approve"}</button>` : ""}
          ${isPending ? `<button type="button" class="btn-danger" data-applicant-action="reject" data-applicant-id="${escapeHTML(applicant.id)}" ${isDecisionWorking ? "disabled" : ""}>${isDecisionWorking ? "Working..." : "Reject"}</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function openPaymentProofModal(applicantId) {
  const applicant = manageDashboardState.applicants.find((entry) => entry.id === applicantId);
  const modal = document.getElementById("paymentProofModal");
  const title = document.getElementById("paymentProofModalTitle");
  const description = document.getElementById("paymentProofModalDescription");
  const image = document.getElementById("paymentProofImage");
  const placeholder = document.getElementById("paymentProofPlaceholder");
  const link = document.getElementById("paymentProofLink");

  if (!applicant || !modal || !title || !description || !image || !placeholder || !link) return;

  title.textContent = `${applicant.studentName} - Payment Proof`;
  description.textContent = `Review the submitted proof for ${applicant.studentName} before you approve or reject this application.`;

  if (applicant.paymentProof) {
    image.src = applicant.paymentProof;
    image.hidden = false;
    placeholder.hidden = true;
    link.href = applicant.paymentProof;
    link.hidden = false;
  } else {
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
    link.hidden = true;
    link.removeAttribute("href");
  }

  modal.classList.add("active");
}

function closePaymentProofModal() {
  const modal = document.getElementById("paymentProofModal");
  const image = document.getElementById("paymentProofImage");
  const placeholder = document.getElementById("paymentProofPlaceholder");
  const link = document.getElementById("paymentProofLink");

  if (modal) modal.classList.remove("active");
  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
  }
  if (placeholder) {
    placeholder.hidden = true;
  }
  if (link) {
    link.hidden = true;
    link.removeAttribute("href");
  }
}

async function refreshManagedCourse(courseId = manageDashboardState.courseId) {
  if (!courseId) return;

  const courseSnap = await getDoc(doc(db, "courses", courseId));
  if (!courseSnap.exists()) {
    throw new Error("Course not found.");
  }

  const refreshedCourse = await reconcileCourseSeatUsage({ id: courseSnap.id, ...courseSnap.data() });
  syncManagedCourseCollection(refreshedCourse);
  manageDashboardState.courses = sortManagedCourses(manageDashboardState.courses);

  if (courseId === manageDashboardState.courseId) {
    manageDashboardState.course = refreshedCourse;
    renderManageCourseTiles();
    renderManageOverview();
    populateManageSettingsForm();
  }
}

async function loadManageApplicants(courseId = manageDashboardState.courseId) {
  if (!courseId) return;

  const requestToken = ++manageDashboardState.applicantsRequestToken;
  primeManageApplicantsLoadingState();

  try {
    const activeCourse = manageDashboardState.course?.id === courseId
      ? manageDashboardState.course
      : manageDashboardState.courses.find((entry) => entry.id === courseId);
    const tutorId = activeCourse?.tutorId || "";

    const enrollmentsSnap = await getDocs(
      query(collection(db, "enrollments"), where("courseId", "==", courseId))
    );

    const applicants = [];
    const studentIds = new Set();

    enrollmentsSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (tutorId && data.studentId === tutorId) {
        return;
      }

      applicants.push({
        id: docSnap.id,
        courseId: data.courseId || "",
        studentId: data.studentId || "",
        studentDisplayId: data.studentDisplayId || data.courseStudentId || "",
        attendanceCount: normalizeCount(data.attendanceCount),
        status: normalizeApplicantStatus(data.status),
        paymentProof: data.paymentProof || "",
        enrolledAt: data.enrolledAt || ""
      });

      if (data.studentId) {
        studentIds.add(data.studentId);
      }
    });

    const userEntries = await Promise.all(
      [...studentIds].map(async (studentId) => {
        try {
          const userSnap = await getDoc(doc(db, "users", studentId));
          return [studentId, userSnap.exists() ? userSnap.data() : null];
        } catch (error) {
          console.error("Failed to fetch applicant profile:", error);
          return [studentId, null];
        }
      })
    );

    const userMap = new Map(userEntries);
    if (requestToken !== manageDashboardState.applicantsRequestToken || courseId !== manageDashboardState.courseId) {
      return;
    }

    const applicantsWithDisplayIds = await ensureStudentDisplayIds(courseId, applicants);
    if (requestToken !== manageDashboardState.applicantsRequestToken || courseId !== manageDashboardState.courseId) {
      return;
    }

    manageDashboardState.applicants = sortApplicants(
      applicantsWithDisplayIds.map((applicant) => ({
        ...applicant,
        studentName: resolveDisplayName(userMap.get(applicant.studentId), "Learner")
      }))
    );

    renderManageOverview();
    renderApplicants();
  } catch (error) {
    console.error("Failed to load applicants:", error);
    if (requestToken !== manageDashboardState.applicantsRequestToken || courseId !== manageDashboardState.courseId) {
      return;
    }

    const applicantsList = document.getElementById("applicantsList");
    manageDashboardState.applicants = [];
    renderManageOverview();
    if (applicantsList) {
      applicantsList.innerHTML = `<div class="empty-card">We couldn't load applicants right now. Please try again.</div>`;
    }
    showManageFeedback("Failed to load applicants. Please try again.", "error");
  }
}

async function selectManagedCourse(courseId, options = {}) {
  const selectedCourse = manageDashboardState.courses.find((entry) => entry.id === courseId);
  if (!selectedCourse) return;

  const shouldResetTab = options.resetTab === true;

  manageDashboardState.courseId = courseId;
  manageDashboardState.course = { ...selectedCourse };
  manageDashboardState.applicants = [];
  manageDashboardState.filter = "all";
  manageDashboardState.actionInFlightId = "";
  manageDashboardState.attendanceInFlightId = "";

  updateManagedCourseLocation(courseId);
  renderManageCourseTiles();
  renderManageOverview();
  populateManageSettingsForm();
  primeManageApplicantsLoadingState();
  setManageShellState("ready");

  if (shouldResetTab) {
    switchManageTab("overviewTabPanel");
  }

  await loadManageApplicants(courseId);
}

function hasSeatCapacityForApproval(courseData, enrollmentStatus = "pending") {
  const seatsFilled = Math.max(Number(courseData?.seatsFilled) || 0, 0);
  const totalSeats = Math.max(Number(courseData?.totalSeats) || 0, 0);
  const reservedSeatOffset = normalizeApplicantStatus(enrollmentStatus) === "pending" ? 1 : 0;
  const seatsClaimedByOthers = Math.max(seatsFilled - reservedSeatOffset, 0);

  return totalSeats > 0 && seatsClaimedByOthers < totalSeats;
}

async function validateSeatAvailabilityBeforeApproval(courseId) {
  if (!courseId) return false;

  const courseSnap = await getDoc(doc(db, "courses", courseId));
  if (!courseSnap.exists()) {
    throw new Error("Course not found.");
  }

  return hasSeatCapacityForApproval(courseSnap.data() || {}, "pending");
}

async function handleApplicantDecision(applicantId, action) {
  const applicant = manageDashboardState.applicants.find((entry) => entry.id === applicantId);
  if (!applicant || normalizeApplicantStatus(applicant.status) !== "pending") return;

  const activeCourseId = manageDashboardState.courseId;
  const activeCourse = manageDashboardState.course;
  const courseTitle = String(activeCourse?.title || "Untitled Course").trim() || "Untitled Course";
  const studentName = String(applicant.studentName || "student").trim() || "student";

  if (action === "approve") {
    const hasCapacity = await validateSeatAvailabilityBeforeApproval(activeCourseId);
    if (!hasCapacity) {
      alert("No seats available");
      showManageFeedback("No seats available", "error");
      return;
    }
  }

  manageDashboardState.actionInFlightId = applicantId;
  renderApplicants();
  clearManageFeedback();

  try {
    const courseRef = doc(db, "courses", activeCourseId);
    const enrollmentRef = doc(db, "enrollments", applicantId);

    await runTransaction(db, async (transaction) => {
      const enrollmentSnap = await transaction.get(enrollmentRef);
      const courseSnap = await transaction.get(courseRef);

      if (!enrollmentSnap.exists()) {
        throw new Error("Applicant record not found.");
      }

      if (!courseSnap.exists()) {
        throw new Error("Course not found.");
      }

      const latestEnrollment = enrollmentSnap.data() || {};
      const latestCourse = courseSnap.data() || {};
      const currentStatus = normalizeApplicantStatus(latestEnrollment.status);

      if (currentStatus !== "pending") {
        throw new Error("This application has already been reviewed.");
      }

      const reviewedAt = new Date().toISOString();

      if (action === "approve") {
        // Pending applications already reserve a seat when proof is submitted,
        // so we validate capacity excluding the current pending reservation.
        if (!hasSeatCapacityForApproval(latestCourse, currentStatus)) {
          throw new Error("No seats available");
        }

        transaction.update(enrollmentRef, {
          status: "approved",
          reviewedAt
        });
      } else {
        transaction.update(enrollmentRef, {
          status: "rejected",
          reviewedAt
        });

        transaction.update(courseRef, {
          seatsFilled: increment(-1)
        });
      }
    });

    await refreshManagedCourse(activeCourseId);

    if (manageDashboardState.courseId === activeCourseId) {
      await loadManageApplicants(activeCourseId);
    }

    if (applicant.studentId) {
      await addTutoringNotification(
        applicant.studentId,
        action === "approve"
          ? "Your booking has been approved"
          : "Your booking has been rejected",
        {
          type: action === "approve" ? "tutoring_booking_approved" : "tutoring_booking_rejected",
          courseId: activeCourseId,
          enrollmentId: applicantId
        }
      );
    }

    await Promise.allSettled([
      applicant.studentId
        ? addTutoringTransaction(
          applicant.studentId,
          action === "approve"
            ? `Tutoring booking approved: ${courseTitle}`
            : `Tutoring booking rejected: ${courseTitle}`,
          {
            type: action === "approve" ? "tutoring_booking_approved" : "tutoring_booking_rejected",
            courseId: activeCourseId,
            courseTitle,
            enrollmentId: applicantId
          }
        )
        : Promise.resolve(false),
      manageDashboardState.course?.tutorId
        ? addTutoringTransaction(
          manageDashboardState.course.tutorId,
          action === "approve"
            ? `Approved tutoring booking for ${studentName}`
            : `Rejected tutoring booking for ${studentName}`,
          {
            type: action === "approve" ? "tutoring_booking_approved_by_tutor" : "tutoring_booking_rejected_by_tutor",
            courseId: activeCourseId,
            courseTitle,
            enrollmentId: applicantId
          }
        )
        : Promise.resolve(false)
    ]);

    showManageFeedback(
      action === "approve"
        ? "Applicant approved successfully."
        : "Applicant rejected and the reserved seat was released.",
      "success"
    );
  } catch (error) {
    console.error("Failed to update applicant:", error);
    showManageFeedback(error.message || "Failed to update this applicant.", "error");
  } finally {
    manageDashboardState.actionInFlightId = "";
    renderApplicants();
  }
}

async function markApplicantAttendance(applicantId) {
  const applicant = manageDashboardState.applicants.find((entry) => entry.id === applicantId);
  if (!applicant || normalizeApplicantStatus(applicant.status) !== "approved") return;

  const activeCourseId = manageDashboardState.courseId;
  manageDashboardState.attendanceInFlightId = applicantId;
  clearManageFeedback();
  renderApplicants();

  try {
    const currentUser = auth.currentUser || await waitForInitialAuthState();
    if (!currentUser) {
      throw new Error("You must be signed in as the tutor to mark attendance.");
    }

    const courseRef = doc(db, "courses", activeCourseId);
    const enrollmentRef = doc(db, "enrollments", applicantId);

    const nextAttendanceCount = await runTransaction(db, async (transaction) => {
      const courseSnap = await transaction.get(courseRef);
      const enrollmentSnap = await transaction.get(enrollmentRef);

      if (!courseSnap.exists()) {
        throw new Error("Course not found.");
      }

      if (!enrollmentSnap.exists()) {
        throw new Error("Student enrollment not found.");
      }

      const latestCourse = courseSnap.data() || {};
      const latestEnrollment = enrollmentSnap.data() || {};

      if (latestCourse.tutorId !== currentUser.uid) {
        throw new Error("Only the course tutor can update attendance.");
      }

      if (normalizeApplicantStatus(latestEnrollment.status) !== "approved") {
        throw new Error("Attendance can only be marked for approved students.");
      }

      const attendanceCount = normalizeCount(latestEnrollment.attendanceCount);
      const totalSessions = getCourseTotalSessions(latestCourse);
      if (totalSessions > 0 && attendanceCount >= totalSessions) {
        throw new Error("This student has already reached the total session count.");
      }

      const updatedAttendanceCount = attendanceCount + 1;
      transaction.update(enrollmentRef, {
        attendanceCount: updatedAttendanceCount,
        lastAttendanceMarkedAt: new Date().toISOString()
      });

      return updatedAttendanceCount;
    });

    manageDashboardState.applicants = manageDashboardState.applicants.map((entry) => (
      entry.id === applicantId
        ? { ...entry, attendanceCount: nextAttendanceCount }
        : entry
    ));

    renderApplicants();
    showManageFeedback(`Attendance marked for ${applicant.studentDisplayId || applicant.studentName}.`, "success");
  } catch (error) {
    console.error("Failed to mark attendance:", error);
    showManageFeedback(error.message || "Failed to update attendance.", "error");
  } finally {
    manageDashboardState.attendanceInFlightId = "";
    renderApplicants();
  }
}

async function saveManagedCourseSettings(event) {
  event.preventDefault();

  if (!manageDashboardState.courseId || !manageDashboardState.course) return;

  const descriptionField = document.getElementById("manageCourseDescription");
  const priceField = document.getElementById("manageCoursePrice");
  const seatsField = document.getElementById("manageCourseSeats");
  const totalSessionsField = document.getElementById("manageCourseTotalSessions");
  const startDateField = document.getElementById("manageCourseStartDate");
  const statusField = document.getElementById("manageCourseStatus");
  const isCertifiedField = document.getElementById("manageIsCertified");
  const isFeaturedField = document.getElementById("manageIsFeatured");
  const qrCodeField = document.getElementById("manageQrCodeUpload");
  const imageField = document.getElementById("manageCourseImageUpload");
  const saveBtn = document.getElementById("saveCourseChangesBtn");

  if (!descriptionField || !priceField || !seatsField || !totalSessionsField || !statusField || !saveBtn) return;

  const description = descriptionField.value.trim();
  const price = Number(priceField.value);
  const totalSeats = parseInt(seatsField.value, 10);
  const totalSessions = parseInt(totalSessionsField.value, 10);
  const startDate = startDateField ? startDateField.value.trim() : "";
  const status = statusField.value;
  const isCertified = Boolean(isCertifiedField?.checked);
  const isFeatured = Boolean(isFeaturedField?.checked);
  const qrCodeFile = qrCodeField && qrCodeField.files ? qrCodeField.files[0] : null;
  const imageFile = imageField && imageField.files ? imageField.files[0] : null;
  const qrCodeShouldRemove = !qrCodeFile && manageDashboardState.assetRemovals?.qrCode === true;
  const imageShouldRemove = !imageFile && manageDashboardState.assetRemovals?.image === true;
  const reservedSeats = Math.max(Number(manageDashboardState.course.seatsFilled) || 0, 0);
  const highestAttendanceCount = manageDashboardState.applicants.reduce(
    (highest, applicant) => Math.max(highest, normalizeCount(applicant.attendanceCount)),
    0
  );
  const originalText = saveBtn.textContent;

  clearManageFeedback();

  if (!description) {
    showManageFeedback("Description is required.", "error");
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    showManageFeedback("Price must be 0 or greater.", "error");
    return;
  }

  if (!Number.isInteger(totalSeats) || totalSeats < 1) {
    showManageFeedback("Total seats must be at least 1.", "error");
    return;
  }

  if (!Number.isInteger(totalSessions) || totalSessions < 0) {
    showManageFeedback("Total sessions must be 0 or greater.", "error");
    return;
  }

  if (totalSeats < reservedSeats) {
    showManageFeedback("Total seats cannot be lower than the number of reserved seats.", "error");
    return;
  }

  if (totalSessions > 0 && totalSessions < highestAttendanceCount) {
    showManageFeedback("Total sessions cannot be lower than the highest recorded attendance count.", "error");
    return;
  }

  try {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    let qrCodeUrl = qrCodeShouldRemove ? "" : (manageDashboardState.course.qrCode || "");
    let imageUrl = imageShouldRemove ? "" : getCourseImageUrl(manageDashboardState.course);

    if (qrCodeFile || imageFile) {
      if (qrCodeFile && imageFile) {
        saveBtn.textContent = "Uploading assets...";
      } else if (imageFile) {
        saveBtn.textContent = "Preparing image...";
      } else {
        saveBtn.textContent = "Uploading QR Code...";
      }
    }

    [qrCodeUrl, imageUrl] = await Promise.all([
      qrCodeFile
        ? uploadCourseAsset(qrCodeFile, "courseQRCodes", manageDashboardState.courseId)
        : Promise.resolve(qrCodeUrl),
      imageFile
        ? uploadCourseAsset(imageFile, "courseImages", manageDashboardState.courseId, {
          optimizeImage: true,
          maxWidth: 1800,
          maxHeight: 1800,
          quality: 0.82
        })
        : Promise.resolve(imageUrl)
    ]);

    saveBtn.textContent = "Saving...";

    const courseUpdate = {
      description,
      price,
      totalSeats,
      totalSessions,
      startDate,
      qrCode: qrCodeUrl,
      image: imageUrl,
      imageUrl: imageUrl || "",
      status,
      isCertified,
      isFeatured,
      updatedAt: new Date().toISOString()
    };

    if (imageShouldRemove) {
      courseUpdate.coverImage = "";
      courseUpdate.thumbnailUrl = "";
      courseUpdate.thumbnail = "";
    }

    await updateDoc(doc(db, "courses", manageDashboardState.courseId), courseUpdate);

    manageDashboardState.course = {
      ...manageDashboardState.course,
      ...courseUpdate
    };

    syncManagedCourseCollection(manageDashboardState.course);
    manageDashboardState.courses = sortManagedCourses(manageDashboardState.courses);
    renderManageCourseTiles();
    renderManageOverview();
    populateManageSettingsForm();
    showManageFeedback("Course settings updated successfully.", "success");
  } catch (error) {
    console.error("Failed to save course settings:", error);
    showManageFeedback("Failed to save course settings. Please try again.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
  }
}

function switchManageTab(targetId) {
  const root = getManageRoot();
  if (!root) return;

  root.querySelectorAll(".tab-btn").forEach((button) => {
    const isActive = button.dataset.tabTarget === targetId;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  root.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.hidden = panel.id !== targetId;
  });
}

function bindManageDashboardEvents() {
  const root = getManageRoot();
  if (!root || root.__manageDashboardEventsBound === true) return;

  root.__manageDashboardEventsBound = true;

  root.addEventListener("click", async (event) => {
    const selectCourseBtn = event.target.closest("[data-manage-select-id]");
    if (selectCourseBtn) {
      event.preventDefault();
      event.stopPropagation();

      const nextCourseId = selectCourseBtn.dataset.manageSelectId;
      if (nextCourseId) {
        clearManageFeedback();
        await selectManagedCourse(nextCourseId, { resetTab: true });
      }
      return;
    }

    const courseTile = event.target.closest("[data-manage-course-id]");
    if (courseTile) {
      event.preventDefault();
      openCourseSession(courseTile.dataset.manageCourseId);
      return;
    }

    const tabBtn = event.target.closest(".tab-btn");
    if (tabBtn) {
      switchManageTab(tabBtn.dataset.tabTarget);
      return;
    }

    const filterBtn = event.target.closest("[data-filter-status]");
    if (filterBtn) {
      manageDashboardState.filter = filterBtn.dataset.filterStatus || "all";
      renderApplicants();
      return;
    }

    const proofBtn = event.target.closest("[data-proof-id]");
    if (proofBtn) {
      openPaymentProofModal(proofBtn.dataset.proofId);
      return;
    }

    const actionBtn = event.target.closest("[data-applicant-action]");
    if (actionBtn) {
      const applicantId = actionBtn.dataset.applicantId;
      const action = actionBtn.dataset.applicantAction;
      if (applicantId && action) {
        await handleApplicantDecision(applicantId, action);
      }
      return;
    }

    const attendanceBtn = event.target.closest("[data-attendance-id]");
    if (attendanceBtn) {
      const applicantId = attendanceBtn.dataset.attendanceId;
      if (applicantId) {
        await markApplicantAttendance(applicantId);
      }
    }
  });

  root.addEventListener("keydown", (event) => {
    const courseTile = event.target.matches("[data-manage-course-id]") ? event.target : null;
    if (!courseTile || !["Enter", " "].includes(event.key)) return;

    event.preventDefault();
    openCourseSession(courseTile.dataset.manageCourseId);
  });

  const settingsForm = document.getElementById("courseSettingsForm");
  if (settingsForm) {
    settingsForm.addEventListener("submit", saveManagedCourseSettings);
  }

  const qrCodeField = document.getElementById("manageQrCodeUpload");
  if (qrCodeField) {
    qrCodeField.addEventListener("change", () => {
      manageDashboardState.assetRemovals.qrCode = false;
      refreshManageAssetControl("qrCode");
    });
  }

  const imageField = document.getElementById("manageCourseImageUpload");
  if (imageField) {
    imageField.addEventListener("change", () => {
      manageDashboardState.assetRemovals.image = false;
      refreshManageAssetControl("image");
    });
  }

  const manageQrCodeActionBtn = document.getElementById("manageQrCodeActionBtn");
  if (manageQrCodeActionBtn) {
    manageQrCodeActionBtn.addEventListener("click", () => {
      toggleManageAssetRemoval("qrCode");
    });
  }

  const manageCourseImageActionBtn = document.getElementById("manageCourseImageActionBtn");
  if (manageCourseImageActionBtn) {
    manageCourseImageActionBtn.addEventListener("click", () => {
      toggleManageAssetRemoval("image");
    });
  }

  const closeProofModalBtn = document.getElementById("closeProofModalBtn");
  if (closeProofModalBtn) {
    closeProofModalBtn.addEventListener("click", closePaymentProofModal);
  }

  const proofModal = document.getElementById("paymentProofModal");
  if (proofModal) {
    proofModal.addEventListener("click", (event) => {
      if (event.target === proofModal) {
        closePaymentProofModal();
      }
    });
  }
}

async function loadManageDashboard() {
  const root = getManageRoot();
  if (!root) return;

  bindManageDashboardEvents();
  clearManageFeedback();
  manageDashboardState.actionInFlightId = "";
  manageDashboardState.attendanceInFlightId = "";
  setManageShellState("loading", "Loading courses", "Fetching the courses you created and preparing the dashboard.");

  try {
    const currentUser = await waitForInitialAuthState();
    if (!currentUser) {
      setManageShellState("error", "Login required", "You must be signed in as the course owner to access this page.");
      return;
    }

    const createdCoursesSnap = await getDocs(
      query(collection(db, "courses"), where("tutorId", "==", currentUser.uid))
    );

    manageDashboardState.courses = sortManagedCourses(
      createdCoursesSnap.docs.map((courseDoc) => ({
        id: courseDoc.id,
        ...courseDoc.data()
      }))
    );
    manageDashboardState.courses = await reconcileManagedCoursesSeatUsage(manageDashboardState.courses);
    await loadCourseReviewSummaryMap(manageDashboardState.courses.map((course) => course.id));

    renderManageCourseTiles();

    if (manageDashboardState.courses.length === 0) {
      manageDashboardState.courseId = "";
      manageDashboardState.course = null;
      manageDashboardState.applicants = [];
      manageDashboardState.attendanceInFlightId = "";
      setManageShellState("empty", "No courses created yet", "Create your first course to unlock the management dashboard for applicants, seats, and settings.");
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const requestedCourseId = (urlParams.get("id") || localStorage.getItem("selectedCourse") || "").trim();
    const fallbackCourseId = manageDashboardState.courses[0]?.id || "";
    const initialCourseId = manageDashboardState.courses.some((course) => course.id === requestedCourseId)
      ? requestedCourseId
      : fallbackCourseId;

    await selectManagedCourse(initialCourseId, { resetTab: true });
  } catch (error) {
    console.error("Failed to load manage dashboard:", error);
    setManageShellState("error", "Unable to load dashboard", "Something went wrong while opening your course dashboard. Please try again.");
  }
}

loadSessionPage();
loadManageDashboard();
loadMyLearningPage();

document.addEventListener("DOMContentLoaded", () => {
  const submitProofBtn = document.getElementById("submitProofBtn");
  const proofUpload = document.getElementById("proofUpload");
  const paymentModal = document.getElementById("paymentModal");

  if (!submitProofBtn) return;

  submitProofBtn.addEventListener("click", async (event) => {
    event.preventDefault();

    const user = auth.currentUser || await waitForInitialAuthState();
    if (!user) {
      alert("You must be logged in to book a seat.");
      return;
    }

    let targetCourseId = paymentModal ? paymentModal.getAttribute("data-course-id") : null;
    if (!targetCourseId) {
      const urlParams = new URLSearchParams(window.location.search);
      targetCourseId = urlParams.get("id");
    }

    if (!targetCourseId) {
      alert("Course identification failed.");
      return;
    }

    const originalButtonHTML = submitProofBtn.innerHTML;

    try {
      submitProofBtn.textContent = "Submitting...";
      submitProofBtn.disabled = true;

      const enrollmentsRef = collection(db, "enrollments");
      const dupQuery = query(
        enrollmentsRef,
        where("courseId", "==", targetCourseId),
        where("studentId", "==", user.uid)
      );
      const dupSnap = await getDocs(dupQuery);

      if (!dupSnap.empty) {
        alert("Already enrolled");
        return;
      }

      const courseRefDoc = doc(db, "courses", targetCourseId);
      const latestCourseSnap = await getDoc(courseRefDoc);
      if (!latestCourseSnap.exists()) {
        alert("Course not found.");
        return;
      }

      const latestData = latestCourseSnap.data();
      const courseTitle = String(latestData.title || "Untitled Course").trim() || "Untitled Course";
      const coursePrice = Number(latestData.price) || 0;
      const freeCourse = isFreeCourse(latestData);
      const proofFile = proofUpload && proofUpload.files ? proofUpload.files[0] : null;
      if (!freeCourse && !proofFile) {
        alert("Please upload your payment screenshot before submitting.");
        return;
      }
      if (isTutorOwnCourse(latestData, user)) {
        alert("You cannot book your own course.");
        return;
      }

      const filled = Math.max(Number(latestData.seatsFilled) || 0, 0);
      const max = Math.max(Number(latestData.totalSeats) || 0, 0);
      if (!isCourseOpenForApplicants(latestData)) {
        alert("This course is closed for new applicants.");
        return;
      }

      if (filled >= max) {
        alert("No seats available");
        return;
      }

      let proofUrl = "";
      if (!freeCourse && proofFile) {
        const storageRefPayload = ref(storage, `paymentProofs/${Date.now()}_${proofFile.name}`);
        const uploadSnapshot = await uploadBytes(storageRefPayload, proofFile);
        proofUrl = await getDownloadURL(uploadSnapshot.ref);
      }
      const { studentDisplayId } = await getNextStudentDisplayId(targetCourseId);

      const enrollmentRef = await addDoc(enrollmentsRef, {
        courseId: targetCourseId,
        studentId: user.uid,
        studentDisplayId,
        attendanceCount: 0,
        status: "pending",
        paymentProof: proofUrl,
        enrolledAt: new Date().toISOString()
      });

      await updateDoc(courseRefDoc, {
        seatsFilled: increment(1)
      });

      const updatedCourseSnap = await getDoc(courseRefDoc);
      const updatedCourseData = updatedCourseSnap.exists()
        ? updatedCourseSnap.data() || {}
        : latestData;
      const updatedFilled = Math.max(Number(updatedCourseData.seatsFilled) || 0, 0);
      const updatedMax = Math.max(Number(updatedCourseData.totalSeats) || 0, max);

      await addTutoringNotification(
        user.uid,
        freeCourse ? "Free enrollment request submitted. Waiting for approval." : "Booking submitted. Waiting for approval.",
        {
          type: "tutoring_booking_submitted",
          courseId: targetCourseId,
          enrollmentId: enrollmentRef.id
        }
      );

      await Promise.allSettled([
        addTutoringTransaction(
          user.uid,
          `Tutoring booking submitted: ${courseTitle}`,
          {
            type: "tutoring_booking_submitted",
            courseId: targetCourseId,
            courseTitle,
            enrollmentId: enrollmentRef.id,
            amount: coursePrice
          }
        ),
        latestData.tutorId
          ? addTutoringTransaction(
            latestData.tutorId,
            `New tutoring booking: ${courseTitle}`,
            {
              type: "tutoring_booking_received",
              courseId: targetCourseId,
              courseTitle,
              enrollmentId: enrollmentRef.id,
              amount: coursePrice
            }
          )
          : Promise.resolve(false)
      ]);

      const displaySeats = document.getElementById("displaySeats");
      if (displaySeats) {
        displaySeats.textContent = `${updatedFilled} / ${updatedMax}`;
      }

      const displayStatusBadge = document.getElementById("displayStatusBadge");
      if (displayStatusBadge && updatedMax > 0 && updatedFilled >= updatedMax) {
        displayStatusBadge.textContent = "CLOSED";
        displayStatusBadge.className = "status-badge completed";
      }

      const openModalBtn = document.getElementById("openModalBtn");
      const actionDesc = document.getElementById("actionDesc");
      if (openModalBtn && updatedMax > 0 && updatedFilled >= updatedMax) {
        openModalBtn.disabled = true;
        openModalBtn.classList.remove("btn-primary-full");
        openModalBtn.classList.add("btn-disabled-full");
        openModalBtn.innerHTML = `<i class="fa-solid fa-users-slash"></i> Course Full`;
        openModalBtn.dataset.action = "full";
        if (actionDesc) actionDesc.textContent = "All seats for this course are currently filled.";
      }

      const memoryCourse = allCoursesData.find((entry) => entry.id === targetCourseId);
      if (memoryCourse) {
        memoryCourse.seatsFilled = updatedFilled;
      }

      if (courseGrid) {
        fetchAndRenderCourses();
      }

      localStorage.setItem("selectedCourse", targetCourseId);

      if (sessionPageState.courseId === targetCourseId) {
        sessionPageState.currentUser = user;
        sessionPageState.course = sessionPageState.course
          ? { ...sessionPageState.course, seatsFilled: updatedFilled }
          : { id: targetCourseId, ...updatedCourseData };
        sessionPageState.currentEnrollment = {
          id: enrollmentRef.id,
          courseId: targetCourseId,
          studentId: user.uid,
          studentDisplayId,
          attendanceCount: 0,
          status: "pending",
          paymentProof: proofUrl,
          enrolledAt: new Date().toISOString()
        };

        applySessionEnrollmentState(sessionPageState.course, user, sessionPageState.currentEnrollment);
        renderSessionReviewSection();
      }

      alert(freeCourse ? "Free enrollment request submitted. Waiting for approval." : "Booking submitted. Waiting for approval.");

      if (paymentModal) paymentModal.classList.remove("active");
      resetPaymentProofUploadState();
    } catch (error) {
      console.error("Booking verification execution failed:", error);
      alert("Booking failed. Please check your connection.");
    } finally {
      submitProofBtn.innerHTML = originalButtonHTML;
      submitProofBtn.disabled = false;
    }
  });
});
