// models/Conversation.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ConversationSchema = new Schema(
  {
    subject: { type: String, trim: true, default: null }, // optional
    conversationAdvertId: {
      type: Schema.Types.ObjectId,
      ref: "Advert",
      index: true,
      default: null,
    },
    lastMessageAt: { type: Date, index: true, default: null },
    lastMessage: {
      _id: { type: Schema.Types.ObjectId, ref: "Message", default: null },
      senderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
      body: { type: String, default: null },
      createdAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  }
);

// index to quickly find convos that belong to an advert
ConversationSchema.index({ conversationAdvertId: 1, lastMessageAt: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);
