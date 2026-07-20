/* eslint-disable max-len, brace-style, block-spacing */
import {after, before, beforeEach, test} from "node:test";
import {readFileSync} from "node:fs";
import {assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment} from "@firebase/rules-unit-testing";
import {doc, getDoc, serverTimestamp, setDoc, updateDoc} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
let environment: RulesTestEnvironment;

before(async () => {
  if (!host) return;
  const [hostname, port] = host.split(":");
  environment = await initializeTestEnvironment({
    projectId: "demo-tennismate-event-chat",
    firestore: {
      host: hostname,
      port: Number(port),
      rules: readFileSync(`${process.cwd()}/../firestore.rules`, "utf8"),
    },
  });
});

beforeEach(async () => { if (environment) await environment.clearFirestore(); });
after(async () => { if (environment) await environment.cleanup(); });

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

function eventConversation(eventId: string, participants: string[]) {
  return {
    participants,
    context: {type: "event", eventId, title: "Test Event"},
    typing: {},
    lastRead: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

test("an event host can create the unique event chat before anyone joins", {skip: !host}, async () => {
  await seed("events/solo-event", {hostId: "host", participants: [], status: "open"});
  const db = environment.authenticatedContext("host").firestore();

  await assertSucceeds(setDoc(
    doc(db, "conversations", "event_solo-event"),
    eventConversation("solo-event", ["host"]),
  ));
});

test("an accepted attendee can create only the canonical event chat", {skip: !host}, async () => {
  await seed("events/group-event", {hostId: "host", participants: ["player-1"], status: "open"});
  const db = environment.authenticatedContext("player-1").firestore();

  await assertSucceeds(setDoc(
    doc(db, "conversations", "event_group-event"),
    eventConversation("group-event", ["host", "player-1"]),
  ));
  await assertFails(setDoc(
    doc(db, "conversations", "another-event-chat"),
    eventConversation("group-event", ["host", "player-1"]),
  ));
});

test("event membership can synchronize after another attendee is accepted", {skip: !host}, async () => {
  await seed("events/growing-event", {hostId: "host", participants: ["player-1"], status: "open"});
  await seed("conversations/event_growing-event", eventConversation("growing-event", ["host", "player-1"]));
  await seed("events/growing-event", {hostId: "host", participants: ["player-1", "player-2"], status: "open"});
  const db = environment.authenticatedContext("host").firestore();

  await assertSucceeds(updateDoc(doc(db, "conversations", "event_growing-event"), {
    participants: ["host", "player-1", "player-2"],
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(db, "conversations", "event_growing-event"), {
    participants: ["host", "player-1", "player-2", "outsider"],
  }));

  await seed("events/growing-event", {hostId: "host", participants: ["player-2"], status: "open"});
  await assertSucceeds(updateDoc(doc(db, "conversations", "event_growing-event"), {
    participants: ["host", "player-2"],
    updatedAt: serverTimestamp(),
  }));
});

test("only current event attendees can read and send event messages", {skip: !host}, async () => {
  await seed("events/private-event", {hostId: "host", participants: ["player-1"], status: "open"});
  await seed("conversations/event_private-event", eventConversation("private-event", ["host", "player-1"]));
  const participantDb = environment.authenticatedContext("player-1").firestore();
  const outsiderDb = environment.authenticatedContext("outsider").firestore();
  const conversationPath = "conversations/event_private-event";

  await assertSucceeds(getDoc(doc(participantDb, conversationPath)));
  await assertFails(getDoc(doc(outsiderDb, conversationPath)));
  await assertSucceeds(setDoc(doc(participantDb, conversationPath, "messages", "participant-message"), {
    senderId: "player-1",
    recipientId: null,
    text: "Hello everyone",
    timestamp: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(outsiderDb, conversationPath, "messages", "outsider-message"), {
    senderId: "outsider",
    recipientId: null,
    text: "I should not be here",
    timestamp: serverTimestamp(),
  }));
});

test("direct conversations remain available only to their participants", {skip: !host}, async () => {
  await seed("conversations/player-1_player-2", {participants: ["player-1", "player-2"]});
  const participantDb = environment.authenticatedContext("player-1").firestore();
  const outsiderDb = environment.authenticatedContext("outsider").firestore();
  const conversationPath = "conversations/player-1_player-2";

  await assertSucceeds(getDoc(doc(participantDb, conversationPath)));
  await assertFails(getDoc(doc(outsiderDb, conversationPath)));
  await assertSucceeds(setDoc(doc(participantDb, conversationPath, "messages", "participant-message"), {
    senderId: "player-1",
    recipientId: "player-2",
    text: "Hello",
    timestamp: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(outsiderDb, conversationPath, "messages", "outsider-message"), {
    senderId: "outsider",
    recipientId: "player-2",
    text: "I should not be here",
    timestamp: serverTimestamp(),
  }));
});
