type Message = {
  role: "user" | "assistant";
  content: string;
};

const conversations = new Map<string, Message[]>();

export function getConversation(
  conversationId: string
): Message[] {
  return conversations.get(conversationId) ?? [];
}

export function addMessage(
  conversationId: string,
  message: Message
) {
  const messages = getConversation(conversationId);

  messages.push(message);

  conversations.set(
    conversationId,
    messages
  );
}