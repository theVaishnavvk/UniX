
    import { auth, db } from "./firebase.js";
    import { askGemini } from "./ai.js";

    import {
      onAuthStateChanged,
      signOut
    } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

    import {
      doc,
      getDoc,
      collection,
      getDocs,
      addDoc,
      setDoc,
      updateDoc,
      onSnapshot,
      deleteDoc,
      runTransaction,
      writeBatch,
      query,
      where,
      increment,
      orderBy,
      limit,
      serverTimestamp
    } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

    let unsubscribeUserPoints;
    let unsubscribePointNotifications;
    let unsubscribeBadgeRequests;
    let unsubscribeBadgeApplications;
    let unsubscribeRequests;
    const applicationUnsubs = new Map();
    const tutoringBookingUnsubs = [];
    const userNameCache = new Map();
    const userProfileCache = new Map();
    const DEFAULT_AVATAR_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#e5e7eb'/><stop offset='100%' stop-color='#d1d5db'/></linearGradient></defs><circle cx='32' cy='32' r='32' fill='url(#g)'/><circle cx='32' cy='24' r='12' fill='#9ca3af'/><path d='M14 52c2-10 10-16 18-16s16 6 18 16' fill='#9ca3af'/></svg>"
    )}`;
    let usersDocReadBlocked = false;
    let usersCollectionReadBlocked = false;
    let hasLoggedUsersDocBlock = false;
    let hasLoggedUsersCollectionBlock = false;
    const PREFER_PUBLIC_USERS_READS = false;
    let toastHideTimer = null;
    let toastRemoveTimer = null;
    let activeToastEl = null;
    let currentXP = 0;
    let appliedRequestsCache = [];
    let myRequestsStatusFilter = "open";
    let appliedStatusFilter = "pending";
    let applyRequestFiltersAndSort = () => {};
    let unreadNotificationsPrimed = false;
    const unreadNotificationSeenIds = new Set();
    const tutoringBookingNotificationCacheKey = "unix_skills_tutor_booking_notified_sessions";
    const WEEKLY_XP_GOAL = 200;
    const XP_REWARD_APPLY_REQUEST = 2;
    const NON_REWARD_POINT_SOURCES = new Set([
      "request_reward_paid"
    ]);
    const BADGE_DEFINITIONS = [
      {
        id: "request_initiator",
        label: "Request Initiator",
        icon: "fa-flag-checkered",
        description: "Create 3 requests.",
        unlockHint: "Create 3 requests to unlock.",
        requirements: [
          { key: "createdCount", label: "Progress", target: 3, suffix: "requests created" }
        ],
        isUnlocked: (stats) => stats.createdCount >= 3
      },
      {
        id: "task_finisher",
        label: "Task Finisher",
        icon: "fa-check-double",
        description: "Complete 2 of your requests.",
        unlockHint: "Complete 2 requests you created.",
        requirements: [
          { key: "completedCount", label: "Progress", target: 2, suffix: "requests completed" }
        ],
        isUnlocked: (stats) => stats.completedCount >= 2
      },
      {
        id: "trusted_helper",
        label: "Trusted Helper",
        icon: "fa-handshake",
        description: "Get accepted on 3 applications.",
        unlockHint: "Get accepted on 3 applications.",
        requirements: [
          { key: "helpedCount", label: "Progress", target: 3, suffix: "accepted applications" }
        ],
        isUnlocked: (stats) => stats.helpedCount >= 3
      },
      {
        id: "reliable_contributor",
        label: "Reliable Contributor",
        icon: "fa-shield-heart",
        description: "Help 5 times and complete 3 requests.",
        unlockHint: "Reach 5 helps and 3 completed requests.",
        requirements: [
          { key: "helpedCount", label: "Helps", target: 5, suffix: "helps" },
          { key: "completedCount", label: "Requests Completed", target: 3, suffix: "requests completed" }
        ],
        isUnlocked: (stats) => stats.helpedCount >= 5 && stats.completedCount >= 3
      },
      {
        id: "consistency_streak",
        label: "Consistency Streak",
        icon: "fa-fire",
        description: "Keep a 7-day streak and 2 accepted helps.",
        unlockHint: "Maintain a 7-day streak and help twice.",
        requirements: [
          { key: "streak", label: "Streak", target: 7, suffix: "day streak" },
          { key: "helpedCount", label: "Helps", target: 2, suffix: "accepted helps" }
        ],
        isUnlocked: (stats) => stats.streak >= 7 && stats.helpedCount >= 2
      },
      {
        id: "weekly_warrior",
        label: "Weekly Warrior",
        icon: "fa-bolt",
        description: "14-day streak and 5 accepted helps.",
        unlockHint: "Maintain a 14-day streak and help 5 times.",
        requirements: [
          { key: "streak", label: "Streak", target: 14, suffix: "day streak" },
          { key: "helpedCount", label: "Helps", target: 5, suffix: "accepted helps" }
        ],
        isUnlocked: (stats) => stats.streak >= 14 && stats.helpedCount >= 5
      },
      {
        id: "campus_expert",
        label: "Campus Expert",
        icon: "fa-graduation-cap",
        description: "1200 points, 8 helps, and 5 completions.",
        unlockHint: "Reach 1200 points, 8 helps, and 5 completions.",
        requirements: [
          { key: "points", label: "Points", target: 1200, suffix: "points" },
          { key: "helpedCount", label: "Helps", target: 8, suffix: "helps" },
          { key: "completedCount", label: "Completions", target: 5, suffix: "completions" }
        ],
        isUnlocked: (stats) => stats.points >= 1200 && stats.helpedCount >= 8 && stats.completedCount >= 5
      },
      {
        id: "community_hero",
        label: "Community Hero",
        icon: "fa-trophy",
        description: "2000 points, 12 helps, and 14-day streak.",
        unlockHint: "Reach 2000 points, 12 helps, and a 14-day streak.",
        requirements: [
          { key: "points", label: "Points", target: 2000, suffix: "points" },
          { key: "helpedCount", label: "Helps", target: 12, suffix: "helps" },
          { key: "streak", label: "Streak", target: 14, suffix: "day streak" }
        ],
        isUnlocked: (stats) => stats.points >= 2000 && stats.helpedCount >= 12 && stats.streak >= 14
      }
    ];
    let progressInsightsRefreshTimer = null;
    let latestProgressStats = {
      createdCount: 0,
      completedCount: 0,
      helpedCount: 0,
      streak: 0,
      points: 0
    };

    function readSessionNotificationCache() {
      try {
        const raw = localStorage.getItem(tutoringBookingNotificationCacheKey);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((id) => String(id || "").trim()).filter(Boolean));
      } catch (error) {
        return new Set();
      }
    }

    const tutoringSessionNotifiedIds = readSessionNotificationCache();

    function persistSessionNotificationCache() {
      try {
        const recent = Array.from(tutoringSessionNotifiedIds).slice(-300);
        localStorage.setItem(tutoringBookingNotificationCacheKey, JSON.stringify(recent));
      } catch (error) {
        // Ignore storage errors for privacy mode/blocked storage.
      }
    }

    function markSessionNotificationSent(sessionId) {
      const normalized = String(sessionId || "").trim();
      if (!normalized) return;
      tutoringSessionNotifiedIds.add(normalized);
      persistSessionNotificationCache();
    }

    function hasSessionNotificationBeenSent(sessionId) {
      const normalized = String(sessionId || "").trim();
      if (!normalized) return false;
      return tutoringSessionNotifiedIds.has(normalized);
    }

    // XP thresholds for each level
    const BASE_XP = 1000;
    const XP_PER_LEVEL = 900;
    const MAX_LEVEL = 10;

    function getLevelMetrics(xpValue = currentXP) {
      let safeXP = Number(xpValue);
      if (!Number.isFinite(safeXP) || safeXP < BASE_XP) {
        safeXP = BASE_XP;
      }

      let level = Math.floor((safeXP - BASE_XP) / XP_PER_LEVEL);
      if (level < 0) level = 0;
      if (level > MAX_LEVEL) level = MAX_LEVEL;

      const currentLevelXP = BASE_XP + (level * XP_PER_LEVEL);
      const nextLevelXP = level < MAX_LEVEL
        ? BASE_XP + ((level + 1) * XP_PER_LEVEL)
        : currentLevelXP;

      const progress = level < MAX_LEVEL
        ? (safeXP / nextLevelXP) * 100
        : 100;

      return {
        currentXP: safeXP,
        level,
        currentLevelXP,
        nextLevelXP,
        progress: Math.max(0, Math.min(progress, 100)),
        isMax: level >= MAX_LEVEL
      };
    }

    function updateLevel() {
      const levelTitle = document.getElementById("dashboardLevelTitle");
      const progressFill = document.getElementById("dashboardLevelFill");
      if (!levelTitle || !progressFill) return;

      const levelRequirement = 1900;
      const progressPercent = Math.max(0, Math.min(100, Math.floor((currentXP / levelRequirement) * 100)));
      progressFill.style.width = progressPercent + "%";

      levelTitle.textContent = currentXP >= levelRequirement ? "Level 1" : "Level 0";

      renderProgressLevelCard(latestProgressStats);
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
      for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      const email = data?.email;
      if (typeof email === "string" && email.includes("@")) {
        return email.split("@")[0];
      }
      return "User";
    }

    function resolveUserScore(data) {
      const candidates = [
        data?.points,
        data?.xp,
        data?.totalPoints,
        data?.score
      ];
      for (const value of candidates) {
        const num = Number(value);
        if (Number.isFinite(num)) return num;
      }
      return 0;
    }

    function isLikelyResolvedName(name) {
      if (!name || typeof name !== "string") return false;
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (/^user$/i.test(trimmed)) return false;
      if (/^user\s+[a-z0-9]{3,}$/i.test(trimmed)) return false;
      return true;
    }

    function isPermissionDenied(error) {
      return error?.code === "permission-denied" || String(error?.message || "").toLowerCase().includes("insufficient permissions");
    }

    async function syncCurrentUserPublicProfile(userId) {
      if (!userId) return;
      try {
        const userSnap = await getDoc(doc(db, "users", userId));
        if (!userSnap.exists()) return;
        const userData = userSnap.data() || {};
        await setDoc(doc(db, "publicUsers", userId), {
          name: resolveDisplayName(userData, ""),
          photoURL: getUserAvatarUrl(userData) || null,
          tagline: normalizeText(userData?.tagline, "") || null,
          role: normalizeText(userData?.role, "") || null
        }, { merge: true });
      } catch (err) {
        // If users read is blocked, we cannot backfill from here.
      }
    }



    function normalizeStatus(value) {
      const normalized = String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[_\s]+/g, "-");

      if (normalized === "canceled") return "cancelled";
      if (normalized === "inprogress") return "in-progress";

      const allowed = new Set(["open", "pending", "in-progress", "completed", "cancelled"]);
      return allowed.has(normalized) ? normalized : "open";
    }

    function normalizeUrgency(value) {
      const token = String(value || "").toLowerCase().trim();
      const allowed = new Set(["low", "medium", "high"]);
      return allowed.has(token) ? token : "low";
    }

    function formatLocalDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function normalizeToastType(type) {
      const token = String(type || "").toLowerCase().trim();
      if (token === "success" || token === "error" || token === "info") return token;
      return "info";
    }

    function showToast(message, type = "info", options = {}) {
      const toastHost = document.getElementById("toastHost");
      if (!toastHost) return;

      const normalizedType = normalizeToastType(type);
      const safeMessage = String(message || "").trim();
      if (!safeMessage) return;

      if (toastHideTimer) {
        clearTimeout(toastHideTimer);
        toastHideTimer = null;
      }
      if (toastRemoveTimer) {
        clearTimeout(toastRemoveTimer);
        toastRemoveTimer = null;
      }
      if (activeToastEl) {
        activeToastEl.remove();
        activeToastEl = null;
      }

      const iconMap = {
        success: "fa-check",
        error: "fa-triangle-exclamation",
        info: "fa-circle-info"
      };

      const toast = document.createElement("div");
      toast.className = `skills-toast skills-toast--${normalizedType}`;
      toast.innerHTML = `
        <span class="skills-toast-icon" aria-hidden="true">
          <i class="fa-solid ${iconMap[normalizedType]}"></i>
        </span>
        <p class="skills-toast-message"></p>
      `;

      const messageEl = toast.querySelector(".skills-toast-message");
      if (messageEl) {
        messageEl.textContent = safeMessage;
      }

      toastHost.appendChild(toast);
      activeToastEl = toast;

      requestAnimationFrame(() => {
        toast.classList.add("is-visible");
      });

      const durationMs = Math.max(1000, Number(options.durationMs) || 3000);
      toastHideTimer = setTimeout(() => {
        toast.classList.remove("is-visible");
        toast.classList.add("is-hiding");
        toastHideTimer = null;
        toastRemoveTimer = setTimeout(() => {
          if (activeToastEl === toast) {
            activeToastEl = null;
          }
          toast.remove();
          toastRemoveTimer = null;
        }, 260);
      }, durationMs);
    }

    function showGlobalToast(message, type = "info") {
      showToast(message, type);
    }

    function pointsMessageFromSource(amount, source) {
      const safeAmount = Number(amount) || 0;
      const absAmount = Math.abs(safeAmount);
      if (source === "apply_request") return `You earned +${absAmount} points for applying to help.`;
      if (source === "create_request") return `You earned +${absAmount} points for creating a request.`;
      if (source === "delete_request") return `${absAmount} points were deducted for deleting your request.`;
      if (source === "request_completed_reward") return `You earned +${absAmount} points for completing a request.`;
      if (source === "cancel_application") return `${absAmount} points were deducted for cancelling your application.`;
      if (safeAmount < 0) return `${absAmount} points were deducted.`;
      return `You earned +${absAmount} points.`;
    }

    function getTransactionPointsValue(data = {}) {
      const candidates = [data?.points, data?.pointsChange, data?.amount];
      for (const value of candidates) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    }

    function isRewardPointsSource(source) {
      const token = String(source || "").trim().toLowerCase();
      if (!token) return true;
      return !NON_REWARD_POINT_SOURCES.has(token);
    }

    function isOnboardingBonusTransaction(data = {}) {
      const source = normalizeFilterToken(data.source || "");
      const type = normalizeFilterToken(data.type || "");
      const title = normalizeFilterToken(data.title || "");
      const category = normalizeFilterToken(data.category || "");
      const points = getTransactionPointsValue(data);

      if (source === "welcome_bonus" || source === "first_login_bonus") return true;
      if (type === "welcome_bonus" || type === "first_login_bonus") return true;
      if (title.includes("welcome bonus") || title.includes("first login")) return true;
      if (!source && category === "skill" && points === 1000 && title.includes("bonus")) return true;
      return false;
    }

    function isBonusPointTransactionForWeeklyXp(data = {}) {
      if (isOnboardingBonusTransaction(data)) return true;
      const source = normalizeFilterToken(data.source || "");
      const type = normalizeFilterToken(data.type || "");
      const title = normalizeFilterToken(data.title || "");
      if (source.includes("bonus")) return true;
      if (type.includes("bonus")) return true;
      if (title.includes("bonus")) return true;
      return false;
    }

    function isCountedXpRewardTransaction(data = {}) {
      const points = getTransactionPointsValue(data);
      if (points <= 0) return false;
      return isRewardPointsSource(data.source);
    }

    function normalizeWeeklyXpEntryText(data = {}) {
      return normalizeFilterToken(
        data.requestTitle ||
        data.title ||
        data.message ||
        data.label ||
        ""
      );
    }

    function buildWeeklyXpEntryKey(data = {}) {
      const source = normalizeFilterToken(data.source || "");
      const points = getTransactionPointsValue(data);
      const minuteBucket = Math.floor(toMillis(data.createdAt) / 60000);
      const textToken = normalizeWeeklyXpEntryText(data);
      return `${source}|${points}|${minuteBucket}|${textToken}`;
    }

    function shouldCountWeeklyXpEntry(data = {}, firstDay) {
      const txDate = toDateObject(data.createdAt);
      if (!txDate || txDate < firstDay) return false;
      if (!isCountedXpRewardTransaction(data)) return false;
      if (isBonusPointTransactionForWeeklyXp(data)) return false;
      return true;
    }

    function buildApplicationDocId(requestId, applicantId) {
      const safeRequestId = String(requestId || "").trim().replace(/\//g, "_");
      const safeApplicantId = String(applicantId || "").trim().replace(/\//g, "_");
      return `${safeRequestId}__${safeApplicantId}`;
    }

    async function buildAppliedRequestsFallback(userId) {
      const resolvedUserId = String(userId || "").trim();
      if (!resolvedUserId) return [];

      const requestMap = new Map();
      const activityMap = new Map();

      const upsertActivity = (requestId, updater) => {
        const normalizedRequestId = String(requestId || "").trim();
        if (!normalizedRequestId) return;
        const existing = activityMap.get(normalizedRequestId) || {
          requestId: normalizedRequestId,
          requestTitle: "",
          applyTs: 0,
          cancelTs: 0,
          approveTs: 0,
          rejectTs: 0,
          latestTs: 0
        };
        updater(existing);
        activityMap.set(normalizedRequestId, existing);
      };

      try {
        const txSnap = await getDocs(
          query(collection(db, "transactions"), where("userId", "==", resolvedUserId), limit(120))
        );

        txSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const source = normalizeFilterToken(data.source || data.type || "");
          const requestId = String(data.requestId || "").trim();
          if (!requestId) return;
          const createdTs = toMillis(data.createdAt);
          const requestTitle = String(data.requestTitle || data.title || "").trim();

          upsertActivity(requestId, (entry) => {
            if (requestTitle && !entry.requestTitle) entry.requestTitle = requestTitle;
            entry.latestTs = Math.max(entry.latestTs, createdTs);
            if (source === "apply-request" || source === "apply_request") {
              entry.applyTs = Math.max(entry.applyTs, createdTs);
            }
            if (source === "cancel-application" || source === "cancel_application") {
              entry.cancelTs = Math.max(entry.cancelTs, createdTs);
            }
          });
        });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Applied requests transaction fallback failed:", error);
        }
      }

      try {
        const notifSnap = await getDocs(
          query(collection(db, "users", resolvedUserId, "notifications"), limit(120))
        );

        notifSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const source = normalizeFilterToken(data.source || data.type || "");
          const requestId = String(data.requestId || "").trim();
          if (!requestId) return;
          const createdTs = toMillis(data.createdAt);

          upsertActivity(requestId, (entry) => {
            entry.latestTs = Math.max(entry.latestTs, createdTs);
            if (source === "request-application-approved" || source === "request_application_approved") {
              entry.approveTs = Math.max(entry.approveTs, createdTs);
            }
            if (source === "request-application-rejected" || source === "request_application_rejected") {
              entry.rejectTs = Math.max(entry.rejectTs, createdTs);
            }
          });
        });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Applied requests notification fallback failed:", error);
        }
      }

      const requestIds = Array.from(activityMap.keys());
      await Promise.all(
        requestIds.map(async (requestId) => {
          try {
            const requestSnap = await getDoc(doc(db, "requests", requestId));
            if (requestSnap.exists()) {
              requestMap.set(requestId, requestSnap.data() || {});
            }
          } catch (error) {
            if (!isPermissionDenied(error)) {
              console.warn("Applied request fallback request load failed:", error);
            }
          }
        })
      );

      return requestIds.map((requestId) => {
        const activity = activityMap.get(requestId) || {};
        const requestData = requestMap.get(requestId) || {};
        const requestStatus = normalizeStatus(requestData.status || "open");
        const helperId = String(
          requestData.helperId ||
          requestData.assignedHelperId ||
          requestData.selectedHelperId ||
          ""
        ).trim();
        const wasApproved =
          activity.approveTs > 0 &&
          activity.approveTs >= activity.rejectTs &&
          activity.approveTs >= activity.cancelTs;
        const hasPendingApply =
          activity.applyTs > 0 &&
          activity.applyTs > activity.cancelTs &&
          activity.applyTs > activity.rejectTs;

        let derivedStatus = "";
        if (helperId === resolvedUserId || wasApproved) {
          derivedStatus = requestStatus === "completed" ? "completed" : "in-progress";
        } else if (hasPendingApply && requestStatus === "open") {
          derivedStatus = "pending";
        } else {
          return null;
        }

        const deadlineRaw = String(requestData.deadline || "");
        return {
          applicationId: buildApplicationDocId(requestId, resolvedUserId),
          requestId,
          title: String(requestData.title || activity.requestTitle || "Request"),
          desc: String(requestData.desc || ""),
          status: derivedStatus,
          requesterId: String(
            requestData.userId ||
            requestData.requesterId ||
            requestData.uid ||
            requestData.createdBy ||
            ""
          ),
          category: normalizeCategoryValue(requestData.category || "other"),
          difficulty: String(requestData.difficulty || "medium").toLowerCase(),
          urgency: String(requestData.urgency || "medium").toLowerCase(),
          points: Number(requestData.points) || 0,
          deadline: deadlineRaw,
          deadlineTs: deadlineRaw ? toMillis(new Date(deadlineRaw)) : 0,
          applicants: 0,
          sortTs: Math.max(
            activity.latestTs || 0,
            toMillis(requestData.updatedAt || requestData.completedAt || requestData.createdAt)
          )
        };
      }).filter(Boolean);
    }

    function normalizeAvailableViewerState(value) {
      const token = String(value || "").toLowerCase().trim().replace(/[_\s]+/g, "-");
      if (token === "applied") return "applied";
      if (token === "in-progress") return "in-progress";
      if (token === "completed") return "completed";
      return "open";
    }

    function resolveAvailableViewerState(requestStatus, applicationStatus = "") {
      const normalizedRequestStatus = normalizeStatus(requestStatus);
      const normalizedApplicationStatus = normalizeFilterToken(applicationStatus);
      if (normalizedRequestStatus === "completed") return "completed";
      if (normalizedRequestStatus === "in-progress") return "in-progress";
      if (normalizedRequestStatus === "open" && normalizedApplicationStatus === "pending") return "applied";
      return "open";
    }

    function setAvailableCardState(card, state) {
      if (!card) return;
      const normalizedState = normalizeAvailableViewerState(state);
      card.dataset.viewerState = normalizedState;

      const statusBadge = card.querySelector(".status-badge");
      if (statusBadge) {
        statusBadge.classList.remove("open", "applied", "in-progress", "completed");
        statusBadge.classList.add("open");
        statusBadge.textContent = "Open";
      }

      const applyBtn = card.querySelector(".apply-btn");
      if (!applyBtn) return;

      applyBtn.classList.remove("applied", "closed");
      applyBtn.dataset.state = normalizedState;
      applyBtn.disabled = false;

      if (normalizedState === "applied") {
        applyBtn.textContent = "Cancel";
        applyBtn.classList.add("applied");
        return;
      }

      if (normalizedState === "in-progress") {
        applyBtn.textContent = "In Progress";
        applyBtn.classList.add("closed");
        applyBtn.disabled = true;
        return;
      }

      if (normalizedState === "completed") {
        applyBtn.textContent = "Completed";
        applyBtn.classList.add("closed");
        applyBtn.disabled = true;
        return;
      }

      applyBtn.textContent = "Apply";
    }

    function setRequestCardStatus(card, status) {
      if (!card) return;
      const normalizedStatus = normalizeStatus(status || "open");
      card.dataset.status = normalizedStatus;
      const statusBadge = card.querySelector(".status-badge");
      if (!statusBadge) return;
      statusBadge.classList.remove("open", "pending", "in-progress", "completed", "cancelled");
      statusBadge.classList.add(normalizedStatus);
      statusBadge.textContent = formatStatusLabel(normalizedStatus);
    }

    function upsertAssignedHelperRow(card, helperId, helperName = "Helper") {
      if (!card) return;

      const normalizedHelperId = String(helperId || "").trim();
      const safeHelperName = escapeHTML(String(helperName || "Helper").trim() || "Helper");
      const safeAvatarUrl = escapeHTML(getSafeAvatarUrl(""));
      const helperChatUid = encodeURIComponent(normalizedHelperId);
      const helperIdentityMarkup = normalizedHelperId
        ? `<a href="profile.html?uid=${helperChatUid}" class="assigned-helper-link">
             <img src="${safeAvatarUrl}" alt="${safeHelperName} avatar" class="assigned-helper-avatar" loading="lazy">
             <span class="assigned-helper-text">${safeHelperName}</span>
           </a>`
        : `<span class="assigned-helper-name-wrap">
             <img src="${safeAvatarUrl}" alt="${safeHelperName} avatar" class="assigned-helper-avatar" loading="lazy">
             <span class="assigned-helper-text">${safeHelperName}</span>
           </span>`;

      const helperRowMarkup = `
        <div class="assigned-helper-row">
          <span class="assigned-helper-label">Helper:</span>
          ${helperIdentityMarkup}
        </div>
      `;

      const existingHelperRow = card.querySelector(".assigned-helper-row");
      if (existingHelperRow) {
        existingHelperRow.outerHTML = helperRowMarkup;
        return;
      }

      const rewardRow = card.querySelector(".request-reward-row");
      if (rewardRow) {
        rewardRow.insertAdjacentHTML("afterend", helperRowMarkup);
        return;
      }

      const applicationsContainer = card.querySelector(".applications-container");
      if (applicationsContainer) {
        applicationsContainer.insertAdjacentHTML("beforebegin", helperRowMarkup);
      }
    }

    function syncAvailableCardsForRequest(requestId, state) {
      const normalizedRequestId = String(requestId || "").trim();
      if (!normalizedRequestId) return;
      document.querySelectorAll(`.request-card[data-id="${normalizedRequestId}"]`).forEach((card) => {
        if (!card.querySelector(".apply-btn")) return;
        setAvailableCardState(card, state);
      });
      applyRequestFiltersAndSort();
    }

    async function createUserNotification(userId, payload = {}) {
      const targetUserId = String(userId || "").trim();
      const message = String(payload.message || "").trim();
      if (!targetUserId || !message) return false;

      try {
        await addDoc(collection(db, "users", targetUserId, "notifications"), {
          ...payload,
          message,
          read: false,
          createdAt: serverTimestamp(),
          module: "skills"
        });
        return true;
      } catch (error) {
        console.error("Notification write failed:", error);
        return false;
      }
    }

    function buildSkillsLoaderMarkup(message = "Loading...") {
      const safeMessage = escapeHTML(String(message || "Loading..."));
      return `
        <div class="logo-loader skills-shared-loader">
          <img src="../images/unixnew.png" alt="UniX" class="logo-loader-img">
          <div class="loader-dots">
            <div class="loader-dot"></div>
            <div class="loader-dot"></div>
            <div class="loader-dot"></div>
          </div>
          <p>${safeMessage}</p>
        </div>
      `;
    }

    function buildSkillsEmptyStateMarkup(options = {}) {
      const iconClass = String(options.iconClass || "fa-box-open").trim() || "fa-box-open";
      const title = escapeHTML(String(options.title || "Nothing here yet."));
      const message = escapeHTML(String(options.message || ""));
      const actionLabelRaw = String(options.actionLabel || "").trim();
      const actionValueRaw = String(options.actionValue || "").trim();

      const actionMarkup = actionLabelRaw
        ? `<button type="button" class="skills-empty-action" data-empty-action="${escapeHTML(actionValueRaw)}">${escapeHTML(actionLabelRaw)}</button>`
        : "";

      return `
        <div class="skills-empty-state">
          <i class="fa-solid ${escapeHTML(iconClass)}"></i>
          <p class="skills-empty-title">${title}</p>
          ${message ? `<p class="skills-empty-desc">${message}</p>` : ""}
          ${actionMarkup}
        </div>
      `;
    }

    function renderListLoading(listEl, message) {
      if (!listEl) return;
      listEl.innerHTML = buildSkillsLoaderMarkup(message);
    }

    function renderListEmpty(listEl, options = {}) {
      if (!listEl) return;
      listEl.innerHTML = buildSkillsEmptyStateMarkup(options);
    }

    function getBadgeRequirementProgressRows(badge = {}, progressStats = {}) {
      const requirements = Array.isArray(badge.requirements) ? badge.requirements : [];
      return requirements.map((requirement) => {
        const statKey = String(requirement.key || "").trim();
        const label = String(requirement.label || "Progress").trim() || "Progress";
        const suffix = String(requirement.suffix || "").trim();
        const rawCurrent = Number(progressStats?.[statKey]);
        const current = Number.isFinite(rawCurrent) ? Math.max(0, rawCurrent) : 0;
        const rawTarget = Number(requirement.target);
        const target = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 1;
        const descriptor = suffix || label.toLowerCase();
        const valueText = `${current} / ${target}${descriptor ? ` ${descriptor}` : ""}`;

        return {
          label,
          valueText,
          current,
          target,
          descriptor
        };
      });
    }

    function buildBadgeCounterMarkup(requirementRow) {
      const safeCurrent = Math.max(0, Number(requirementRow?.current) || 0);
      const safeTarget = Math.max(1, Number(requirementRow?.target) || 1);
      const isComplete = safeCurrent >= safeTarget;
      const descriptor = String(requirementRow?.descriptor || "").trim();
      const descriptorMarkup = descriptor
        ? `<span class="progress-counter-desc"> ${escapeHTML(descriptor)}</span>`
        : "";

      return `
        <span class="progress-counter-current${isComplete ? " complete" : ""}">${escapeHTML(String(safeCurrent))}</span>
        <span class="progress-counter-slash"> / </span>
        <span class="progress-counter-target">${escapeHTML(String(safeTarget))}</span>${descriptorMarkup}
      `;
    }

    function getBadgeStateMeta(unlocked, requirementRows = []) {
      if (unlocked) {
        return { text: "Unlocked", className: "unlocked" };
      }
      const hasProgress = requirementRows.some((row) => Number(row.current) > 0);
      if (hasProgress) {
        return { text: "In Progress", className: "in-progress" };
      }
      return { text: "Locked", className: "locked" };
    }

    function renderBadges(progressStats) {
      const badgeGrid = document.getElementById("badgeGrid");
      if (!badgeGrid) return;

      badgeGrid.innerHTML = "";

      BADGE_DEFINITIONS.forEach((badge) => {
        const unlocked = badge.isUnlocked(progressStats);
        const requirementRows = getBadgeRequirementProgressRows(badge, progressStats);
        const stateMeta = getBadgeStateMeta(unlocked, requirementRows);
        const primaryRequirement = requirementRows[0] || null;
        const primaryCounterMarkup = primaryRequirement
          ? buildBadgeCounterMarkup(primaryRequirement)
          : `
            <span class="progress-counter-current">0</span>
            <span class="progress-counter-slash"> / </span>
            <span class="progress-counter-target">1</span>
            <span class="progress-counter-desc"> progress</span>
          `;
        const hasExtraRequirements = requirementRows.length > 1;
        const extraRequirementsText = hasExtraRequirements
          ? requirementRows
            .slice(1)
            .map((row) => `${row.current} / ${row.target} ${row.descriptor}`)
            .join(" • ")
          : "";
        const badgeDescription = unlocked
          ? badge.description
          : hasExtraRequirements
            ? `Also requires: ${extraRequirementsText}.`
            : badge.unlockHint;
        const chip = document.createElement("div");
        chip.className = `badge-chip progress-badge-chip ${stateMeta.className}`;
        chip.innerHTML = `
          <div class="progress-badge-top">
            <span class="progress-badge-icon"><i class="fa-solid ${escapeHTML(badge.icon)}"></i></span>
            <div class="progress-badge-meta">
              <p class="progress-badge-title">${escapeHTML(badge.label)}</p>
              <p class="progress-badge-state ${escapeHTML(stateMeta.className)}">${escapeHTML(stateMeta.text)}</p>
            </div>
          </div>
          <p class="progress-badge-counter progress-badge-counter-single">${primaryCounterMarkup}</p>
          <p class="progress-badge-desc">${escapeHTML(badgeDescription)}</p>
        `;
        badgeGrid.appendChild(chip);
      });
    }

    function renderProgressLevelCard(_progressStats = latestProgressStats, metricsInput = null) {
      const xpMetaEl = document.getElementById("dashboardLevelXpMeta");
      const progressTextEl = document.getElementById("dashboardLevelProgressText");
      if (!xpMetaEl || !progressTextEl) return;

      const userPoints = currentXP;
      const levelRequirement = 1900;
      const progressPercent = Math.max(0, Math.min(100, Math.floor((userPoints / levelRequirement) * 100)));
      const userPointsDisplay = userPoints.toLocaleString("en-US");
      const levelRequirementDisplay = levelRequirement.toLocaleString("en-US");
      const remainingPointsDisplay = Math.max(0, levelRequirement - userPoints).toLocaleString("en-US");

      xpMetaEl.innerHTML = `
        <span class="level-xp-current">${userPointsDisplay}</span><span class="level-xp-slash"> / </span><span class="level-xp-target">${levelRequirementDisplay}</span> <span class="level-xp-unit">Points</span>
      `;

      progressTextEl.innerHTML = `
        <span class="level-progress-main"><span class="level-progress-percent">${progressPercent}%</span> to Level 1</span>
        <span class="level-progress-sep"> • </span>
        <span class="level-progress-secondary"><span class="level-progress-remaining-value">${remainingPointsDisplay}</span> Points remaining</span>
      `;
    }

    function renderContributionStats(stats = {}) {
      const requestsCompletedEl = document.getElementById("requestsCompletedStat");
      const totalPointsEarnedEl = document.getElementById("totalPointsEarnedStat");
      const successRateEl = document.getElementById("successRateStat");
      const totalPointsEarned = Math.max(0, Number(stats.totalPointsEarned) || 0);

      if (requestsCompletedEl) {
        requestsCompletedEl.textContent = String(Math.max(0, Number(stats.requestsCompleted) || 0));
      }
      if (totalPointsEarnedEl) {
        totalPointsEarnedEl.textContent = totalPointsEarned.toLocaleString("en-US");
      }
      if (successRateEl) {
        const rate = Math.max(0, Math.min(100, Number(stats.successRate) || 0));
        successRateEl.textContent = `${Math.round(rate)}%`;
      }
    }

    function refreshProgressInsights(userId) {
      const resolvedUserId = String(userId || "").trim();
      if (!resolvedUserId) return;
      loadUserBadges(resolvedUserId);
      loadContributionStats(resolvedUserId);
    }

    function scheduleProgressInsightsRefresh(userId, delayMs = 220) {
      const resolvedUserId = String(userId || "").trim();
      if (!resolvedUserId) return;
      if (progressInsightsRefreshTimer) {
        clearTimeout(progressInsightsRefreshTimer);
      }
      progressInsightsRefreshTimer = setTimeout(() => {
        progressInsightsRefreshTimer = null;
        refreshProgressInsights(resolvedUserId);
      }, Math.max(0, Number(delayMs) || 0));
    }

    async function loadContributionStats(userId) {
      if (!userId) {
        renderContributionStats({
          requestsCompleted: 0,
          totalPointsEarned: 0,
          successRate: 0
        });
        return;
      }

      try {
        const [helperRequestsSnap, acceptedApplicationsSnap, userSnap] = await Promise.all([
          getDocs(query(collection(db, "requests"), where("helperId", "==", userId))),
          getDocs(query(
            collection(db, "applications"),
            where("applicantId", "==", userId),
            where("status", "==", "accepted")
          )),
          getDoc(doc(db, "users", userId))
        ]);

        const helperRequests = helperRequestsSnap.docs.map((docSnap) => docSnap.data() || {});
        const requestsCompleted = helperRequests.filter((request) => normalizeStatus(request.status || "") === "completed").length;
        const acceptedRequests = acceptedApplicationsSnap.size;

        const userData = userSnap.exists() ? userSnap.data() : {};
        
        // Calculate total points earned from Skills transactions
        let totalPointsEarned = 0;
        try {
          const skillSources = new Set([
            "apply_request",
            "create_request",
            "delete_request", 
            "request_completed_reward",
            "request_reward_paid",
            "cancel_application",
            "achievement_reward",
            "bonus_reward",
            "first_login_bonus",
            "daily_bonus",
            "streak_bonus"
          ]);
          
          const txSnap = await getDocs(query(collection(db, "transactions"), where("userId", "==", userId)));
          txSnap.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const category = String(data.category || "").toLowerCase();
            const source = String(data.source || data.type || "").toLowerCase();
            const rawTitle = String(data.title || data.message || data.description || "Skill transaction");
            const titleLc = rawTitle.toLowerCase();
            const isSkillTx =
              category.includes("skill") ||
              source.includes("skill") ||
              skillSources.has(source) ||
              /request|help|skill/.test(titleLc);
            
            if (isSkillTx) {
              const pointsAmount = Number(data.pointsChange ?? data.points);
              if (Number.isFinite(pointsAmount) && pointsAmount > 0) {
                totalPointsEarned += pointsAmount;
              }
            }
          });
        } catch (error) {
          if (!isPermissionDenied(error)) {
            console.warn("Skills points calculation failed:", error);
          }
          // Fallback to current points if transaction query fails
          totalPointsEarned = Number(userData.points) || 0;
        }

        const successRate = acceptedRequests > 0
          ? (requestsCompleted / acceptedRequests) * 100
          : 0;

        renderContributionStats({
          requestsCompleted,
          totalPointsEarned,
          successRate
        });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error("Contribution stats load failed:", error);
        }
        renderContributionStats({
          requestsCompleted: 0,
          totalPointsEarned: 0,
          successRate: 0
        });
      }
    }

    async function loadUserBadges(userId) {
      try {
        const userSnap = await getDoc(doc(db, "users", userId));
        const userData = userSnap.exists() ? userSnap.data() : {};
        const points = Number(userData.points) || 0;
        const streak = Number(userData.streak) || 0;

        const [createdRequestsSnap, completedRequestsSnap, acceptedAppsSnap] = await Promise.all([
          getDocs(query(collection(db, "requests"), where("userId", "==", userId))),
          getDocs(query(
            collection(db, "requests"),
            where("userId", "==", userId),
            where("status", "==", "completed")
          )),
          getDocs(query(
            collection(db, "applications"),
            where("applicantId", "==", userId),
            where("status", "==", "accepted")
          ))
        ]);

        const progressStats = {
          createdCount: createdRequestsSnap.size,
          completedCount: completedRequestsSnap.size,
          helpedCount: acceptedAppsSnap.size,
          streak,
          points
        };

        latestProgressStats = { ...progressStats };
        renderBadges(progressStats);
        renderProgressLevelCard(progressStats);
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error("Error loading badges:", error);
        }
        const fallbackStats = {
          createdCount: 0,
          completedCount: 0,
          helpedCount: 0,
          streak: 0,
          points: 0
        };
        latestProgressStats = { ...fallbackStats };
        renderBadges(fallbackStats);
        renderProgressLevelCard(fallbackStats);
      }
    }

    function listenToBadgeActivity(userId) {
      if (unsubscribeBadgeRequests) unsubscribeBadgeRequests();
      if (unsubscribeBadgeApplications) unsubscribeBadgeApplications();

      unsubscribeBadgeRequests = onSnapshot(
        query(collection(db, "requests"), where("userId", "==", userId)),
        () => scheduleProgressInsightsRefresh(userId)
      );

      unsubscribeBadgeApplications = onSnapshot(
        query(collection(db, "applications"), where("applicantId", "==", userId)),
        () => scheduleProgressInsightsRefresh(userId)
      );
    }

    function getSafeAvatarUrl(rawUrl) {
      if (typeof rawUrl === "string" && rawUrl.trim()) return rawUrl.trim();
      return DEFAULT_AVATAR_URL;
    }

    async function getUserProfileById(userId) {
      const safeUserId = String(userId || "").trim();
      if (!safeUserId) {
        return { name: "User", avatarUrl: DEFAULT_AVATAR_URL };
      }

      if (userProfileCache.has(safeUserId)) {
        return userProfileCache.get(safeUserId);
      }

      const currentUid = String(auth.currentUser?.uid || "").trim();
      const canTryUsersDoc =
        !usersDocReadBlocked &&
        (!PREFER_PUBLIC_USERS_READS || (currentUid && safeUserId === currentUid));

      if (canTryUsersDoc) {
        try {
          const userSnap = await getDoc(doc(db, "users", safeUserId));
          if (userSnap.exists()) {
            const data = userSnap.data() || {};
            const profile = {
              name: resolveDisplayName(data, safeUserId),
              avatarUrl: getSafeAvatarUrl(getUserAvatarUrl(data))
            };
            if (isLikelyResolvedName(profile.name)) userNameCache.set(safeUserId, profile.name);
            userProfileCache.set(safeUserId, profile);
            return profile;
          }
        } catch (err) {
          if (isPermissionDenied(err)) {
            usersDocReadBlocked = true;
            if (!hasLoggedUsersDocBlock) {
              console.info("Users doc reads are blocked by Firestore rules. Using publicUsers fallback.");
              hasLoggedUsersDocBlock = true;
            }
          } else {
            console.warn("Users read failed, trying publicUsers:", err);
          }
        }
      }

      try {
        const publicSnap = await getDoc(doc(db, "publicUsers", safeUserId));
        const data = publicSnap.exists() ? (publicSnap.data() || {}) : {};
        const profile = {
          name: resolveDisplayName(data, safeUserId),
          avatarUrl: getSafeAvatarUrl(getUserAvatarUrl(data))
        };
        if (isLikelyResolvedName(profile.name)) userNameCache.set(safeUserId, profile.name);
        userProfileCache.set(safeUserId, profile);
        return profile;
      } catch (err) {
        if (!isPermissionDenied(err)) {
          console.error("Failed to fetch user profile from users/publicUsers:", err);
        }
        const fallbackProfile = {
          name: resolveDisplayName(null, safeUserId),
          avatarUrl: DEFAULT_AVATAR_URL
        };
        if (isLikelyResolvedName(fallbackProfile.name)) userNameCache.set(safeUserId, fallbackProfile.name);
        userProfileCache.set(safeUserId, fallbackProfile);
        return fallbackProfile;
      }
    }

    async function getUserNameById(userId) {
      const profile = await getUserProfileById(userId);
      return profile.name || "User";
    }

    function listenForPointNotifications(userId) {
      if (unsubscribePointNotifications) unsubscribePointNotifications();

      const notifQuery = query(
        collection(db, "users", userId, "notifications"),
        where("read", "==", false),
        orderBy("createdAt", "desc"),
        limit(20)
      );

      unreadNotificationsPrimed = false;
      unreadNotificationSeenIds.clear();

      unsubscribePointNotifications = onSnapshot(notifQuery, (snap) => {
        if (!unreadNotificationsPrimed) {
          snap.docs.forEach((docSnap) => unreadNotificationSeenIds.add(docSnap.id));
          unreadNotificationsPrimed = true;
          return;
        }

        snap.docChanges().forEach((change) => {
          if (change.type !== "added") return;
          if (unreadNotificationSeenIds.has(change.doc.id)) return;

          unreadNotificationSeenIds.add(change.doc.id);
          const notif = change.doc.data() || {};
          showGlobalToast(notif.message || "You have a new notification.", "info");
        });
      }, (error) => {
        if (!isPermissionDenied(error)) {
          console.warn("Notification listener failed:", error);
        }
      });
    }

    function clearTutoringBookingRelays() {
      while (tutoringBookingUnsubs.length) {
        const unsub = tutoringBookingUnsubs.pop();
        try {
          if (typeof unsub === "function") unsub();
        } catch (error) {
          // No-op cleanup
        }
      }
    }

    async function maybeNotifyTutorForBookedSession(bookerId, sessionId, sessionData = {}) {
      const normalizedSessionId = String(sessionId || "").trim();
      if (!normalizedSessionId) return;
      if (hasSessionNotificationBeenSent(normalizedSessionId)) return;

      const tutorId = String(
        sessionData.tutorId ||
        sessionData.tutorUid ||
        sessionData.mentorId ||
        sessionData.teacherId ||
        ""
      ).trim();

      if (!tutorId || tutorId === bookerId) return;

      const status = normalizeFilterToken(sessionData.status || "booked");
      if (status && !["booked", "scheduled", "confirmed", "pending"].includes(status)) return;

      const sessionTimestamp = toMillis(sessionData.bookedAt || sessionData.createdAt || sessionData.updatedAt);
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (sessionTimestamp > 0 && (Date.now() - sessionTimestamp) > oneDayMs) {
        markSessionNotificationSent(normalizedSessionId);
        return;
      }

      const bookerName = await getUserNameById(bookerId);
      const sessionTitle = String(sessionData.topic || sessionData.subject || sessionData.title || "").trim();
      const titleSuffix = sessionTitle ? ` for "${sessionTitle}"` : "";
      const message = `${bookerName} booked a tutoring session${titleSuffix}.`;

      const sent = await createUserNotification(tutorId, {
        message,
        type: "skills_tutoring_booking",
        source: "tutoring_session_booked",
        sessionId: normalizedSessionId,
        actorId: bookerId,
        actorName: bookerName
      });

      if (sent) {
        markSessionNotificationSent(normalizedSessionId);
      }
    }

    function startTutoringBookingNotificationRelay(bookerId) {
      clearTutoringBookingRelays();
      if (!bookerId) return;

      const candidateBookerFields = ["studentId", "bookedBy", "bookerId", "requesterId"];
      candidateBookerFields.forEach((fieldName) => {
        const sessionQuery = query(
          collection(db, "tutoringSessions"),
          where(fieldName, "==", bookerId),
          limit(40)
        );

        const unsub = onSnapshot(sessionQuery, async (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type !== "added" && change.type !== "modified") continue;
            const sessionData = change.doc.data() || {};
            await maybeNotifyTutorForBookedSession(bookerId, change.doc.id, sessionData);
          }
        }, (error) => {
          if (!isPermissionDenied(error)) {
            console.warn(`Tutoring session listener failed for ${fieldName}:`, error);
          }
        });

        tutoringBookingUnsubs.push(unsub);
      });
    }

    function listenToUserPoints(userId) {

      if (unsubscribeUserPoints) unsubscribeUserPoints();

      const userRef = doc(db, "users", userId);

      unsubscribeUserPoints = onSnapshot(userRef, (docSnap) => {
        if (!docSnap.exists()) return;

        const data = docSnap.data();
        const points = Number(data.points) || 0;

        // Navbar points
        const navPoints = document.getElementById("navPointsValue");
        if (navPoints) navPoints.textContent = points;

        // Dashboard points
        const dashPoints = document.getElementById("dashboardPoints");
        if (dashPoints) dashPoints.textContent = points.toLocaleString("en-US");

        // Streak
        const streakEl = document.getElementById("streakValue");
        if (streakEl) streakEl.textContent = data.streak ?? 0;

        // Username
        const nameEl = document.getElementById("usernameValue");
        if (nameEl) nameEl.textContent = data.name ?? "User";

        currentXP = points;

        console.log("User XP:", points);

        updateLevel();
      });
    }

    async function updateDailyStreak(userId) {

      const userRef = doc(db, "users", userId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) return;

      const data = userSnap.data();

      const today = formatLocalDate(new Date());
      const lastActive = data.lastActiveDate || "";
      let streak = data.streak || 0;

      if (lastActive === today) {
        // Already counted today
        return;
      }

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatLocalDate(yesterday);

      if (lastActive === yesterdayStr) {
        streak += 1;
      } else {
        streak = 1;
      }

      await updateDoc(userRef, {
        streak: streak,
        lastActiveDate: today
      });

    }
    
        // Highlight active link
        const currentPage = window.location.pathname
          .split("/")
          .pop()
          .replace(".html", "");

        document.querySelectorAll("[data-link]").forEach(link => {
          link.classList.remove("active");
          if (link.dataset.link === currentPage) {
            link.classList.add("active");
          }
        });

        // Logout
        const logoutBtn = document.getElementById("logoutBtn");
        if (logoutBtn) {
          logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            await signOut(auth);
            window.location.href = "../index.html";
          });
        }

        // Wait for auth before loading data
        onAuthStateChanged(auth, (user) => {
          if (!user) {
            if (unsubscribeUserPoints) unsubscribeUserPoints();
            if (unsubscribeRequests) unsubscribeRequests();
            if (unsubscribePointNotifications) unsubscribePointNotifications();
            if (unsubscribeBadgeRequests) unsubscribeBadgeRequests();
            if (unsubscribeBadgeApplications) unsubscribeBadgeApplications();
            clearTutoringBookingRelays();
            unreadNotificationsPrimed = false;
            unreadNotificationSeenIds.clear();
            if (progressInsightsRefreshTimer) {
              clearTimeout(progressInsightsRefreshTimer);
              progressInsightsRefreshTimer = null;
            }
            applicationUnsubs.forEach(unsub => unsub());
            applicationUnsubs.clear();
            if (window.location.pathname.includes("/pages/")) {
              window.location.href = "../login.html";
            }
            return;
          }

          const runStartupTask = (label, taskFn) => {
            try {
              const result = taskFn();
              if (result && typeof result.then === "function") {
                result.catch((error) => {
                  console.error(`${label} failed:`, error);
                });
              }
            } catch (error) {
              console.error(`${label} failed:`, error);
            }
          };

          runStartupTask("listenToUserPoints", () => listenToUserPoints(user.uid));
          runStartupTask("listenForPointNotifications", () => listenForPointNotifications(user.uid));
          runStartupTask("refreshProgressInsights", () => refreshProgressInsights(user.uid));
          runStartupTask("listenToBadgeActivity", () => listenToBadgeActivity(user.uid));
          runStartupTask("updateDailyStreak", () => updateDailyStreak(user.uid));
          runStartupTask("loadWeeklyXP", () => loadWeeklyXP(user.uid));
          runStartupTask("loadRequests", () => loadRequests(user));
          runStartupTask("loadAppliedRequests", () => loadAppliedRequests(user.uid));
          runStartupTask("loadSkillTransactions", () => loadSkillTransactions(user.uid));
          runStartupTask("syncCurrentUserPublicProfile", () => syncCurrentUserPublicProfile(user.uid));

          // AI Skill Match button
          const aiBtn = document.getElementById("aiSkillMatchBtn");
          const aiResp = document.getElementById("aiSkillResponse");
          if (aiBtn && aiResp) {
            aiBtn.addEventListener("click", async () => {
              aiBtn.disabled = true;
              aiResp.innerHTML = `<span style="color:#7c3aed;">? Thinking…</span>`;

              try {
                // Fetch user skills
                const userSnap = await getDoc(doc(db, "users", user.uid));
                const userData = userSnap.exists() ? userSnap.data() : {};
                const userSkills = (userData.skills || []).join(", ") || "general";
                const reqSnap = await getDocs(query(collection(db, "requests"), where("status", "==", "open")));
                const openRequests = reqSnap.docs.slice(0, 12).map(d => {
                  const r = d.data();
                  return `"${r.title}" (${r.category}, ${r.difficulty})`;
                }).join("\n");
                const prompt = `You are an AI assistant for UniX, a campus skill-exchange platform. A student has these skills: ${userSkills}.\n\nHere are the current open help requests from other students:\n${openRequests || "No open requests yet."}\n\nRecommend 2-3 specific requests this student should help with, explaining why their skills are a good match. Be brief (3 sentences max) and friendly.`;
                const result = await askGemini(prompt);
                aiResp.textContent = result;
              } catch (e) {
                aiResp.textContent = "Could not load recommendations right now.";
              }
              aiBtn.disabled = false;
            });
          }
        });
    async function awardXP(userId, amount, source = "activity", options = {}) {
      const safeAmount = Number(amount) || 0;
      if (safeAmount === 0) return;
      
      const config = options && typeof options === "object" ? options : {};
      const customNotificationMessage = String(config.notificationMessage || "").trim();
      const resolvedNotificationMessage = customNotificationMessage || pointsMessageFromSource(safeAmount, source);
      const userRef = doc(db, "users", userId);

      try {
        await setDoc(userRef, { points: increment(safeAmount) }, { merge: true });
        await setDoc(doc(db, "publicUsers", userId), { points: increment(safeAmount) }, { merge: true });
      } catch (e) { /* background sync */ }

      try {
        await addDoc(collection(db, "users", userId, "notifications"), {
          message: resolvedNotificationMessage,
          read: false,
          createdAt: serverTimestamp(),
          type: "points",
          amount: safeAmount,
          source
        });
      } catch (e) { /* ignore non-critical */ }
      
      if (config.recordTransaction) {
        const requestId = String(config.requestId || "").trim();
        const requestTitle = String(config.requestTitle || "").trim();
        const transactionTitle = String(config.transactionTitle || resolvedNotificationMessage).trim() || "Skill points update";

        const typeMap = {
          "request_completed_reward": "skills_request_completed",
          "request_reward_paid": "skills_request_payment",
          "tutoring_session_completed": "skills_tutoring_completed",
          "tutoring_completed_reward": "skills_tutoring_reward",
          "achievement_reward": "skills_achievement",
          "bonus_reward": "skills_bonus",
          "first_login_bonus": "skills_welcome_bonus",
          "daily_bonus": "skills_daily_bonus",
          "streak_bonus": "skills_streak_bonus"
        };
        
        const txType = typeMap[source] || `skills_${source.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        const txPayload = {
          userId,
          type: txType,
          title: transactionTitle,
          category: "skills",
          source,
          points: safeAmount,
          pointsChange: safeAmount,
          amount: safeAmount,
          createdAt: new Date()
        };

        if (requestId) txPayload.requestId = requestId;
        if (requestTitle) txPayload.requestTitle = requestTitle;

        try {
          await addDoc(collection(db, "transactions"), txPayload);
        } catch (error) {
          if (!isPermissionDenied(error)) {
            console.warn("Skill transaction write failed:", error);
          }
        }
      }

      // Refresh weekly XP if it's current user
      if (auth.currentUser?.uid === userId) {
        loadWeeklyXP(userId);
        loadContributionStats(userId);
        loadUserBadges(userId);
      }
    }

    async function loadWeeklyXP(userId) {
      const xpValue = document.getElementById("weeklyXpValue");
      const xpFill = document.getElementById("weeklyXpFill");
      const xpText = document.getElementById("weeklyXpText");
      const goalMeta = document.getElementById("weeklyGoalMeta");

      if (!xpValue || !xpFill || !xpText) return;

      try {
        const now = new Date();
        const firstDay = new Date(now);
        firstDay.setDate(now.getDate() - now.getDay()); // Sunday
        firstDay.setHours(0, 0, 0, 0);

        const q = query(collection(db, "transactions"), where("userId", "==", userId));

        let weeklyXP = 0;
        const countedKeys = new Set();
        const countEntry = (entryData = {}) => {
          if (!shouldCountWeeklyXpEntry(entryData, firstDay)) return;
          const key = buildWeeklyXpEntryKey(entryData);
          if (countedKeys.has(key)) return;
          countedKeys.add(key);
          weeklyXP += getTransactionPointsValue(entryData);
        };

        try {
          const txSnapshot = await getDocs(q);
          txSnapshot.forEach((docSnap) => {
            countEntry(docSnap.data() || {});
          });
        } catch (error) {
          if (!isPermissionDenied(error)) {
            console.warn("Weekly XP transaction query failed:", error);
          }
        }

        try {
          const notifSnapshot = await getDocs(
            query(collection(db, "users", userId, "notifications"), limit(220))
          );
          notifSnapshot.forEach((docSnap) => {
            const notifData = docSnap.data() || {};
            if (normalizeFilterToken(notifData.type || "") !== "points") return;
            countEntry(notifData);
          });
        } catch (error) {
          if (!isPermissionDenied(error)) {
            console.warn("Weekly XP notification query failed:", error);
          }
        }

        const weeklyGoal = WEEKLY_XP_GOAL;
        const progress = Math.max(0, Math.min((weeklyXP / weeklyGoal) * 100, 100));
        const signedWeeklyXP = weeklyXP >= 0 ? `+${weeklyXP}` : `${weeklyXP}`;

        xpValue.textContent = `${signedWeeklyXP} XP this week`;
        xpFill.style.width = progress + "%";
        xpText.textContent = `${weeklyXP} / ${weeklyGoal} XP`;
        if (goalMeta) {
          goalMeta.textContent = `${Math.round(progress)}% of weekly goal`;
        }
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Weekly XP load failed:", error);
        }
        xpValue.textContent = "0 XP this week";
        xpFill.style.width = "0%";
        xpText.textContent = `0 / ${WEEKLY_XP_GOAL} XP`;
        if (goalMeta) {
          goalMeta.textContent = "0% of weekly goal";
        }
      }
    }

    function toDateObject(value) {
      if (!value) return null;
      if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

      if (typeof value?.toDate === "function") {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      }

      if (typeof value === "object" && Number.isFinite(value.seconds)) {
        const date = new Date(value.seconds * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      if (typeof value === "number" || typeof value === "string") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
      }

      return null;
    }

    function toMillis(value) {
      const date = toDateObject(value);
      return date ? date.getTime() : 0;
    }

    function formatActivityDate(value) {
      const date = toDateObject(value);
      if (!date) return "Time TBD";
      return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    }

    function formatStatusLabel(value) {
      const status = normalizeStatus(value);
      if (status === "pending") return "Pending";
      if (status === "in-progress") return "In Progress";
      if (status === "completed") return "Completed";
      if (status === "cancelled") return "Cancelled";
      return "Open";
    }

    function normalizeFilterToken(value) {
      return String(value || "").toLowerCase().trim();
    }

    function normalizeCategoryValue(value) {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized || "other";
    }

    function formatCategoryLabel(value) {
      const normalized = normalizeCategoryValue(value).toLowerCase();
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    function updateStatusBubbleUI(scope, activeStatus) {
      const normalizedActive = normalizeStatus(activeStatus);
      document.querySelectorAll(`.status-bubble-btn[data-scope="${scope}"]`).forEach((button) => {
        const buttonStatus = normalizeStatus(button.dataset.status || "");
        const isActive = buttonStatus === normalizedActive;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function getRequestsFilterState() {
      return {
        keyword: normalizeFilterToken(document.getElementById("requestsSearchInput")?.value),
        category: normalizeFilterToken(document.getElementById("requestCategoryFilter")?.value || "all"),
        difficulty: normalizeFilterToken(document.getElementById("requestDifficultyFilter")?.value || "all"),
        urgency: normalizeFilterToken(document.getElementById("requestUrgencyFilter")?.value || "all"),
        sortBy: normalizeFilterToken(document.getElementById("requestSortSelect")?.value || "newest")
      };
    }

    function renderAppliedRequests() {
      const appliedListEl = document.getElementById("appliedRequestsList");
      if (!appliedListEl) return;

      const { keyword, category, difficulty, urgency, sortBy } = getRequestsFilterState();
      const targetStatus = ["pending", "in-progress", "completed"].includes(appliedStatusFilter)
        ? appliedStatusFilter
        : "pending";
      updateStatusBubbleUI("applied", targetStatus);

      const filtered = appliedRequestsCache
        .filter((entry) => {
          if (entry.status !== targetStatus) return false;

          const entryCategory = normalizeFilterToken(entry.category);
          const entryDifficulty = normalizeFilterToken(entry.difficulty);
          const entryUrgency = normalizeFilterToken(entry.urgency);
          const searchText = [
            normalizeFilterToken(entry.title),
            normalizeFilterToken(entry.desc),
            entryCategory,
            entryDifficulty,
            entryUrgency,
            normalizeFilterToken(entry.deadline)
          ].join(" ");

          const matchesKeyword = keyword === "" || searchText.includes(keyword);
          const matchesCategory = category === "all" || entryCategory === category;
          const matchesDifficulty = difficulty === "all" || entryDifficulty === difficulty;
          const matchesUrgency = urgency === "all" || entryUrgency === urgency;

          return matchesKeyword && matchesCategory && matchesDifficulty && matchesUrgency;
        })
        .sort((a, b) => {
          if (sortBy === "highest_reward") {
            const byReward = (Number(b.points) || 0) - (Number(a.points) || 0);
            if (byReward !== 0) return byReward;
          }

          if (sortBy === "closest_deadline") {
            const aDeadline = Number(a.deadlineTs) > 0 ? Number(a.deadlineTs) : Number.MAX_SAFE_INTEGER;
            const bDeadline = Number(b.deadlineTs) > 0 ? Number(b.deadlineTs) : Number.MAX_SAFE_INTEGER;
            if (aDeadline !== bDeadline) return aDeadline - bDeadline;
          }

          if (sortBy === "most_applicants") {
            const byApplicants = (Number(b.applicants) || 0) - (Number(a.applicants) || 0);
            if (byApplicants !== 0) return byApplicants;
          }

          return (Number(b.sortTs) || 0) - (Number(a.sortTs) || 0);
        });

      if (filtered.length === 0) {
        const statusLabel =
          targetStatus === "completed"
            ? "completed"
            : targetStatus === "in-progress"
              ? "in progress"
              : "pending";
        renderListEmpty(appliedListEl, {
          iconClass: "fa-file-circle-question",
          title: `No ${statusLabel} applications found.`,
          message: "Apply to open requests to track them here.",
          actionLabel: "Browse Requests",
          actionValue: "browse_requests"
        });
        return;
      }

      appliedListEl.innerHTML = filtered.slice(0, 12).map((entry) => {
        const safeTitle = escapeHTML(entry.title || "Request");
        const rawDesc = String(entry.desc || "").trim();
        const safeDesc = escapeHTML(rawDesc);
        const hasDesc = Boolean(rawDesc);
        const dueText = entry.deadline ? String(entry.deadline) : "No deadline";
        const safeDue = escapeHTML(dueText);
        const requesterId = String(entry.requesterId || "").trim();
        const requesterUid = encodeURIComponent(requesterId);
        const safeCategory = escapeHTML(formatCategoryLabel(entry.category || "other"));
        const rawDifficulty = String(entry.difficulty || "medium");
        const difficultyToken = rawDifficulty.toLowerCase().trim().replace(/\s+/g, "-");
        const safeDifficulty =
          difficultyToken === "easy" || difficultyToken === "medium" || difficultyToken === "hard"
            ? difficultyToken
            : "medium";
        const prettyDifficulty = escapeHTML(
          safeDifficulty.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
        );
        const safeUrgency = normalizeUrgency(String(entry.urgency || "").toLowerCase().trim());
        const prettyUrgency = escapeHTML(
          safeUrgency.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
        );
        const statusToken = normalizeStatus(entry.status || "pending");
        const safeStatus = ["pending", "in-progress", "completed"].includes(statusToken)
          ? statusToken
          : "pending";
        const statusLabel = formatStatusLabel(safeStatus);
        const rewardPoints = Number(entry.points) || 0;

        const chatAction = safeStatus === "in-progress" && requesterId
          ? `<a href="chat.html?uid=${requesterUid}" class="chat-btn applied-chat-primary"><i class="fa-solid fa-message"></i> Chat</a>`
          : "";

        const withdrawAction = safeStatus === "pending"
          ? `<button type="button" class="withdraw-application-btn applied-withdraw-btn" data-app-id="${escapeHTML(entry.applicationId)}" data-request-id="${escapeHTML(entry.requestId)}" data-status="${escapeHTML(safeStatus)}">Withdraw Application</button>`
          : "";

        const completedAction = safeStatus === "completed"
          ? `<button type="button" class="apply-btn closed applied-completed-btn" disabled>Completed</button>`
          : "";

        const actionsMarkup = (chatAction || withdrawAction || completedAction)
          ? `<div class="request-footer">
               <div class="request-actions applied-request-actions">
                 ${chatAction}
                 ${withdrawAction}
                 ${completedAction}
               </div>
             </div>`
          : "";

        return `
          <div class="request-card applied-request-card">
            <div class="request-simple-head">
              <div class="request-title-row">
                <h3 class="request-title">${safeTitle}</h3>
                <span class="status-badge applied-status-badge ${safeStatus}">${escapeHTML(statusLabel)}</span>
              </div>
              ${hasDesc ? `<p class="request-description">${safeDesc}</p>` : ""}
            </div>

            <div class="request-tags">
              <span class="request-tag category-tag">Category: ${safeCategory}</span>
              <span class="request-tag difficulty-tag difficulty-${safeDifficulty}">Difficulty: ${prettyDifficulty}</span>
              <span class="request-tag urgency-tag urgency-${safeUrgency}">Urgency: ${prettyUrgency}</span>
            </div>

            <div class="request-reward-row applied-request-meta-row">
              <div class="deadline">
                  <i class="fa-regular fa-calendar"></i> Due: ${safeDue}
                </div>
              <div class="reward-box">
                <span>Reward</span>
                <strong>+${rewardPoints} pts</strong>
              </div>
            </div>

            ${actionsMarkup}
          </div>
        `;
      }).join("");
    }

    async function loadAppliedRequests(userId) {
      const appliedListEl = document.getElementById("appliedRequestsList");
      if (!appliedListEl) return;

      appliedRequestsCache = [];
      renderListLoading(appliedListEl, "Loading applied requests...");

      if (!userId) {
        renderListEmpty(appliedListEl, {
          iconClass: "fa-right-to-bracket",
          title: "Sign in to view applied requests.",
          message: "Your application updates will appear here after login."
        });
        return;
      }

      const requestMap = new Map();
      const applicantCountMap = new Map();
      let applications = [];

      try {
        const applicationsSnap = await getDocs(
          query(collection(db, "applications"), where("applicantId", "==", userId))
        );

        applications = applicationsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() || {})
        }));

        const requestIds = [...new Set(applications.map((item) => item.requestId).filter(Boolean))];
        await Promise.all(
          requestIds.map(async (requestId) => {
            try {
              const requestSnap = await getDoc(doc(db, "requests", requestId));
              if (requestSnap.exists()) {
                requestMap.set(requestId, requestSnap.data() || {});
              }
            } catch (error) {
              if (!isPermissionDenied(error)) {
                console.error("Applied request load failed:", error);
              }
            }
          })
        );

        await Promise.all(
          requestIds.map(async (requestId) => {
            try {
              const applicantsSnap = await getDocs(
                query(collection(db, "applications"), where("requestId", "==", requestId))
              );
              applicantCountMap.set(requestId, applicantsSnap.size || 0);
            } catch (error) {
              if (!isPermissionDenied(error)) {
                console.error("Applied request applicant count load failed:", error);
              }
            }
          })
        );
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.error("Failed loading applied request applications:", error);
        }
        const fallbackEntries = await buildAppliedRequestsFallback(userId);
        if (fallbackEntries.length > 0) {
          appliedRequestsCache = fallbackEntries;
          renderAppliedRequests();
          return;
        }
        if (isPermissionDenied(error)) {
          renderListEmpty(appliedListEl, {
            iconClass: "fa-file-circle-question",
            title: "No applied requests found yet.",
            message: "Apply to open requests to track them here."
          });
          return;
        }
        renderListEmpty(appliedListEl, {
          iconClass: "fa-triangle-exclamation",
          title: "Couldn't load applied requests.",
          message: "Please try again in a moment."
        });
        return;
      }

      appliedRequestsCache = applications.map((application) => {
        const requestData = requestMap.get(application.requestId) || {};
        const requestStatus = normalizeStatus(requestData.status || "open");
        const deadlineRaw = String(requestData.deadline || "");
        const assignedHelperId = String(
          requestData.helperId ||
          requestData.assignedHelperId ||
          requestData.selectedHelperId ||
          ""
        ).trim();
        const applicationStatus = normalizeFilterToken(application.status);
        const isSelectedHelper = assignedHelperId
          ? assignedHelperId === userId
          : applicationStatus === "accepted";

        let derivedStatus = "";
        if (isSelectedHelper) {
          derivedStatus = requestStatus === "completed" ? "completed" : "in-progress";
        } else if (applicationStatus === "pending" && requestStatus === "open") {
          derivedStatus = "pending";
        } else {
          return null;
        }

        return {
          applicationId: String(application.id || ""),
          requestId: String(application.requestId || ""),
          title: String(requestData.title || application.requestTitle || "Request"),
          desc: String(requestData.desc || ""),
          status: derivedStatus,
          requesterId: String(
            requestData.userId ||
            requestData.requesterId ||
            requestData.uid ||
            requestData.createdBy ||
            ""
          ),
          category: normalizeCategoryValue(requestData.category || "other"),
          difficulty: String(requestData.difficulty || "").toLowerCase(),
          urgency: String(requestData.urgency || "").toLowerCase(),
          points: Number(requestData.points) || 0,
          deadline: deadlineRaw,
          deadlineTs: deadlineRaw ? toMillis(new Date(deadlineRaw)) : 0,
          applicants: Number(applicantCountMap.get(application.requestId)) || 0,
          sortTs: toMillis(
            requestData.updatedAt ||
            requestData.completedAt ||
            application.reviewedAt ||
            application.appliedAt ||
            requestData.createdAt
          )
        };
      })
        .filter(Boolean)
        .filter((entry) =>
          entry.status === "pending" ||
          entry.status === "in-progress" ||
          entry.status === "completed"
        )
        .sort((a, b) => b.sortTs - a.sortTs);

      renderAppliedRequests();
    }

    function renderTutoringRows(listEl, rows, emptyOptions = {}) {
      if (!listEl) return;
      if (!Array.isArray(rows) || rows.length === 0) {
        renderListEmpty(listEl, emptyOptions);
        return;
      }

      listEl.innerHTML = rows.map((row) => {
        const safeTitle = escapeHTML(String(row.title || "Tutoring Session"));
        const safeSubtitle = escapeHTML(String(row.subtitle || ""));
        const safeMeta = escapeHTML(String(row.meta || ""));
        const actionMarkup = row.chatUid
          ? `<a href="chat.html?uid=${encodeURIComponent(String(row.chatUid))}" class="chat-btn tutoring-chat-btn"><i class="fa-solid fa-message"></i> Chat</a>`
          : "";

        return `
          <div class="my-activity-item tutoring-session-item">
            <div class="my-activity-main">
              <p class="my-activity-title">${safeTitle}</p>
              ${safeSubtitle ? `<p class="my-activity-sub">${safeSubtitle}</p>` : ""}
              ${safeMeta ? `<p class="my-activity-sub">${safeMeta}</p>` : ""}
            </div>
            ${actionMarkup}
          </div>
        `;
      }).join("");
    }

    async function loadTutoringSessions(userId) {
      const availableTutorsList = document.getElementById("availableTutorsList");
      const mySessionsList = document.getElementById("mySessionsList");
      const myTutoringList = document.getElementById("myTutoringList");

      if (!availableTutorsList || !mySessionsList || !myTutoringList) return;

      renderListLoading(availableTutorsList, "Loading available tutors...");
      renderListLoading(mySessionsList, "Loading your tutoring sessions...");
      renderListLoading(myTutoringList, "Loading your tutoring assignments...");

      if (!userId) {
        renderListEmpty(availableTutorsList, {
          iconClass: "fa-chalkboard-user",
          title: "Sign in to browse tutors.",
          message: "Available tutors will appear here after login."
        });
        renderListEmpty(mySessionsList, {
          iconClass: "fa-calendar-check",
          title: "No tutoring sessions to show.",
          message: "Book a session to see it here."
        });
        renderListEmpty(myTutoringList, {
          iconClass: "fa-user-graduate",
          title: "No tutoring assignments yet.",
          message: "Accepted tutoring sessions will appear here."
        });
        return;
      }

      let sessions = [];
      try {
        const sessionsSnap = await getDocs(query(collection(db, "tutoringSessions"), limit(80)));
        sessions = sessionsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() || {})
        }));
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Tutoring sessions load failed:", error);
        }
      }

      const mySessionsRows = [];
      const myTutoringRows = [];
      const availableTutorMap = new Map();

      sessions.forEach((session) => {
        const topic = String(session.topic || session.subject || session.title || "Tutoring Session").trim();
        const status = normalizeFilterToken(session.status || "scheduled");
        const tutorId = String(session.tutorId || session.tutorUid || session.mentorId || session.teacherId || "").trim();
        const learnerId = String(session.studentId || session.bookedBy || session.bookerId || session.requesterId || "").trim();

        const tutorName = String(session.tutorName || session.mentorName || "").trim();
        const learnerName = String(session.studentName || session.bookerName || session.requesterName || "").trim();
        const scheduleText = formatActivityDate(session.scheduledAt || session.bookedAt || session.createdAt || session.updatedAt);
        const statusText = status ? `Status: ${status.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}` : "";

        if (learnerId === userId) {
          mySessionsRows.push({
            title: topic,
            subtitle: `Tutor: ${tutorName || "Assigned tutor"}`,
            meta: `${scheduleText}${statusText ? ` • ${statusText}` : ""}`,
            chatUid: tutorId || ""
          });
        }

        if (tutorId === userId) {
          myTutoringRows.push({
            title: topic,
            subtitle: `Student: ${learnerName || "Student"}`,
            meta: `${scheduleText}${statusText ? ` • ${statusText}` : ""}`,
            chatUid: learnerId || ""
          });
        }

        if (tutorId && tutorId !== userId && ["open", "available", "booked", "scheduled", "confirmed", "pending"].includes(status || "booked")) {
          if (!availableTutorMap.has(tutorId)) {
            availableTutorMap.set(tutorId, {
              topic,
              tutorName
            });
          }
        }
      });

      const availableTutorRows = await Promise.all(
        Array.from(availableTutorMap.entries()).slice(0, 10).map(async ([tutorId, data]) => {
          const resolvedName = String(data.tutorName || "").trim() || await getUserNameById(tutorId);
          return {
            title: resolvedName || "Tutor",
            subtitle: data.topic ? `Helps with ${data.topic}` : "Available for tutoring",
            chatUid: tutorId
          };
        })
      );

      renderTutoringRows(availableTutorsList, availableTutorRows, {
        iconClass: "fa-user-group",
        title: "No tutors available right now.",
        message: "Check back later or browse open requests instead.",
        actionLabel: "Browse Requests",
        actionValue: "browse_requests"
      });

      renderTutoringRows(mySessionsList, mySessionsRows, {
        iconClass: "fa-calendar-check",
        title: "No upcoming tutoring sessions.",
        message: "Book a session to see it listed here.",
        actionLabel: "Browse Tutors",
        actionValue: "browse_tutors"
      });

      renderTutoringRows(myTutoringList, myTutoringRows, {
        iconClass: "fa-chalkboard-user",
        title: "No tutoring sessions assigned.",
        message: "When someone books with you, it will appear here."
      });
    }

    function formatTxnAmount(amount, unit) {
      const numeric = Number(amount);
      if (!Number.isFinite(numeric)) {
        return unit === "cash" ? "?0" : "0 pts";
      }

      const abs = Math.abs(numeric);
      if (unit === "cash") {
        return `${numeric < 0 ? "-" : "+"}?${abs.toFixed(abs % 1 === 0 ? 0 : 2)}`;
      }
      return `${numeric < 0 ? "" : "+"}${numeric} pts`;
    }

    function normalizeSourceToken(value) {
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[_\s]+/g, "-");
    }

    function resolveTransactionTypeMeta(source, title, unit = "points") {
      const sourceToken = normalizeSourceToken(source);
      const titleToken = normalizeSourceToken(title);

      if (unit === "cash") {
        return { label: "Cash Movement", icon: "fa-wallet", kind: "cash" };
      }
      
      // Handle new type-based categorization
      if (sourceToken.startsWith("skills_")) {
        const typePart = sourceToken.substring(7); // Remove "skills_" prefix
        if (typePart.includes("bonus") || typePart.includes("welcome") || typePart.includes("daily") || typePart.includes("streak")) {
          return { label: "Bonus", icon: "fa-gift", kind: "bonus" };
        }
        if (typePart.includes("request") || typePart.includes("apply") || typePart.includes("cancel")) {
          if (typePart.includes("completed") || typePart.includes("payment")) {
            return { label: "Request Reward", icon: "fa-file-circle-check", kind: "request" };
          }
          if (typePart.includes("apply")) {
            return { label: "Application", icon: "fa-paper-plane", kind: "application" };
          }
          if (typePart.includes("cancel") || typePart.includes("penalty")) {
            return { label: "Application Update", icon: "fa-rotate-left", kind: "application" };
          }
          return { label: "Request Activity", icon: "fa-list-check", kind: "request" };
        }
        if (typePart.includes("achievement")) {
          return { label: "Achievement", icon: "fa-medal", kind: "achievement" };
        }
      }
      
      // Fallback to old source-based logic
      if (sourceToken.includes("bonus") || titleToken.includes("bonus")) {
        return { label: "Bonus", icon: "fa-gift", kind: "bonus" };
      }
      if (sourceToken === "request-completed-reward" || sourceToken === "request-reward-paid") {
        return { label: "Request Reward", icon: "fa-file-circle-check", kind: "request" };
      }
      if (sourceToken === "apply-request") {
        return { label: "Application", icon: "fa-paper-plane", kind: "application" };
      }
      if (sourceToken === "cancel-application") {
        return { label: "Application Update", icon: "fa-rotate-left", kind: "application" };
      }
      if (sourceToken === "create-request" || sourceToken === "delete-request" || titleToken.includes("request")) {
        return { label: "Request Activity", icon: "fa-list-check", kind: "request" };
      }
      if (sourceToken.includes("achievement")) {
        return { label: "Achievement", icon: "fa-medal", kind: "achievement" };
      }
      return { label: "Points Update", icon: "fa-bolt", kind: "general" };
    }

    async function loadSkillTransactions(userId) {
      const transactionsListEl = document.getElementById("skillsTransactionsList");
      if (!transactionsListEl) return;

      renderListLoading(transactionsListEl, "Loading skill transactions...");

      if (!userId) {
        renderListEmpty(transactionsListEl, {
          iconClass: "fa-right-to-bracket",
          title: "Sign in to view transactions.",
          message: "Your Skills points activity appears here after login."
        });
        return;
      }

      const skillSources = new Set([
        "apply_request",
        "create_request",
        "delete_request",
        "request_completed_reward",
        "request_reward_paid",
        "cancel_application",
        "achievement_reward",
        "bonus_reward",
        "first_login_bonus",
        "daily_bonus",
        "streak_bonus"
      ]);

      const entries = [];

      try {
        const notifSnap = await getDocs(
          query(
            collection(db, "users", userId, "notifications"),
            orderBy("createdAt", "desc"),
            limit(40)
          )
        );

        notifSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const source = String(data.source || "");
          if (!skillSources.has(source)) return;

          const description = String(data.message || data.title || "Skill points update").trim() || "Skill points update";
          const typeMeta = resolveTransactionTypeMeta(source, description, "points");

          entries.push({
            typeLabel: typeMeta.label,
            typeClass: typeMeta.kind,
            description,
            amount: Number(data.amount) || 0,
            unit: "points",
            createdAt: data.createdAt || null,
            icon: typeMeta.icon
          });
        });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Skill notifications query failed:", error);
        }

        try {
          const notifFallback = await getDocs(
            query(collection(db, "users", userId, "notifications"), limit(60))
          );

          notifFallback.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const source = String(data.source || "");
            if (!skillSources.has(source)) return;

            const description = String(data.message || data.title || "Skill points update").trim() || "Skill points update";
            const typeMeta = resolveTransactionTypeMeta(source, description, "points");

            entries.push({
              typeLabel: typeMeta.label,
              typeClass: typeMeta.kind,
              description,
              amount: Number(data.amount) || 0,
              unit: "points",
              createdAt: data.createdAt || null,
              icon: typeMeta.icon
            });
          });
        } catch (fallbackError) {
          if (!isPermissionDenied(fallbackError)) {
            console.warn("Skill notifications fallback failed:", fallbackError);
          }
        }
      }

      try {
        const txSnap = await getDocs(
          query(collection(db, "transactions"), where("userId", "==", userId), limit(60))
        );

        txSnap.docs.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const category = String(data.category || "").toLowerCase();
          const source = String(data.source || data.type || "").toLowerCase();
          const rawTitle = String(data.title || data.message || data.description || "Skill transaction");
          const titleLc = rawTitle.toLowerCase();
          const isSkillTx =
            category.includes("skill") ||
            source.includes("skill") ||
            skillSources.has(source) ||
            /request|help|skill/.test(titleLc);

          if (!isSkillTx) return;

          const pointsAmount = Number(data.pointsChange ?? data.points);
          const cashAmount = Number(data.cashAmount ?? data.cash ?? data.amountRs ?? data.price ?? data.amount);

          let amount = 0;
          let unit = "points";

          if (Number.isFinite(pointsAmount) && pointsAmount !== 0) {
            amount = pointsAmount;
            unit = "points";
          } else if (Number.isFinite(cashAmount) && cashAmount !== 0) {
            amount = cashAmount;
            unit = "cash";
          } else {
            return;
          }

          const description = rawTitle.trim() || "Skill transaction";
          const typeMeta = resolveTransactionTypeMeta(source, description, unit);

          entries.push({
            typeLabel: typeMeta.label,
            typeClass: typeMeta.kind,
            description,
            amount,
            unit,
            createdAt: data.createdAt || null,
            icon: typeMeta.icon
          });
        });
      } catch (error) {
        if (!isPermissionDenied(error)) {
          console.warn("Skill transactions query failed:", error);
        }
      }

      const deduped = [];
      const seen = new Set();

      entries
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        .forEach((entry) => {
          const key = `${entry.typeLabel}|${entry.description}|${entry.unit}|${entry.amount}|${Math.floor(toMillis(entry.createdAt) / 60000)}`;
          if (seen.has(key)) return;
          seen.add(key);
          deduped.push(entry);
        });

      if (deduped.length === 0) {
        renderListEmpty(transactionsListEl, {
          iconClass: "fa-clock-rotate-left",
          title: "No skill transactions yet.",
          message: "Start helping or creating requests to build your activity history.",
          actionLabel: "Browse Requests",
          actionValue: "browse_requests"
        });
        return;
      }

      const bonusEntries = deduped.filter(entry => entry.typeClass === "bonus");
      const activityEntries = deduped.filter(entry => entry.typeClass !== "bonus");

      const renderTransactionGroup = (entries, title) => {
        if (entries.length === 0) return "";
        const itemsHtml = entries.map((entry) => {
          const amountClass = Number(entry.amount) >= 0 ? "plus" : "minus";
          const amountText = formatTxnAmount(entry.amount, entry.unit);
          return `
            <div class="skills-txn-item">
              <div class="skills-txn-left">
                <span class="skills-txn-icon ${entry.unit}">
                  <i class="fa-solid ${entry.icon}"></i>
                </span>
                <div class="skills-txn-text">
                  <p class="skills-txn-type ${entry.typeClass}">${escapeHTML(entry.typeLabel)}</p>
                  <p class="skills-txn-title">${escapeHTML(entry.description)}</p>
                  <p class="skills-txn-time">${escapeHTML(formatActivityDate(entry.createdAt))}</p>
                </div>
              </div>
              <span class="skills-txn-amount ${amountClass}">${escapeHTML(amountText)}</span>
            </div>
          `;
        }).join("");

        return `
          <div class="skills-txn-section">
            <h3 class="skills-txn-section-title">${title}</h3>
            ${itemsHtml}
          </div>
        `;
      };

      transactionsListEl.innerHTML = 
        renderTransactionGroup(bonusEntries, "BONUS") + 
        renderTransactionGroup(activityEntries, "ACTIVITY");
    }


    async function loadRequests(user) {
      if (!user) return;
      const availableSection = document.getElementById("availableSection");
      const mySection = document.getElementById("mySection");
      if (!availableSection || !mySection) return;

      if (unsubscribeRequests) unsubscribeRequests();

      // Initial loading state
      renderListLoading(availableSection, "Loading available requests...");
      renderListLoading(mySection, "Loading your requests...");

      const q = query(
        collection(db, "requests"),
        orderBy("createdAt", "desc")
      );

      unsubscribeRequests = onSnapshot(q, (snapshot) => {
        // Clear previous applications sub-listeners
        applicationUnsubs.forEach(unsub => unsub());
        applicationUnsubs.clear();

        // Re-setup containers
        availableSection.innerHTML = `
          <h2 class='section-title'>Available Requests</h2>
          <div class="request-cards-list" data-request-list="available-open" data-request-scope="available"></div>
        `;
        mySection.innerHTML = `
          <div class="section-title-row">
            <h2 class='section-title my-section'>My Requests</h2>
            <button class="primary-btn my-requests-create-btn" type="button" data-create-request-btn>
              <i class="fa-solid fa-plus"></i> Create Request
            </button>
          </div>
          <div class="status-bubble-row" id="myRequestsFilterRow">
            <button class="status-bubble-btn ${myRequestsStatusFilter === "open" ? "active" : ""}" type="button" data-scope="my" data-status="open">Open</button>
            <button class="status-bubble-btn ${myRequestsStatusFilter === "in-progress" ? "active" : ""}" type="button" data-scope="my" data-status="in-progress">In Progress</button>
            <button class="status-bubble-btn ${myRequestsStatusFilter === "completed" ? "active" : ""}" type="button" data-scope="my" data-status="completed">Completed</button>
          </div>
          <div class="request-cards-list" data-request-list="my-all" data-request-scope="my"></div>
        `;

        const availableList = availableSection.querySelector('[data-request-list="available-open"]');
        const myList = mySection.querySelector('[data-request-list="my-all"]');

        if (snapshot.empty) {
          renderListEmpty(availableList, { title: "No requests available right now." });
          renderListEmpty(myList, { title: "You haven't created any requests yet." });
          return;
        }

        let availableCount = 0;
        let myCount = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const card = createRequestCardElement(docSnap.id, data, user);
          
          if (data.userId === user.uid) {
            myList.appendChild(card);
            myCount++;
          } else if (normalizeStatus(data.status) === "open") {
            availableList.appendChild(card);
            availableCount++;
          }

          // Load applicants for each card
          const appContainer = card.querySelector(".applications-container");
          if (appContainer) loadApplications(docSnap.id, appContainer);
        });

        if (availableCount === 0) renderListEmpty(availableList, { title: "No requests available right now." });
        if (myCount === 0) renderListEmpty(myList, { title: "You haven't created any requests yet." });

        if (typeof applyRequestFiltersAndSort === "function") applyRequestFiltersAndSort();
      }, (error) => {
        console.error("Requests listener failed:", error);
      });
    }

    // Helper to create card element (keeping logic from existing code but simplified)
    function createRequestCardElement(requestId, data, user) {
      const safeTitle = escapeHTML(data.title);
      const safeDesc = escapeHTML(data.desc || "");
      const safeStatus = normalizeStatus(data.status);
      const categoryToken = normalizeCategoryValue(data.category || "other");
      const safeCategory = escapeHTML(formatCategoryLabel(categoryToken));
      const safeDifficulty = normalizeFilterToken(data.difficulty || "medium");
      const safeUrgency = normalizeUrgency(data.urgency);
      const prettyDifficulty = escapeHTML(
        safeDifficulty.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
      );
      const prettyUrgency = escapeHTML(
        safeUrgency.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
      );
      const rewardPoints = Number(data.points) || 0;
      const requesterUid = data.userId || "";
      const isOwner = user && requesterUid === user.uid;

      const card = document.createElement("div");
      card.className = "request-card";
      card.dataset.id = requestId;
      card.dataset.status = safeStatus;
      card.dataset.category = categoryToken;
      card.dataset.difficulty = safeDifficulty;
      card.dataset.urgency = safeUrgency;
      card.dataset.points = String(rewardPoints);
      card.dataset.createdTs = String(toMillis(data.createdAt));
      card.dataset.deadlineTs = String(data.deadline ? toMillis(new Date(data.deadline)) : 0);

      card.innerHTML = `
        <div class="request-top-row">
          <div class="user-label">
            <img src="${getSafeAvatarUrl("")}" class="request-creator-avatar">
            <a href="profile.html?uid=${requesterUid}" class="creator-link">Loading...</a>
          </div>
          <span class="status-badge ${safeStatus}">${formatStatusLabel(safeStatus)}</span>
        </div>
        <div class="request-simple-head">
          <h3 class="request-title">${safeTitle}</h3>
          <p class="request-description">${safeDesc}</p>
        </div>
        <div class="request-tags">
          <span class="request-tag category-tag">Category: ${safeCategory}</span>
          <span class="request-tag difficulty-tag difficulty-${safeDifficulty}">Difficulty: ${prettyDifficulty}</span>
          <span class="request-tag urgency-tag urgency-${safeUrgency}">Urgency: ${prettyUrgency}</span>
        </div>
        <div class="request-reward-row">
          <div class="deadline"><i class="fa-regular fa-calendar"></i> Due: ${data.deadline || "No deadline"}</div>
          <div class="reward-box"><span>Reward</span><strong>+${rewardPoints} pts</strong></div>
        </div>
        <div class="request-footer">
          <div class="request-actions">
            ${!isOwner && safeStatus === "open" ? '<button class="apply-btn">Apply</button>' : ""}
            ${!isOwner ? `<a href="chat.html?uid=${requesterUid}" class="chat-btn"><i class="fa-solid fa-message"></i> Chat</a>` : ""}
            ${isOwner ? '<button class="edit-btn">Edit</button><button class="delete-btn">Delete</button>' : ""}
          </div>
        </div>
        <div class="applications-container"></div>
      `;

      // Async load user details
      getUserProfileById(requesterUid).then(profile => {
        const nameEl = card.querySelector(".creator-link");
        const avatarEl = card.querySelector(".request-creator-avatar");
        if (nameEl) nameEl.textContent = profile?.name || "User";
        if (avatarEl) avatarEl.src = getSafeAvatarUrl(profile?.avatarUrl);
      });

      return card;
    }
    function loadApplications(requestId, container) {

      const q = query(
        collection(db, "applications"),
        where("requestId", "==", requestId)
      );

      const unsub = onSnapshot(q, async (snapshot) => {

        container.innerHTML = "";
        const parentCard = container.closest(".request-card");
        if (parentCard) {
          parentCard.dataset.applicants = String(snapshot.size || 0);
        }
        const currentUser = auth.currentUser;
        const requestSnap = await getDoc(doc(db, "requests", requestId));
        const requestData = requestSnap.exists() ? (requestSnap.data() || {}) : {};
        const requestOwnerId = requestData.userId || null;
        const requestStatus = normalizeStatus(requestData.status || "open");
        if (parentCard) {
          setRequestCardStatus(parentCard, requestStatus);
        }
        const canModerate = !!currentUser && requestOwnerId === currentUser.uid;
        const canModerateOpen = canModerate && requestStatus === "open";
        let currentUserApplicationStatus = "";

        for (const docSnap of snapshot.docs) {

          const data = docSnap.data();

          const row = document.createElement("div");
          row.classList.add("application-row");
          row.dataset.id = docSnap.id;
          row.dataset.applicant = data.applicantId;

          // Restore accepted state
          if (data.status === "accepted") {
            row.classList.add("accepted");
          }

          const applicantProfile = await getUserProfileById(data.applicantId);
          const safeUserName = escapeHTML(applicantProfile?.name || "User");
          const safeApplicantAvatar = escapeHTML(getSafeAvatarUrl(applicantProfile?.avatarUrl));
          const applicantUid = encodeURIComponent(data.applicantId || "");
          const isPending = data.status === "pending";
          const isAccepted = data.status === "accepted";
          const acceptedLabel =
            requestStatus === "completed"
              ? '<i class="fa-solid fa-circle-check"></i> Completed'
              : requestStatus === "in-progress"
                ? '<i class="fa-solid fa-spinner"></i> In Progress'
                : '<i class="fa-solid fa-check"></i> Accepted';

          row.innerHTML = `
        <div class="applicant-info">
          <a href="profile.html?uid=${applicantUid}" class="applicant-profile-link">
            <img src="${safeApplicantAvatar}" alt="${safeUserName} avatar" class="applicant-avatar" loading="lazy">
            <span class="applicant-name">${safeUserName}</span>
          </a>
        </div>
        ${isPending && canModerateOpen
              ? `
          <div class="application-actions">
            <button class="accept-btn">Accept</button>
            <button class="reject-btn">Reject</button>
          </div>
          `
              : isPending
                ? `<span style="color:#64748b;font-weight:600;">Pending</span>`
                : isAccepted
                  ? `<div style="display:flex;align-items:center;gap:10px;">
                   <span style="color:#10b981;font-weight:600;">${acceptedLabel}</span>
                   <a href="chat.html?uid=${applicantUid}" style="background:#6a5af9;color:white;text-decoration:none;padding:5px 12px;border-radius:14px;font-size:12px;font-weight:600;">
                     <i class="fa-solid fa-message"></i> Chat
                   </a>
                 </div>`
                  : `<span style="color:#94a3b8;font-weight:600;">Rejected</span>`
            }
      `;

          // Only request owners can view the full applicant list/status rows.
          if (canModerate) {
            container.appendChild(row);
          }

          if (currentUser && data.applicantId === currentUser.uid) {
            currentUserApplicationStatus = String(data.status || "").toLowerCase().trim();
          }
        }

        if (parentCard && currentUser && requestOwnerId !== currentUser.uid) {
          const viewerState = resolveAvailableViewerState(requestStatus, currentUserApplicationStatus);
          setAvailableCardState(parentCard, viewerState);
        }

        applyRequestFiltersAndSort();
      });
      applicationUnsubs.set(requestId, unsub);
    }

    function getUserAvatarUrl(data) {
      const candidates = [
        data?.avatarUrl,
        data?.photoURL,
        data?.profilePhoto,
        data?.profileImage,
        data?.imageUrl
      ];
      for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    }

    function getInitials(name) {
      const normalized = String(name || "User").trim();
      if (!normalized) return "U";
      const parts = normalized.split(/\s+/).filter(Boolean).slice(0, 2);
      const raw = parts.map((part) => part[0] || "").join("");
      return (raw || normalized[0] || "U").toUpperCase();
    }


    document.addEventListener("DOMContentLoaded", function () {

      /* ==============================
         MODE FLAGS
      =============================== */
      let isEditMode = false;
      let editingCard = null;
      let completingRequestId = "";

      /* ==============================
         MODAL LOGIC
      =============================== */
      const modal = document.getElementById("createModal");
      const closeBtn = document.getElementById("closeModal");
      const cancelBtn = document.getElementById("cancelModal");
      const submitBtn = document.getElementById("submitRequest");
      const actionConfirmModal = document.getElementById("actionConfirmModal");
      const actionConfirmTitle = document.getElementById("actionConfirmTitle");
      const actionConfirmMessage = document.getElementById("actionConfirmMessage");
      const actionConfirmCancel = document.getElementById("actionConfirmCancel");
      const actionConfirmProceed = document.getElementById("actionConfirmProceed");

      let activeConfirmResolver = null;
      let previousActionFocus = null;


      if (closeBtn && modal) closeBtn.addEventListener("click", () => modal.style.display = "none");
      if (cancelBtn && modal) cancelBtn.addEventListener("click", () => modal.style.display = "none");

      function closeActionConfirmModal(confirmed = false) {
        if (!actionConfirmModal) return;

        actionConfirmModal.classList.remove("is-open");
        actionConfirmModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");

        const resolve = activeConfirmResolver;
        activeConfirmResolver = null;
        if (resolve) {
          resolve(Boolean(confirmed));
        }

        if (previousActionFocus && typeof previousActionFocus.focus === "function") {
          previousActionFocus.focus();
        }
        previousActionFocus = null;
      }

      function openActionConfirmModal(options = {}) {
        if (!actionConfirmModal || !actionConfirmProceed || !actionConfirmCancel) {
          return Promise.resolve(false);
        }

        if (activeConfirmResolver) {
          activeConfirmResolver(false);
          activeConfirmResolver = null;
        }

        const {
          title = "Confirm Action",
          message = "Are you sure you want to continue?",
          confirmLabel = "Confirm",
          cancelLabel = "Cancel",
          confirmTone = "danger"
        } = options;

        if (actionConfirmTitle) actionConfirmTitle.textContent = String(title);
        if (actionConfirmMessage) actionConfirmMessage.textContent = String(message);
        actionConfirmProceed.textContent = String(confirmLabel);
        actionConfirmCancel.textContent = String(cancelLabel);
        actionConfirmProceed.classList.remove("is-danger", "is-primary");
        actionConfirmProceed.classList.add(confirmTone === "primary" ? "is-primary" : "is-danger");
        actionConfirmProceed.disabled = false;

        previousActionFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        actionConfirmModal.classList.add("is-open");
        actionConfirmModal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");

        setTimeout(() => {
          actionConfirmProceed.focus();
        }, 0);

        return new Promise((resolve) => {
          activeConfirmResolver = resolve;
        });
      }

      if (actionConfirmCancel) {
        actionConfirmCancel.addEventListener("click", () => closeActionConfirmModal(false));
      }
      if (actionConfirmProceed) {
        actionConfirmProceed.addEventListener("click", () => closeActionConfirmModal(true));
      }
      if (actionConfirmModal) {
        actionConfirmModal.addEventListener("click", (event) => {
          if (event.target === actionConfirmModal) closeActionConfirmModal(false);
        });
      }
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && actionConfirmModal?.classList.contains("is-open")) {
          event.preventDefault();
          closeActionConfirmModal(false);
        }
      });

      function openCreateRequestModal() {
        if (!modal) return;
        isEditMode = false;
        editingCard = null;

        document.getElementById("requestTitle").value = "";
        document.getElementById("requestDesc").value = "";
        document.getElementById("deadline").value = "";

        if (submitBtn) {
          submitBtn.textContent = "Create Request";
        }

        modal.style.display = "flex";
      }


      /* ==============================
         NAVIGATION
      =============================== */
      const requestsControls = document.getElementById("requestsControls");
      const allMainViews = Array.from(document.querySelectorAll(".skills-view"));
      const requestPanels = Array.from(document.querySelectorAll(".requests-tab-panel"));
      const navGroups = Array.from(document.querySelectorAll(".skills-nav-group[data-section]"));
      const groupToggleButtons = Array.from(document.querySelectorAll(".skills-menu-parent[data-section-toggle]"));
      const submenuButtons = Array.from(document.querySelectorAll(".skills-submenu-btn[data-target]"));
      const singleNavButtons = Array.from(document.querySelectorAll(".skills-menu-btn[data-target]"));

      const sectionConfig = {
        requests: {
          viewId: "requestsView",
          panels: requestPanels,
          defaultPanel: "availableRequestsPane"
        }
      };

      function setRequestsControlsVisibility(viewId, panelId = "") {
        if (!requestsControls) return;
        const showControls = viewId === "requestsView" && panelId === "availableRequestsPane";
        requestsControls.style.display = showControls ? "flex" : "none";
      }

      function showMainView(targetId) {
        const targetView = document.getElementById(targetId);
        if (!targetView) return;

        allMainViews.forEach((view) => view.classList.remove("active"));
        targetView.classList.add("active");

        setRequestsControlsVisibility(targetId);

        if (targetId === "transactionsView") {
          loadSkillTransactions(auth.currentUser?.uid || "");
        }
      }

      function clearExpandedSections() {
        navGroups.forEach((group) => {
          group.classList.remove("expanded", "active");
          const toggle = group.querySelector(".skills-menu-parent");
          if (toggle) {
            toggle.classList.remove("active");
            toggle.setAttribute("aria-expanded", "false");
          }
        });
      }

      function setExpandedSection(section) {
        navGroups.forEach((group) => {
          const isTarget = group.dataset.section === section;
          group.classList.toggle("expanded", isTarget);
          group.classList.toggle("active", isTarget);
          const toggle = group.querySelector(".skills-menu-parent");
          if (toggle) {
            toggle.classList.toggle("active", isTarget);
            toggle.setAttribute("aria-expanded", isTarget ? "true" : "false");
          }
        });
      }

      function showSectionPanel(section, panelId) {
        const config = sectionConfig[section];
        if (!config) return;

        const targetPanel =
          document.getElementById(panelId) || document.getElementById(config.defaultPanel);
        if (!targetPanel) return;

        config.panels.forEach((panel) => panel.classList.remove("active"));
        targetPanel.classList.add("active");

        showMainView(config.viewId);
        setRequestsControlsVisibility(config.viewId, targetPanel.id);

        if (targetPanel.id === "appliedRequestsPane") {
          loadAppliedRequests(auth.currentUser?.uid || "");
        }
      }

      function activateSubmenu(button) {
        const section = button.dataset.section;
        const targetId = button.dataset.target;
        if (!section || !targetId) return;

        submenuButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
        singleNavButtons.forEach((btn) => btn.classList.remove("active"));

        setExpandedSection(section);
        showSectionPanel(section, targetId);
      }

      function activateSingleNav(button) {
        const targetId = button.dataset.target;
        if (!targetId) return;

        singleNavButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
        clearExpandedSections();
        showMainView(targetId);
      }

      groupToggleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const section = btn.dataset.sectionToggle;
          if (!section) return;
          const group = btn.closest(".skills-nav-group");
          const isExpanded = !!group?.classList.contains("expanded");

          if (isExpanded) {
            clearExpandedSections();
            return;
          }

          const preferredButton =
            submenuButtons.find((item) =>
              item.dataset.section === section && item.classList.contains("active")
            ) ||
            submenuButtons.find((item) => item.dataset.section === section);

          if (preferredButton) {
            activateSubmenu(preferredButton);
          } else {
            setExpandedSection(section);
          }
        });
      });

      submenuButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          activateSubmenu(btn);
        });
      });

      singleNavButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          activateSingleNav(btn);
        });
      });

      const initialSubmenu =
        submenuButtons.find((btn) => btn.classList.contains("active")) || submenuButtons[0];
      if (initialSubmenu) {
        activateSubmenu(initialSubmenu);
      } else if (singleNavButtons[0]) {
        activateSingleNav(singleNavButtons[0]);
      }

      document.addEventListener("click", (event) => {
        const createBtn = event.target.closest("[data-create-request-btn]");
        if (!createBtn) return;
        openCreateRequestModal();
      });

      document.addEventListener("click", (event) => {
        const actionBtn = event.target.closest(".skills-empty-action");
        if (!actionBtn) return;

        const action = String(actionBtn.dataset.emptyAction || "").trim();
        if (!action) return;

        if (action === "create_request") {
          openCreateRequestModal();
          return;
        }

        if (action === "browse_requests") {
          const browseBtn = document.querySelector('.skills-submenu-btn[data-target="availableRequestsPane"]');
          if (browseBtn) browseBtn.click();
          return;
        }

      });

      document.addEventListener("click", (event) => {
        const bubbleBtn = event.target.closest(".status-bubble-btn");
        if (!bubbleBtn) return;

        const scope = bubbleBtn.dataset.scope;
        const selectedStatus = normalizeStatus(bubbleBtn.dataset.status || "");

        if (scope === "my") {
          if (!["open", "in-progress", "completed"].includes(selectedStatus)) return;
          myRequestsStatusFilter = selectedStatus;
          updateStatusBubbleUI("my", myRequestsStatusFilter);
          applyRequestFiltersAndSort();
          return;
        }

        if (scope === "applied") {
          if (!["pending", "in-progress", "completed"].includes(selectedStatus)) return;
          appliedStatusFilter = selectedStatus;
          updateStatusBubbleUI("applied", appliedStatusFilter);
          renderAppliedRequests();
        }
      });

      renderAppliedRequests();

      /* ==============================
         RATING LOGIC
      =============================== */
      document.querySelectorAll(".rating-inline").forEach(ratingBlock => {
        const rating = parseFloat(ratingBlock.dataset.rating);
        const fill = ratingBlock.querySelector(".rating-fill");
        const number = ratingBlock.querySelector(".rating-number");
        const star = ratingBlock.querySelector("i");

        number.textContent = rating.toFixed(1);
        fill.style.width = (rating / 5) * 100 + "%";

        if (rating >= 4.5) { star.style.color = fill.style.background = "#22c55e"; }
        else if (rating >= 4) { star.style.color = fill.style.background = "#facc15"; }
        else if (rating >= 3) { star.style.color = fill.style.background = "#fb923c"; }
        else { star.style.color = fill.style.background = "#ef4444"; }
      });

      /* ==============================
         DELETE REQUEST
      =============================== */
      document.addEventListener("click", async (e) => {
        if (e.target.classList.contains("delete-btn")) {

          const card = e.target.closest(".request-card");
          const requestId = card.dataset.id;

          const status = (card.dataset.status || "").toLowerCase();
          if (status !== "open") {
            showToast("Only open requests can be deleted.", "error");
            return;
          }

          const shouldDelete = await openActionConfirmModal({
            title: "Delete Request",
            message: "Are you sure you want to delete this request?",
            confirmLabel: "Delete",
            cancelLabel: "Cancel",
            confirmTone: "danger"
          });
          if (!shouldDelete) return;

          try {
            showToast("Request removed.", "success");
            await deleteDoc(doc(db, "requests", requestId));
            card.remove();
          } catch (error) {
            console.error("Error deleting request:", error);
            showToast("Could not delete the request right now.", "error");
          }
        }
      });

      document.addEventListener("click", (e) => {
        if (e.target.classList.contains("edit-btn")) {
          const card = e.target.closest(".request-card");

          isEditMode = true;
          editingCard = card;

          const title = card.querySelector("h3").textContent;
          const desc = card.dataset.desc || "";

          document.getElementById("requestTitle").value = title;
          document.getElementById("requestDesc").value = desc;

          submitBtn.textContent = "Update Request";
          modal.style.display = "flex";
          showToast("Editing request...", "info");
        }
      });

      /* ==============================
         CHARACTER COUNTER
      =============================== */
      const desc = document.getElementById("requestDesc");
      const charCount = document.getElementById("charCount");
      if (desc && charCount) {
        desc.addEventListener("input", () => {
          charCount.textContent = desc.value.length + " / 300";
        });
      }

      /* ==============================
         REWARD CALCULATION
      =============================== */
      const slider = document.getElementById("pointsSlider");
      const urgency = document.getElementById("urgency");
      const difficulty = document.getElementById("difficulty");

      function updateReward() {
        if (!slider || !urgency || !difficulty) return;
        let base = parseInt(slider.value);
        let bonus = 0;
        if (urgency.value === "high") bonus += Math.round(base * 0.1);
        if (difficulty.value === "hard") bonus += Math.round(base * 0.2);
        document.getElementById("basePoints").textContent = base;
        document.getElementById("bonusPoints").textContent = bonus;
        document.getElementById("totalPoints").textContent = base + bonus;
      }
      if (slider) slider.addEventListener("input", updateReward);
      if (urgency) urgency.addEventListener("change", updateReward);
      if (difficulty) difficulty.addEventListener("change", updateReward);
      updateReward();

      /* ==============================
        APPLY BUTTON LOGIC (Single Toggle)
     =============================== */
      document.addEventListener("click", async (e) => {
        if (e.target.classList.contains("apply-btn")) {

          const button = e.target;
          const card = button.closest(".request-card");
          if (!card || button.disabled) return;
          const requestId = card.dataset.id;
          const user = auth.currentUser;
          const viewerState = normalizeAvailableViewerState(
            button.dataset.state || card.dataset.viewerState || "open"
          );
          try {
            const requestSnap = await getDoc(doc(db, "requests", requestId));
            if (!requestSnap.exists()) {
              showToast("This request no longer exists.", "error");
              return;
            }
            const requestData = requestSnap.data() || {};
            const realStatus = normalizeStatus(requestData.status || "open");
            const requestTitle = String(requestData.title || "Request").trim() || "Request";
            const requestOwnerId = String(
              requestData.userId ||
              requestData.requesterId ||
              requestData.uid ||
              requestData.createdBy ||
              ""
            ).trim();

            if (realStatus !== "open") {
              showToast("This request is no longer open.", "error");
              setAvailableCardState(card, realStatus);
              return;
            }

            if (!user) {
              showToast("You must be logged in to apply.", "error");
              return;
            }

            if (viewerState === "applied") {
              const shouldCancelApplication = await openActionConfirmModal({
                title: "Cancel Application",
                message: "Are you sure you want to cancel this request application?",
                confirmLabel: "Cancel",
                cancelLabel: "Keep",
                confirmTone: "danger"
              });
              if (!shouldCancelApplication) return;

              let removedPendingCount = 0;
              const directApplicationRef = doc(db, "applications", buildApplicationDocId(requestId, user.uid));
              let shouldFallbackToQuery = true;

              try {
                const directSnap = await getDoc(directApplicationRef);
                if (directSnap.exists()) {
                  shouldFallbackToQuery = false;
                  if (normalizeFilterToken(directSnap.data()?.status) === "pending") {
                    await deleteDoc(directApplicationRef);
                    removedPendingCount = 1;
                  }
                }
              } catch (error) {
                if (!isPermissionDenied(error)) {
                  throw error;
                }
                shouldFallbackToQuery = false;
                try {
                  await deleteDoc(directApplicationRef);
                } catch (deleteError) {
                  if (!isPermissionDenied(deleteError)) {
                    throw deleteError;
                  }
                }
              }

              if (shouldFallbackToQuery) {
                const q = query(
                  collection(db, "applications"),
                  where("requestId", "==", requestId),
                  where("applicantId", "==", user.uid)
                );

                const snapshot = await getDocs(q);
                for (const docSnap of snapshot.docs) {
                  if (normalizeFilterToken(docSnap.data()?.status) !== "pending") continue;
                  await deleteDoc(doc(db, "applications", docSnap.id));
                  removedPendingCount += 1;
                }
              }
              if (removedPendingCount > 0) {
                const deductedPoints = XP_REWARD_APPLY_REQUEST * removedPendingCount;
                const deductionMessage = `-${deductedPoints} pts deducted because you cancelled your application for "${requestTitle}".`;
                await awardXP(user.uid, -deductedPoints, "cancel_application", {
                  notificationMessage: deductionMessage,
                  transactionTitle: deductionMessage,
                  requestId,
                  requestTitle,
                  recordTransaction: true
                });
              }
              const cancelMessage = removedPendingCount > 0
                ? `Application for "${requestTitle}" cancelled.`
                : "No pending application found to cancel.";
              setAvailableCardState(card, "open");
              showToast(cancelMessage, "info");

            } else if (viewerState === "open") {
              let hasPending = false;
              let queryCheckAllowed = true;
              const applicationDocId = buildApplicationDocId(requestId, user.uid);
              const applicationRef = doc(db, "applications", applicationDocId);

              try {
                const directSnap = await getDoc(applicationRef);
                if (directSnap.exists() && normalizeFilterToken(directSnap.data()?.status) === "pending") {
                  hasPending = true;
                }
              } catch (error) {
                if (!isPermissionDenied(error)) {
                  throw error;
                }
                queryCheckAllowed = false;
              }

              if (!hasPending && queryCheckAllowed) {
                try {
                  const existingQuery = query(
                    collection(db, "applications"),
                    where("requestId", "==", requestId),
                    where("applicantId", "==", user.uid)
                  );
                  const existingSnap = await getDocs(existingQuery);
                  existingSnap.forEach((docSnap) => {
                    if (normalizeFilterToken(docSnap.data()?.status) === "pending") {
                      hasPending = true;
                    }
                  });
                } catch (error) {
                  if (!isPermissionDenied(error)) {
                    throw error;
                  }
                }
              }

              if (!hasPending) {
                const userName = await getUserNameById(user.uid);

                await setDoc(applicationRef, {
                  requestId,
                  applicantId: user.uid,
                  applicantName: userName,
                  requestTitle,
                  status: "pending",
                  appliedAt: serverTimestamp()
                });

                if (requestOwnerId && requestOwnerId !== user.uid) {
                  await createUserNotification(requestOwnerId, {
                    message: `${userName} applied to help with "${requestTitle}".`,
                    type: "skills_request_application",
                    source: "request_application_submitted",
                    requestId,
                    actorId: user.uid,
                    actorName: userName
                  });
                }

                const awardedPoints = XP_REWARD_APPLY_REQUEST;
                const applyMessage = `+${awardedPoints} pts earned for applying to help on "${requestTitle}".`;
                await awardXP(user.uid, awardedPoints, "apply_request", {
                  notificationMessage: applyMessage,
                  transactionTitle: applyMessage,
                  requestId,
                  requestTitle,
                  recordTransaction: true
                });
              }

              setAvailableCardState(card, "applied");
              showToast(`Applied successfully for "${requestTitle}".`, "success");
            } else {
              return;
            }

            loadAppliedRequests(user.uid).catch((err) => {
              console.error("Applied requests refresh failed:", err);
            });
            loadSkillTransactions(user.uid).catch((err) => {
              console.error("Skill transactions refresh failed:", err);
            });
          } catch (error) {
            console.error("Apply/cancel action failed:", error);
            showToast("Could not update your application right now.", "error");
          }
        }
      });

      document.addEventListener("click", async (e) => {
        const withdrawBtn = e.target.closest(".withdraw-application-btn");
        if (!withdrawBtn) return;

        const user = auth.currentUser;
        if (!user) {
          showToast("You must be logged in to withdraw an application.", "error");
          return;
        }

        const applicationId = String(withdrawBtn.dataset.appId || "").trim();
        const requestId = String(withdrawBtn.dataset.requestId || "").trim();
        const rowStatus = normalizeStatus(withdrawBtn.dataset.status || "");

        if (!applicationId || !requestId) return;
        if (rowStatus !== "pending") {
          showToast("Only pending applications can be withdrawn.", "error");
          return;
        }

        const shouldWithdraw = await openActionConfirmModal({
          title: "Withdraw Application",
          message: "Are you sure you want to withdraw this application?",
          confirmLabel: "Withdraw",
          cancelLabel: "Cancel",
          confirmTone: "danger"
        });
        if (!shouldWithdraw) return;

        withdrawBtn.disabled = true;

        try {
          const applicationRef = doc(db, "applications", applicationId);
          const applicationSnap = await getDoc(applicationRef);

          if (!applicationSnap.exists()) {
            showToast("Application already removed.", "info");
            syncAvailableCardsForRequest(requestId, "open");
            loadAppliedRequests(user.uid);
            return;
          }

          const applicationData = applicationSnap.data() || {};
          if (String(applicationData.applicantId || "") !== user.uid) {
            showToast("You are not allowed to withdraw this application.", "error");
            return;
          }

          if (normalizeFilterToken(applicationData.status) !== "pending") {
            showToast("This application is no longer pending.", "error");
            syncAvailableCardsForRequest(requestId, "open");
            loadAppliedRequests(user.uid);
            return;
          }

          await deleteDoc(applicationRef);

          let requestTitle = String(applicationData.requestTitle || "").trim();
          if (!requestTitle) {
            try {
              const requestSnap = await getDoc(doc(db, "requests", requestId));
              if (requestSnap.exists()) {
                requestTitle = String(requestSnap.data()?.title || "").trim();
              }
            } catch (error) {
              // Request may be deleted already; fallback below.
            }
          }
          if (!requestTitle) requestTitle = "Request";

          const deductedPoints = XP_REWARD_APPLY_REQUEST;
          const deductionMessage = `-${deductedPoints} pts deducted because you withdrew your application for "${requestTitle}".`;
          await awardXP(user.uid, -deductedPoints, "cancel_application", {
            notificationMessage: deductionMessage,
            transactionTitle: deductionMessage,
            requestId,
            requestTitle,
            recordTransaction: true
          });

          const message = `Application withdrawn for "${requestTitle}".`;
          syncAvailableCardsForRequest(requestId, "open");
          showToast(message, "info");

          loadAppliedRequests(user.uid);
          loadSkillTransactions(user.uid);
        } catch (error) {
          console.error("Withdraw application failed:", error);
          showToast("Could not withdraw application right now.", "error");
        } finally {
          withdrawBtn.disabled = false;
        }
      });



      /* ==============================
         SUBMIT REQUEST (CREATE vs EDIT)
      ============================== */
      if (submitBtn) {
        submitBtn.addEventListener("click", async () => {

          const title = document.getElementById("requestTitle").value;
          const desc = document.getElementById("requestDesc").value;
          const category = normalizeCategoryValue(document.getElementById("category").value);
          const difficulty = document.getElementById("difficulty").value;
          const urgency = document.getElementById("urgency").value;
          const deadline = document.getElementById("deadline").value;
          const points = parseInt(document.getElementById("totalPoints").textContent, 10) || 0;

          const user = auth.currentUser;
          if (!user) {
            showToast("You must be logged in.", "error");
            return;
          }

          const defaultLabel = isEditMode ? "Update Request" : "Create Request";
          submitBtn.disabled = true;
          submitBtn.textContent = isEditMode ? "Saving..." : "Creating...";

          try {
            if (isEditMode && editingCard) {
              const requestId = editingCard.dataset.id;

              await updateDoc(doc(db, "requests", requestId), {
                title,
                desc,
                category,
                difficulty,
                urgency,
                deadline,
                points,
                updatedAt: new Date()
              });

              showToast("Request updated.", "success");
            } else {
              const requesterName = await getUserNameById(user.uid);
              await addDoc(collection(db, "requests"), {
                title,
                desc,
                category,
                difficulty,
                urgency,
                deadline,
                points,
                userId: user.uid,
                requesterName,
                requesterEmail: user.email || "",
                status: "open",
                createdAt: new Date(),
                updatedAt: new Date()
              });
              showToast("Request created.", "success");
            }

            modal.style.display = "none";
            loadRequests(user);
            loadSkillTransactions(user.uid);

          } catch (error) {
            console.error("Error saving request:", error);
            showToast("Could not save the request right now.", "error");
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = defaultLabel;
          }
        });
      }
  

      async function completeRequestById(requestId, triggerButton = null) {
        const safeRequestId = String(requestId || "").trim();
        if (!safeRequestId) return;
        if (completingRequestId === safeRequestId) return;

        const currentUser = auth.currentUser;
        if (!currentUser) {
          showToast("You must be logged in.", "error");
          return;
        }

        completingRequestId = safeRequestId;
        if (triggerButton) {
          triggerButton.disabled = true;
        }

        try {
          const requestRef = doc(db, "requests", safeRequestId);
          const requestSnap = await getDoc(requestRef);

          if (!requestSnap.exists()) {
            showToast("This request no longer exists.", "error");
            return;
          }

          const requestData = requestSnap.data() || {};
          if (requestData.userId !== currentUser.uid) {
            showToast("You are not allowed to complete this request.", "error");
            return;
          }

          if (normalizeStatus(requestData.status || "open") !== "in-progress") {
            showToast("Only in progress requests can be completed.", "error");
            return;
          }

          let helperId = String(
            requestData.helperId ||
            requestData.assignedHelperId ||
            requestData.selectedHelperId ||
            ""
          ).trim();

          if (!helperId) {
            const acceptedSnap = await getDocs(query(
              collection(db, "applications"),
              where("requestId", "==", safeRequestId),
              where("status", "==", "accepted"),
              limit(1)
            ));
            if (!acceptedSnap.empty) {
              helperId = String(acceptedSnap.docs[0].data()?.applicantId || "").trim();
            }
          }

          if (!helperId) {
            showToast("No approved helper is assigned to this request.", "error");
            return;
          }

          const helperName = String(requestData.helperName || "").trim() || "helper";
          const requestTitle = String(requestData.title || "Request").trim() || "Request";
          const rewardPoints = Math.max(0, Number(requestData.points) || 0);
          const ownerName = await getUserNameById(currentUser.uid);
          const helperCompletionMessage = `Your help on "${requestTitle}" was marked completed by ${ownerName}.`;
          const helperMessage = `+${rewardPoints} pts received for helping with ${requestTitle}`;
          const ownerMessage = `${rewardPoints} pts transferred to ${helperName} for ${requestTitle}`;

          await runTransaction(db, async (transaction) => {
            const reqRef = doc(db, "requests", safeRequestId);
            const ownerRef = doc(db, "users", currentUser.uid);
            const helperRef = doc(db, "users", helperId);
            const helperXpLogRef = doc(collection(db, "xpLogs"));
            const ownerXpLogRef = doc(collection(db, "xpLogs"));
            const helperCompletionNotifRef = doc(collection(db, "users", helperId, "notifications"));
            const helperNotifRef = doc(collection(db, "users", helperId, "notifications"));
            const ownerNotifRef = doc(collection(db, "users", currentUser.uid, "notifications"));
            const helperTxnRef = doc(collection(db, "transactions"));
            const ownerTxnRef = doc(collection(db, "transactions"));

            const reqDoc = await transaction.get(reqRef);
            if (!reqDoc.exists()) throw new Error("Request does not exist.");

            const reqData = reqDoc.data() || {};
            if (reqData.userId !== currentUser.uid) throw new Error("Not authorized.");
            if (normalizeStatus(reqData.status || "open") !== "in-progress") {
              throw new Error("Request is not in progress.");
            }

            transaction.update(reqRef, {
              status: "completed",
              completedAt: new Date(),
              updatedAt: new Date()
            });

            transaction.set(ownerRef, { points: increment(-rewardPoints) }, { merge: true });
            transaction.set(helperRef, { points: increment(rewardPoints) }, { merge: true });

            transaction.set(helperXpLogRef, {
              userId: helperId,
              amount: rewardPoints,
              createdAt: new Date()
            });
            transaction.set(ownerXpLogRef, {
              userId: currentUser.uid,
              amount: -rewardPoints,
              createdAt: new Date()
            });

            transaction.set(helperNotifRef, {
              message: helperMessage,
              read: false,
              createdAt: new Date(),
              type: "skills_reward_transfer",
              amount: rewardPoints,
              source: "request_completed_reward",
              requestId: safeRequestId
            });
            transaction.set(helperCompletionNotifRef, {
              message: helperCompletionMessage,
              read: false,
              createdAt: new Date(),
              type: "skills_request_completed",
              source: "request_marked_completed",
              requestId: safeRequestId,
              actorId: currentUser.uid,
              actorName: ownerName
            });
            transaction.set(ownerNotifRef, {
              message: ownerMessage,
              read: false,
              createdAt: new Date(),
              type: "points",
              amount: -rewardPoints,
              source: "request_reward_paid"
            });

            transaction.set(helperTxnRef, {
              userId: helperId,
              type: "skills_request_completed",
              points: rewardPoints,
              amount: rewardPoints,
              category: "skills",
              source: "request_completed_reward",
              title: helperMessage,
              requestId: safeRequestId,
              requestTitle,
              senderId: currentUser.uid,
              receiverId: helperId,
              sender: currentUser.uid,
              receiver: helperId,
              createdAt: new Date()
            });
            transaction.set(ownerTxnRef, {
              userId: currentUser.uid,
              type: "skills_request_payment",
              points: -rewardPoints,
              amount: -rewardPoints,
              category: "skills",
              source: "request_reward_paid",
              title: `-${rewardPoints} pts sent to ${helperName} for ${requestTitle}`,
              requestId: safeRequestId,
              requestTitle,
              senderId: currentUser.uid,
              receiverId: helperId,
              sender: currentUser.uid,
              receiver: helperId,
              createdAt: new Date()
            });
          });

          // Keep public profile points roughly in sync when rules allow.
          try {
            await setDoc(doc(db, "publicUsers", currentUser.uid), {
              points: increment(-rewardPoints)
            }, { merge: true });
          } catch (error) {
            if (!isPermissionDenied(error)) {
              console.warn("Owner public profile points sync failed:", error);
            }
          }

          try {
            await setDoc(doc(db, "publicUsers", helperId), {
              points: increment(rewardPoints)
            }, { merge: true });
          } catch (error) {
            if (!isPermissionDenied(error)) {
              console.warn("Helper public profile points sync failed:", error);
            }
          }

          showToast("Request completed and reward transferred.", "success");
          loadAppliedRequests(currentUser.uid);
          loadSkillTransactions(currentUser.uid);
          loadWeeklyXP(currentUser.uid);
          scheduleProgressInsightsRefresh(currentUser.uid);
        } catch (error) {
          console.error("Completion error:", error);
          showToast("Could not complete the request right now. Please try again.", "error");
        } finally {
          if (triggerButton) {
            triggerButton.disabled = false;
          }
          if (completingRequestId === safeRequestId) {
            completingRequestId = "";
          }
        }
      }

      /* ==============================
         APPLICATION ROWS
      =============================== */
      // Handle Accept / Reject Application (delegated)
      document.addEventListener("click", async (e) => {

        /* ==============================
           COMPLETE REQUEST
        =============================== */
        const completeBtn = e.target.closest(".complete-btn");
        if (completeBtn) {
          const card = completeBtn.closest(".request-card");
          if (!card) return;
          const currentUser = auth.currentUser;
          if (!currentUser) {
            showToast("You must be logged in.", "error");
            return;
          }

          const requestId = String(card.dataset.id || "").trim();
          if (!requestId) return;

          const shouldComplete = await openActionConfirmModal({
            title: "Confirm Completion",
            message: "Are you sure this request has been completed? The reward will be transferred to the helper.",
            confirmLabel: "Confirm",
            cancelLabel: "Cancel",
            confirmTone: "danger"
          });
          if (!shouldComplete) return;

          await completeRequestById(requestId, completeBtn);
          return;
        }



        /* ==============================
           ACCEPT / REJECT APPLICATION
        =============================== */
        if (e.target.classList.contains("accept-btn") || e.target.classList.contains("reject-btn")) {

          const row = e.target.closest(".application-row");
          if (!row) return;
          const applicantName = row.querySelector(".applicant-name")?.textContent || "User";
          const applicationId = row.dataset.id;
          const currentUser = auth.currentUser;
          const requestCard = row.closest(".request-card");
          const requestId = requestCard?.dataset.id;

          if (!currentUser || !requestId) {
            showToast("You are not authorized for this action.", "error");
            return;
          }

          const requestSnap = await getDoc(doc(db, "requests", requestId));
          if (!requestSnap.exists() || requestSnap.data().userId !== currentUser.uid) {
            showToast("Only the request owner can manage applications.", "error");
            return;
          }

          const requestData = requestSnap.data() || {};
          const requestTitle = String(requestData.title || "Request").trim() || "Request";
          if (normalizeStatus(requestData.status || "open") !== "open") {
            showToast("This request is no longer open for application updates.", "error");
            return;
          }

          /* ---------- ACCEPT ---------- */
          if (e.target.classList.contains("accept-btn")) {

            const shouldAccept = await openActionConfirmModal({
              title: "Accept Application",
              message: `Accept ${applicantName}'s application?`,
              confirmLabel: "Accept",
              cancelLabel: "Cancel",
              confirmTone: "danger"
            });
            if (!shouldAccept) return;

            const selectedApplicantId = String(row.dataset.applicant || "").trim();
            if (!selectedApplicantId) {
              showToast("Selected helper information is missing.", "error");
              return;
            }
            const selectedApplicationRef = doc(db, "applications", applicationId);
            const requestRef = doc(db, "requests", requestId);
            const now = new Date();

            try {
              await runTransaction(db, async (transaction) => {
                const latestRequestSnap = await transaction.get(requestRef);
                if (!latestRequestSnap.exists()) {
                  throw new Error("REQUEST_MISSING");
                }

                const latestRequestData = latestRequestSnap.data() || {};
                if (String(latestRequestData.userId || "") !== currentUser.uid) {
                  throw new Error("NOT_OWNER");
                }
                if (normalizeStatus(latestRequestData.status || "open") !== "open") {
                  throw new Error("REQUEST_CLOSED");
                }

                const existingHelperId = String(
                  latestRequestData.helperId ||
                  latestRequestData.assignedHelperId ||
                  latestRequestData.selectedHelperId ||
                  ""
                ).trim();
                if (existingHelperId) {
                  throw new Error("HELPER_ALREADY_ASSIGNED");
                }

                const selectedApplicationSnap = await transaction.get(selectedApplicationRef);
                if (!selectedApplicationSnap.exists()) {
                  throw new Error("APPLICATION_MISSING");
                }

                const selectedApplicationData = selectedApplicationSnap.data() || {};
                if (String(selectedApplicationData.requestId || "").trim() !== String(requestId)) {
                  throw new Error("APPLICATION_MISMATCH");
                }
                if (normalizeFilterToken(selectedApplicationData.status) !== "pending") {
                  throw new Error("APPLICATION_NOT_PENDING");
                }
                if (String(selectedApplicationData.applicantId || "").trim() !== selectedApplicantId) {
                  throw new Error("APPLICANT_MISMATCH");
                }

                transaction.update(selectedApplicationRef, {
                  status: "accepted",
                  reviewedAt: now
                });

                transaction.update(requestRef, {
                  status: "in_progress",
                  helperId: selectedApplicantId,
                  helperName: String(applicantName || "").trim() || "User",
                  helperApplicationId: applicationId,
                  helperAssignedAt: now,
                  updatedAt: now
                });
              });
            } catch (error) {
              const reason = String(error?.message || "").trim();
              if ([
                "REQUEST_MISSING",
                "REQUEST_CLOSED",
                "HELPER_ALREADY_ASSIGNED",
                "APPLICATION_MISSING",
                "APPLICATION_NOT_PENDING",
                "APPLICATION_MISMATCH",
                "APPLICANT_MISMATCH"
              ].includes(reason)) {
                showToast("This request is no longer open for accepting a helper.", "error");
                return;
              }
              if (reason === "NOT_OWNER") {
                showToast("Only the request owner can manage applications.", "error");
                return;
              }
              console.error("Accept helper failed:", error);
              showToast("Could not accept this application right now.", "error");
              return;
            }

            const rejectedApplicantIds = [];
            try {
              const applicationsSnap = await getDocs(
                query(collection(db, "applications"), where("requestId", "==", requestId))
              );
              const rejectBatch = writeBatch(db);
              let hasRejectUpdates = false;

              applicationsSnap.forEach((appDoc) => {
                if (appDoc.id === applicationId) return;
                const appData = appDoc.data() || {};
                const appStatus = normalizeFilterToken(appData.status);
                if (!["pending", "accepted"].includes(appStatus)) return;
                rejectBatch.update(appDoc.ref, {
                  status: "rejected",
                  reviewedAt: now
                });
                hasRejectUpdates = true;

                const rejectedApplicantId = String(appData.applicantId || "").trim();
                if (rejectedApplicantId) {
                  rejectedApplicantIds.push(rejectedApplicantId);
                }
              });

              if (hasRejectUpdates) {
                await rejectBatch.commit();
              }
            } catch (error) {
              console.warn("Auto-reject of other applications failed:", error);
            }

            if (requestCard) {
              setRequestCardStatus(requestCard, "in_progress");
              upsertAssignedHelperRow(requestCard, selectedApplicantId, applicantName);
              applyRequestFiltersAndSort();
            }

            const ownerName = currentUser.displayName || "Request owner";
            const notificationTasks = [];
            if (selectedApplicantId !== currentUser.uid) {
              notificationTasks.push(
                createUserNotification(selectedApplicantId, {
                  message: `Your application for "${requestTitle}" was approved.`,
                  type: "skills_request_application",
                  source: "request_application_approved",
                  requestId,
                  actorId: currentUser.uid,
                  actorName: ownerName
                })
              );
            }

            const rejectedTargets = [...new Set(
              rejectedApplicantIds.filter((id) => id && id !== selectedApplicantId && id !== currentUser.uid)
            )];
            rejectedTargets.forEach((targetId) => {
              notificationTasks.push(
                createUserNotification(targetId, {
                  message: `Your application for "${requestTitle}" was rejected.`,
                  type: "skills_request_application",
                  source: "request_application_rejected",
                  requestId,
                  actorId: currentUser.uid,
                  actorName: ownerName
                })
              );
            });

            if (notificationTasks.length) {
              await Promise.allSettled(notificationTasks);
            }

            showToast(`${applicantName} selected as helper.`, "success");
          }


          /* ---------- REJECT ---------- */
          if (e.target.classList.contains("reject-btn")) {

            const shouldReject = await openActionConfirmModal({
              title: "Reject Application",
              message: `Reject ${applicantName}'s application?`,
              confirmLabel: "Reject",
              cancelLabel: "Cancel",
              confirmTone: "danger"
            });
            if (!shouldReject) return;

            const rejectedApplicantId = String(row.dataset.applicant || "").trim();
            await deleteDoc(doc(db, "applications", applicationId));

            if (rejectedApplicantId && rejectedApplicantId !== currentUser.uid) {
              await createUserNotification(rejectedApplicantId, {
                message: `Your application for "${requestTitle}" was rejected.`,
                type: "skills_request_application",
                source: "request_application_rejected",
                requestId,
                actorId: currentUser.uid,
                actorName: currentUser.displayName || "Request owner"
              });
            }

            showToast(`${applicantName} rejected.`, "info");
          }
        }

      });

      /* ==============================
         LEVEL SYSTEM WITH PROGRESS BAR
      =============================== */

      // Call once on load

      /* ==============================
         REQUEST FILTERS + SORT
      =============================== */
      const requestsSearchInput = document.getElementById("requestsSearchInput");
      const requestCategoryFilter = document.getElementById("requestCategoryFilter");
      const requestDifficultyFilter = document.getElementById("requestDifficultyFilter");
      const requestUrgencyFilter = document.getElementById("requestUrgencyFilter");
      const requestSortSelect = document.getElementById("requestSortSelect");

      function ensureNoResultsMessage(listEl) {
        let msg = listEl.querySelector(".no-results");
        if (msg) return msg;
        msg = document.createElement("p");
        msg.className = "no-results my-activity-empty";
        msg.textContent = "No requests found.";
        msg.style.display = "none";
        listEl.appendChild(msg);
        return msg;
      }

      applyRequestFiltersAndSort = function () {
        const keyword = String(requestsSearchInput?.value || "").toLowerCase().trim();
        const category = String(requestCategoryFilter?.value || "all").toLowerCase().trim();
        const difficulty = String(requestDifficultyFilter?.value || "all").toLowerCase().trim();
        const urgency = String(requestUrgencyFilter?.value || "all").toLowerCase().trim();
        const sortBy = String(requestSortSelect?.value || "newest").toLowerCase().trim();

        document.querySelectorAll(".request-cards-list").forEach((listEl) => {
          const scope = listEl.dataset.requestScope;
          if (scope === "applied") return;
          const cards = Array.from(listEl.querySelectorAll(".request-card"));
          const visibleCards = [];

          cards.forEach((card) => {
            const cardTitle = String(card.querySelector(".request-title")?.textContent || "").toLowerCase();
            const cardDesc = String(card.dataset.desc || "").toLowerCase();
            const cardCategory = String(card.dataset.category || "").toLowerCase();
            const cardDifficulty = String(card.dataset.difficulty || "").toLowerCase();
            const cardUrgency = String(card.dataset.urgency || "").toLowerCase();
            const cardStatus = card.dataset.status;

            const matchesKeyword = !keyword || cardTitle.includes(keyword) || cardDesc.includes(keyword);
            const matchesCategory = category === "all" || cardCategory === category;
            const matchesDifficulty = difficulty === "all" || cardDifficulty === difficulty;
            const matchesUrgency = urgency === "all" || cardUrgency === urgency;
            const matchesStatus = (scope === "my") ? (cardStatus === myRequestsStatusFilter) : (cardStatus === "open");

            const isVisible = matchesKeyword && matchesCategory && matchesDifficulty && matchesUrgency && matchesStatus;
            card.style.display = isVisible ? "" : "none";
            if (isVisible) visibleCards.push(card);
          });

          // Sort and reapplied
          visibleCards.sort((a, b) => {
            if (sortBy === "highest_reward") return Number(b.dataset.points) - Number(a.dataset.points);
            return Number(b.dataset.createdTs) - Number(a.dataset.createdTs);
          }).forEach(card => listEl.appendChild(card));

          const noResults = ensureNoResultsMessage(listEl);
          noResults.style.display = (visibleCards.length === 0 && cards.length > 0) ? "block" : "none";
        });

        if (typeof updateStatusBubbleUI === "function") updateStatusBubbleUI("my", myRequestsStatusFilter);
        if (typeof renderAppliedRequests === "function") renderAppliedRequests();
      };

      [requestsSearchInput, requestCategoryFilter, requestDifficultyFilter, requestUrgencyFilter, requestSortSelect].forEach(el => {
        el?.addEventListener(el.tagName === "INPUT" ? "input" : "change", applyRequestFiltersAndSort);
      });

      applyRequestFiltersAndSort();
    });
