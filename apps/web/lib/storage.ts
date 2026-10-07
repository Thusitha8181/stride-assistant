import type { Message } from "./messages";

const KEY = "stride-chat-v1";

export type StoredChat = { sessionId: string | null; messages: Message[] };

/** Per-browser convenience only: storage can be unavailable (private mode), so every call is guarded. */
export function loadChat(): StoredChat | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredChat;
    return Array.isArray(parsed.messages) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveChat(chat: StoredChat) {
  try {
    // Only finished messages: a half-streamed answer can't be resumed after a reload.
    const messages = chat.messages.filter((m) => m.role === "user" || m.status === "done");
    localStorage.setItem(KEY, JSON.stringify({ ...chat, messages }));
  } catch {
    // Storage full or blocked: the chat still works, it just won't survive a reload.
  }
}

export function clearChat() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
