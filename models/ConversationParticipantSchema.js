// models/ConversationParticipant.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ConversationParticipantSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isMuted: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    // lastReadAt used to compute unread counts
    lastReadAt: { type: Date, default: null, index: true },
    joinedAt: { type: Date, default: Date.now },
    role: { type: String, enum: ["member", "admin"], default: "member" }, // optional
  },
  { timestamps: true }
);

// prevent duplicate participant rows
ConversationParticipantSchema.index(
  { conversationId: 1, userId: 1 },
  { unique: true }
);

// index to list participant's conversations fast
ConversationParticipantSchema.index({
  userId: 1,
  conversationId: 1,
  joinedAt: -1,
});

module.exports = mongoose.model(
  "ConversationParticipant",
  ConversationParticipantSchema
);
