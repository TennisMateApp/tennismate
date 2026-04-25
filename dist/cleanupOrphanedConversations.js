"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var app_1 = require("firebase-admin/app");
var firestore_1 = require("firebase-admin/firestore");
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_url_1 = require("node:url");
var __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
var __dirname = node_path_1.default.dirname(__filename);
var serviceAccountPath = node_path_1.default.join(__dirname, "serviceAccountKey.json");
if (!(0, node_fs_1.existsSync)(serviceAccountPath)) {
    console.error("Service account file not found:", serviceAccountPath);
    process.exit(1);
}
var serviceAccount = JSON.parse((0, node_fs_1.readFileSync)(serviceAccountPath, "utf8"));
(0, app_1.initializeApp)({
    credential: (0, app_1.cert)(serviceAccount),
});
var db = (0, firestore_1.getFirestore)();
var APPLY = process.argv.includes("--apply");
var DRY_RUN = !APPLY;
var BATCH_LIMIT = 400;
function chunk(values, size) {
    var chunks = [];
    for (var i = 0; i < values.length; i += size) {
        chunks.push(values.slice(i, i + size));
    }
    return chunks;
}
function deleteRefsInBatches(refs) {
    return __awaiter(this, void 0, void 0, function () {
        var uniqueRefs, _loop_1, _i, _a, refChunk;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    uniqueRefs = Array.from(new Map(refs.map(function (ref) { return [ref.path, ref]; })).values());
                    _loop_1 = function (refChunk) {
                        var batch;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    batch = db.batch();
                                    refChunk.forEach(function (ref) { return batch.delete(ref); });
                                    return [4 /*yield*/, batch.commit()];
                                case 1:
                                    _c.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, _a = chunk(uniqueRefs, BATCH_LIMIT);
                    _b.label = 1;
                case 1:
                    if (!(_i < _a.length)) return [3 /*break*/, 4];
                    refChunk = _a[_i];
                    return [5 /*yield**/, _loop_1(refChunk)];
                case 2:
                    _b.sent();
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, uniqueRefs.length];
            }
        });
    });
}
function deleteConversationDeep(conversationId) {
    return __awaiter(this, void 0, void 0, function () {
        var convoRef, messagesSnap, messagesRef, deletedMessages, _loop_2, state_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    convoRef = db.collection("conversations").doc(conversationId);
                    if (!(typeof db.recursiveDelete === "function")) return [3 /*break*/, 3];
                    return [4 /*yield*/, convoRef.collection("messages").get()];
                case 1:
                    messagesSnap = _a.sent();
                    return [4 /*yield*/, db.recursiveDelete(convoRef)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, messagesSnap.size];
                case 3:
                    console.warn("[cleanupOrphanedConversations] recursiveDelete unavailable; falling back to direct messages-only cleanup for ".concat(conversationId));
                    messagesRef = convoRef.collection("messages");
                    deletedMessages = 0;
                    _loop_2 = function () {
                        var snap, batch;
                        return __generator(this, function (_b) {
                            switch (_b.label) {
                                case 0: return [4 /*yield*/, messagesRef.limit(BATCH_LIMIT).get()];
                                case 1:
                                    snap = _b.sent();
                                    if (snap.empty)
                                        return [2 /*return*/, "break"];
                                    deletedMessages += snap.size;
                                    batch = db.batch();
                                    snap.docs.forEach(function (docSnap) { return batch.delete(docSnap.ref); });
                                    return [4 /*yield*/, batch.commit()];
                                case 2:
                                    _b.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _a.label = 4;
                case 4:
                    if (!true) return [3 /*break*/, 6];
                    return [5 /*yield**/, _loop_2()];
                case 5:
                    state_1 = _a.sent();
                    if (state_1 === "break")
                        return [3 /*break*/, 6];
                    return [3 /*break*/, 4];
                case 6: return [4 /*yield*/, convoRef.delete().catch(function () { })];
                case 7:
                    _a.sent();
                    return [2 /*return*/, deletedMessages];
            }
        });
    });
}
function getMissingParticipantStatus(uid, cache) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, userSnap, playerSnap, missing;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (cache.has(uid))
                        return [2 /*return*/, cache.get(uid)];
                    return [4 /*yield*/, Promise.all([
                            db.collection("users").doc(uid).get(),
                            db.collection("players").doc(uid).get(),
                        ])];
                case 1:
                    _a = _b.sent(), userSnap = _a[0], playerSnap = _a[1];
                    missing = !userSnap.exists && !playerSnap.exists;
                    cache.set(uid, missing);
                    return [2 /*return*/, missing];
            }
        });
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var participantMissingCache, inviteRefsHandled, scannedConversations, orphanedConversations, deletedConversations, deletedMessages, deletedConversationInvites, skippedSharedConversations, scannedInvites, orphanedStandaloneInvites, deletedStandaloneInvites, conversationSnap, _i, _a, convoDoc, data, participants, missingParticipants, _b, participants_1, participantUid, messagesSnap, invitesSnap, _c, _d, inviteSnap, _e, _f, inviteDoc, data, participantUids, missingParticipants, _g, participantUids_1, participantUid;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    console.log("Starting orphaned conversation cleanup...");
                    console.log("Project:", serviceAccount.project_id);
                    console.log("Mode:", DRY_RUN ? "DRY RUN" : "APPLY");
                    participantMissingCache = new Map();
                    inviteRefsHandled = new Set();
                    scannedConversations = 0;
                    orphanedConversations = 0;
                    deletedConversations = 0;
                    deletedMessages = 0;
                    deletedConversationInvites = 0;
                    skippedSharedConversations = 0;
                    scannedInvites = 0;
                    orphanedStandaloneInvites = 0;
                    deletedStandaloneInvites = 0;
                    return [4 /*yield*/, db.collection("conversations").get()];
                case 1:
                    conversationSnap = _h.sent();
                    console.log("Loaded ".concat(conversationSnap.size, " conversations"));
                    _i = 0, _a = conversationSnap.docs;
                    _h.label = 2;
                case 2:
                    if (!(_i < _a.length)) return [3 /*break*/, 12];
                    convoDoc = _a[_i];
                    scannedConversations++;
                    data = convoDoc.data();
                    participants = Array.isArray(data.participants)
                        ? data.participants.filter(function (value) { return typeof value === "string" && !!value; })
                        : [];
                    missingParticipants = [];
                    _b = 0, participants_1 = participants;
                    _h.label = 3;
                case 3:
                    if (!(_b < participants_1.length)) return [3 /*break*/, 6];
                    participantUid = participants_1[_b];
                    return [4 /*yield*/, getMissingParticipantStatus(participantUid, participantMissingCache)];
                case 4:
                    if (_h.sent()) {
                        missingParticipants.push(participantUid);
                    }
                    _h.label = 5;
                case 5:
                    _b++;
                    return [3 /*break*/, 3];
                case 6:
                    if (!missingParticipants.length)
                        return [3 /*break*/, 11];
                    orphanedConversations++;
                    if (participants.length !== 2) {
                        skippedSharedConversations++;
                        console.log("[skipped-shared-conversation]", {
                            conversationId: convoDoc.id,
                            participants: participants,
                            missingParticipants: missingParticipants,
                        });
                        return [3 /*break*/, 11];
                    }
                    return [4 /*yield*/, convoDoc.ref.collection("messages").get()];
                case 7:
                    messagesSnap = _h.sent();
                    return [4 /*yield*/, db
                            .collection("match_invites")
                            .where("conversationId", "==", convoDoc.id)
                            .get()];
                case 8:
                    invitesSnap = _h.sent();
                    console.log("[orphaned-conversation]", {
                        conversationId: convoDoc.id,
                        participants: participants,
                        missingParticipants: missingParticipants,
                        messages: messagesSnap.size,
                        relatedInvites: invitesSnap.size,
                    });
                    invitesSnap.docs.forEach(function (docSnap) { return inviteRefsHandled.add(docSnap.ref.path); });
                    if (DRY_RUN)
                        return [3 /*break*/, 11];
                    _c = deletedMessages;
                    return [4 /*yield*/, deleteConversationDeep(convoDoc.id)];
                case 9:
                    deletedMessages = _c + _h.sent();
                    deletedConversations++;
                    _d = deletedConversationInvites;
                    return [4 /*yield*/, deleteRefsInBatches(invitesSnap.docs.map(function (docSnap) { return docSnap.ref; }))];
                case 10:
                    deletedConversationInvites = _d + _h.sent();
                    _h.label = 11;
                case 11:
                    _i++;
                    return [3 /*break*/, 2];
                case 12: return [4 /*yield*/, db.collection("match_invites").get()];
                case 13:
                    inviteSnap = _h.sent();
                    console.log("Loaded ".concat(inviteSnap.size, " match_invites"));
                    _e = 0, _f = inviteSnap.docs;
                    _h.label = 14;
                case 14:
                    if (!(_e < _f.length)) return [3 /*break*/, 21];
                    inviteDoc = _f[_e];
                    scannedInvites++;
                    if (inviteRefsHandled.has(inviteDoc.ref.path))
                        return [3 /*break*/, 20];
                    data = inviteDoc.data();
                    participantUids = [data.fromUserId, data.toUserId].filter(function (value) { return typeof value === "string" && !!value; });
                    missingParticipants = [];
                    _g = 0, participantUids_1 = participantUids;
                    _h.label = 15;
                case 15:
                    if (!(_g < participantUids_1.length)) return [3 /*break*/, 18];
                    participantUid = participantUids_1[_g];
                    return [4 /*yield*/, getMissingParticipantStatus(participantUid, participantMissingCache)];
                case 16:
                    if (_h.sent()) {
                        missingParticipants.push(participantUid);
                    }
                    _h.label = 17;
                case 17:
                    _g++;
                    return [3 /*break*/, 15];
                case 18:
                    if (!missingParticipants.length)
                        return [3 /*break*/, 20];
                    orphanedStandaloneInvites++;
                    console.log("[orphaned-invite]", {
                        inviteId: inviteDoc.id,
                        conversationId: typeof data.conversationId === "string" ? data.conversationId : null,
                        participants: participantUids,
                        missingParticipants: missingParticipants,
                    });
                    if (DRY_RUN)
                        return [3 /*break*/, 20];
                    return [4 /*yield*/, inviteDoc.ref.delete()];
                case 19:
                    _h.sent();
                    deletedStandaloneInvites++;
                    _h.label = 20;
                case 20:
                    _e++;
                    return [3 /*break*/, 14];
                case 21:
                    console.log("Cleanup complete.");
                    console.log({
                        dryRun: DRY_RUN,
                        scannedConversations: scannedConversations,
                        orphanedConversations: orphanedConversations,
                        deletedConversations: deletedConversations,
                        deletedMessages: deletedMessages,
                        deletedConversationInvites: deletedConversationInvites,
                        skippedSharedConversations: skippedSharedConversations,
                        scannedInvites: scannedInvites,
                        orphanedStandaloneInvites: orphanedStandaloneInvites,
                        deletedStandaloneInvites: deletedStandaloneInvites,
                    });
                    return [2 /*return*/];
            }
        });
    });
}
run().catch(function (error) {
    console.error("Cleanup failed:", error);
    process.exit(1);
});
