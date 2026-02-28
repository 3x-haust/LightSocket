import { useEffect, useMemo, useState } from "react";
import { createClient } from "lightsocket/client";
import { createLightsocketSdk } from "./generated/lightsocket-sdk";

type ChatMessage = {
  id: string;
  roomId: string;
  text: string;
  sender: string;
  senderName: string;
  sentAt: number;
};

function App() {
  const [roomId, setRoomId] = useState("room-1");
  const [name, setName] = useState(() => `user-${Math.random().toString(36).slice(2, 6)}`);
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState("connecting");
  const [typingText, setTypingText] = useState("");
  const [memberCount, setMemberCount] = useState(0);
  const [myClientId, setMyClientId] = useState("");
  const [isComposing, setIsComposing] = useState(false);

  const client = useMemo(() => {
    return createClient("ws://localhost:3000/realtime", {
      autoReconnect: true,
      reconnectInterval: 800,
      maxReconnectInterval: 6000,
    });
  }, []);

  const sdk = useMemo(() => createLightsocketSdk(client), [client]);

  useEffect(() => {
    const unsubConnected = sdk.system.onConnected((payload: unknown) => {
      const parsed = payload as { clientId?: string };
      if (parsed.clientId) {
        setMyClientId(parsed.clientId);
      }
      setStatus("connected");
      sdk.chat.join({ roomId });
    });

    const unsubMessage = sdk.chat.onSendMessage((payload: unknown) => {
      const message = payload as ChatMessage;
      setMessages((prev) => [...prev, message]);
      setTypingText("");
    });

    const unsubJoin = sdk.chat.onJoin(() => {
      setStatus("joined");
    });

    const unsubTyping = sdk.chat.onTyping((payload: unknown) => {
      const parsed = payload as { name?: string };
      if (!parsed.name) {
        return;
      }
      setTypingText(`${parsed.name} is typing...`);
      window.setTimeout(() => {
        setTypingText("");
      }, 1200);
    });

    const unsubRoomState = sdk.chat.onRoomState((payload: unknown) => {
      const parsed = payload as { members?: number };
      if (typeof parsed.members === "number") {
        setMemberCount(parsed.members);
      }
    });

    return () => {
      unsubConnected();
      unsubMessage();
      unsubJoin();
      unsubTyping();
      unsubRoomState();
      client.disconnect();
    };
  }, [client, sdk, roomId]);

  function handleSend() {
    if (!text.trim()) {
      return;
    }
    sdk.chat.sendMessage({ roomId, text, name });
    setText("");
  }

  function handleTyping() {
    sdk.chat.typing({ roomId, name });
  }

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "24px auto",
        fontFamily: "Inter, system-ui, sans-serif",
        border: "1px solid #e7e7e7",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <header style={{ padding: "16px 20px", borderBottom: "1px solid #eee", background: "#fafafa" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>LightSocket Chat</h1>
        <p style={{ margin: "6px 0 0", color: "#666", fontSize: 13 }}>
          status: {status} · room members: {memberCount}
        </p>
      </header>

      <section style={{ padding: 16, display: "grid", gap: 10, borderBottom: "1px solid #eee" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="nickname" style={{ padding: 10 }} />
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="room id"
            style={{ padding: 10 }}
          />
          <button
            onClick={() => {
              setMessages([]);
              sdk.chat.join({ roomId });
            }}
          >
            Join
          </button>
        </div>
      </section>

      <section style={{ minHeight: 360, maxHeight: 420, overflowY: "auto", padding: 16, background: "#fcfcff" }}>
        {messages.length === 0 && <p style={{ color: "#888" }}>No messages yet. Say hello.</p>}
        {messages.map((message) => {
          const mine = myClientId !== "" && message.sender === myClientId;
          return (
            <div
              key={message.id}
              style={{
                display: "flex",
                justifyContent: mine ? "flex-end" : "flex-start",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  maxWidth: "72%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: mine ? "#3b82f6" : "#ffffff",
                  color: mine ? "#ffffff" : "#222",
                  border: mine ? "none" : "1px solid #e3e3e3",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                  {message.senderName} · {new Date(message.sentAt).toLocaleTimeString()}
                </div>
                <div>{message.text}</div>
              </div>
            </div>
          );
        })}
        {typingText && <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>{typingText}</p>}
      </section>

      <footer style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #eee" }}>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            handleTyping();
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder="Type your message"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isComposing && !(e.nativeEvent as KeyboardEvent).isComposing) {
              handleSend();
            }
          }}
        />
        <button onClick={handleSend} style={{ padding: "0 16px" }}>
          Send
        </button>
      </footer>
    </main>
  );
}

export default App;
