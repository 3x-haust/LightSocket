import { defineEvents } from "lightsocket/server";

const roomMembers = new Map();

function getRoom(roomId) {
  const key = `room:${roomId}`;
  const found = roomMembers.get(key) ?? new Set();
  roomMembers.set(key, found);
  return found;
}

export default defineEvents("chat", {
  join(ctx, payload) {
    const roomId = typeof payload?.roomId === "string" ? payload.roomId : "room-1";
    const roomName = `room:${roomId}`;
    ctx.joinRoom(roomName);

    const members = getRoom(roomId);
    members.add(ctx.clientId);

    ctx.emit("chat.join", { roomId, clientId: ctx.clientId });
    ctx.emitToRoom(roomName, "chat.roomState", { roomId, members: members.size });
  },
  typing(ctx, payload) {
    const roomId = typeof payload?.roomId === "string" ? payload.roomId : "room-1";
    const name = typeof payload?.name === "string" ? payload.name : "anonymous";
    const roomName = `room:${roomId}`;

    ctx.emitToRoom(
      roomName,
      "chat.typing",
      {
        roomId,
        name,
        clientId: ctx.clientId,
      },
      { excludeSelf: true }
    );
  },
  sendMessage(ctx, payload) {
    const roomId = typeof payload?.roomId === "string" ? payload.roomId : "room-1";
    const text = typeof payload?.text === "string" ? payload.text : "";
    const name = typeof payload?.name === "string" ? payload.name : "anonymous";
    if (!text.trim()) {
      return;
    }

    const message = {
      id: crypto.randomUUID(),
      roomId,
      text,
      sender: ctx.clientId,
      senderName: name,
      sentAt: Date.now(),
    };

    ctx.emitToRoom(`room:${roomId}`, "chat.sendMessage", message);
  },
});
