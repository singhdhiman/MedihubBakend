// sockets/socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Conversation = require("../models/ConversationSchema");
const ConversationParticipant = require("../models/ConversationParticipantSchema");
const Message = require("../models/MessageSchema");

const JWT_SECRET = process.env.ACCESS_TOKEN_SECRET;

/**
 * Initialize socket.io on an existing HTTP server.
 * @param {http.Server} server - the Node http server (returned by http.createServer(app))
 * @param {Object} options - optional { cors }
 */
function initSocket(server, options = {}) {
  const io = new Server(server, {
    cors: options.cors || {
      origin: options.origin || "*",
      methods: ["GET", "POST"],
    },
  });

  // simple jwt verification helper
  async function verifyToken(token) {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return payload;
    } catch (err) {
      return null;
    }
  }

  // returns true if socket with userId is present in room convRoom
  async function isUserInRoom(ioInstance, convRoom, userId) {
    try {
      const socketsSet = await ioInstance.in(convRoom).allSockets();
      for (const sid of socketsSet) {
        const s = ioInstance.sockets.sockets.get(sid);
        if (
          s &&
          s.user &&
          s.user.id &&
          s.user.id.toString() === userId.toString()
        )
          return true;
      }
    } catch (e) {}
    return false;
  }

  // middleware authentication
  io.use(async (socket, next) => {
    try {
      // Prefer auth token from handshake.auth, fallback to query or cookie header
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers?.cookie &&
          parseCookieToken(socket.handshake.headers.cookie));

      const payload = await verifyToken(token);
      if (!payload || !payload.userId) return next(new Error("unauthorized"));
      socket.user = { id: payload.userId, ...payload };
      return next();
    } catch (err) {
      return next(new Error("unauthorized"));
    }
  });

  // helper to parse cookie string for token=... (if you're sending JWT via cookie)
  function parseCookieToken(cookieStr = "") {
    // naive parse; adapt if your cookie name differs
    const cookies = cookieStr.split(";").map((c) => c.trim());
    for (const c of cookies) {
      if (c.startsWith("token=") || c.startsWith("jwt=")) {
        return c.split("=")[1];
      }
    }
    return null;
  }

  io.on("connection", (socket) => {
    const userId = socket.user.id.toString();
    // personal room for direct notifications
    socket.join(`user_${userId}`);

    // Convenience join function
    async function joinConversationRoom(convId) {
      socket.join(`conv_${convId}`);
    }

    // create_or_get_conversation
    socket.on("create_or_get_conversation", async (payload, cb) => {
      try {
        const {
          advertId = null,
          subject = null,
          participantIds = [],
        } = payload || {};
        const participants = Array.from(
          new Set([userId, ...(participantIds || [])])
        );

        let conversation = null;
        if (advertId) {
          // heuristic: attempt to find conversation by advert
          conversation = await Conversation.findOne({
            conversationAdvertId: advertId,
          }).sort({ lastMessageAt: -1 });
        }

        if (!conversation) {
          conversation = new Conversation({
            subject,
            conversationAdvertId: advertId || null,
            lastMessageAt: null,
          });
          await conversation.save();

          const docs = participants.map((uid) => ({
            conversationId: conversation._id,
            userId: uid,
            lastReadAt: uid === userId ? new Date() : null,
          }));
          await ConversationParticipant.insertMany(docs);
        }

        await joinConversationRoom(conversation._id.toString());
        const convLean = await Conversation.findById(conversation._id).lean();
        cb && cb(null, convLean);
      } catch (err) {
        console.error("create_or_get_conversation", err);
        cb && cb({ error: "failed_to_create_or_get_conversation" });
      }
    });

    // join_conversation
    socket.on("join_conversation", async ({ conversationId }, cb) => {
      try {
        if (!conversationId)
          return cb && cb({ error: "conversationId_required" });

        await ConversationParticipant.updateOne(
          { conversationId, userId },
          { $setOnInsert: { conversationId, userId, joinedAt: new Date() } },
          { upsert: true }
        );

        await joinConversationRoom(conversationId);
        cb && cb(null, { ok: true });
      } catch (err) {
        console.error("join_conversation", err);
        cb && cb({ error: "failed_to_join" });
      }
    });

    // leave_conversation
    socket.on("leave_conversation", async ({ conversationId }, cb) => {
      try {
        socket.leave(`conv_${conversationId}`);
        cb && cb(null, { ok: true });
      } catch (err) {
        cb && cb({ error: "failed_to_leave" });
      }
    });

    // send_message
    socket.on("send_message", async (payload, cb) => {
      try {
        const { conversationId, body = "", attachments = [] } = payload || {};
        if (!conversationId)
          return cb && cb({ error: "conversationId_required" });

        const msg = new Message({
          conversationId,
          senderId: userId,
          body,
          attachments,
        });
        await msg.save();

        await Conversation.findByIdAndUpdate(conversationId, {
          $set: {
            lastMessage: {
              _id: msg._id,
              senderId: userId,
              body,
              createdAt: msg.createdAt,
            },
            lastMessageAt: msg.createdAt,
          },
        });

        const payloadToEmit = {
          _id: msg._id,
          conversationId,
          senderId: msg.senderId,
          body: msg.body,
          attachments: msg.attachments,
          createdAt: msg.createdAt,
        };

        // broadcast to conversation room
        io.to(`conv_${conversationId}`).emit("message_new", payloadToEmit);

        // notify participants not in room
        const participants = await ConversationParticipant.find({
          conversationId,
        }).lean();
        for (const p of participants) {
          const inRoom = await isUserInRoom(
            io,
            `conv_${conversationId}`,
            p.userId
          );
          if (!inRoom) {
            io.to(`user_${p.userId.toString()}`).emit("message_notify", {
              conversationId,
              preview: body?.slice(0, 200),
              lastMessageAt: msg.createdAt,
            });
          }
        }

        cb && cb(null, payloadToEmit);
      } catch (err) {
        console.error("send_message", err);
        cb && cb({ error: "failed_to_send" });
      }
    });

    // fetch_conversations
    socket.on(
      "fetch_conversations",
      async ({ page = 1, limit = 20 } = {}, cb) => {
        try {
          const skip = (page - 1) * limit;
          const participantRows = await ConversationParticipant.find({ userId })
            .sort({ joinedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          const convIds = participantRows.map((p) => p.conversationId);
          const conversations = await Conversation.find({
            _id: { $in: convIds },
          })
            .sort({ lastMessageAt: -1 })
            .lean();

          const convWithMeta = [];
          for (const c of conversations) {
            const p =
              participantRows.find(
                (pr) => pr.conversationId.toString() === c._id.toString()
              ) || {};
            const lastRead = p?.lastReadAt || new Date(0);
            const unread = await Message.countDocuments({
              conversationId: c._id,
              createdAt: { $gt: lastRead },
            });
            convWithMeta.push({
              ...c,
              participantMeta: p,
              unreadCount: unread,
            });
          }

          cb && cb(null, { conversations: convWithMeta, page, limit });
        } catch (err) {
          console.error("fetch_conversations", err);
          cb && cb({ error: "failed_fetch_conversations" });
        }
      }
    );

    // fetch_messages
    socket.on(
      "fetch_messages",
      async ({ conversationId, page = 1, limit = 50 } = {}, cb) => {
        try {
          if (!conversationId)
            return cb && cb({ error: "conversationId_required" });
          const skip = (page - 1) * limit;

          const messages = await Message.find({ conversationId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

          cb && cb(null, { messages: messages.reverse(), page, limit });
        } catch (err) {
          console.error("fetch_messages", err);
          cb && cb({ error: "failed_fetch_messages" });
        }
      }
    );

    // mark_read
    socket.on("mark_read", async ({ conversationId }, cb) => {
      try {
        if (!conversationId)
          return cb && cb({ error: "conversationId_required" });
        await ConversationParticipant.updateOne(
          { conversationId, userId },
          { $set: { lastReadAt: new Date() } },
          { upsert: true }
        );
        io.to(`conv_${conversationId}`).emit("conversation_read", {
          conversationId,
          userId,
        });
        cb && cb(null, { ok: true });
      } catch (err) {
        console.error("mark_read", err);
        cb && cb({ error: "failed_mark_read" });
      }
    });

    // typing
    socket.on("typing", ({ conversationId, isTyping = true } = {}) => {
      if (!conversationId) return;
      socket
        .to(`conv_${conversationId}`)
        .emit("typing", { conversationId, userId, isTyping });
    });

    // set_mute, set_pin
    socket.on("set_mute", async ({ conversationId, value = true } = {}, cb) => {
      try {
        await ConversationParticipant.updateOne(
          { conversationId, userId },
          { $set: { isMuted: !!value } },
          { upsert: true }
        );
        cb && cb(null, { ok: true });
      } catch (err) {
        cb && cb({ error: "failed_set_mute" });
      }
    });

    socket.on("set_pin", async ({ conversationId, value = true } = {}, cb) => {
      try {
        await ConversationParticipant.updateOne(
          { conversationId, userId },
          { $set: { isPinned: !!value } },
          { upsert: true }
        );
        cb && cb(null, { ok: true });
      } catch (err) {
        cb && cb({ error: "failed_set_pin" });
      }
    });

    // add_participant / remove_participant
    socket.on(
      "add_participant",
      async ({ conversationId, userIdToAdd } = {}, cb) => {
        try {
          await ConversationParticipant.updateOne(
            { conversationId, userId: userIdToAdd },
            {
              $setOnInsert: {
                conversationId,
                userId: userIdToAdd,
                joinedAt: new Date(),
              },
            },
            { upsert: true }
          );
          io.to(`conv_${conversationId}`).emit("participant_added", {
            conversationId,
            userId: userIdToAdd,
          });
          cb && cb(null, { ok: true });
        } catch (err) {
          cb && cb({ error: "failed_add_participant" });
        }
      }
    );

    socket.on(
      "remove_participant",
      async ({ conversationId, userIdToRemove } = {}, cb) => {
        try {
          await ConversationParticipant.deleteOne({
            conversationId,
            userId: userIdToRemove,
          });
          io.to(`conv_${conversationId}`).emit("participant_removed", {
            conversationId,
            userId: userIdToRemove,
          });
          cb && cb(null, { ok: true });
        } catch (err) {
          cb && cb({ error: "failed_remove_participant" });
        }
      }
    );

    // edit_message
    socket.on("edit_message", async ({ messageId, newBody } = {}, cb) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return cb && cb({ error: "message_not_found" });
        if (msg.senderId.toString() !== userId)
          return cb && cb({ error: "forbidden" });

        msg.body = newBody;
        msg.editedAt = new Date();
        await msg.save();

        io.to(`conv_${msg.conversationId.toString()}`).emit("message_edited", {
          _id: msg._id,
          conversationId: msg.conversationId,
          body: msg.body,
          editedAt: msg.editedAt,
        });
        cb && cb(null, { ok: true });
      } catch (err) {
        console.error("edit_message", err);
        cb && cb({ error: "failed_edit_message" });
      }
    });

    // delete_message
    socket.on("delete_message", async ({ messageId } = {}, cb) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg) return cb && cb({ error: "message_not_found" });
        if (msg.senderId.toString() !== userId)
          return cb && cb({ error: "forbidden" });

        msg.deleted = true;
        await msg.save();
        io.to(`conv_${msg.conversationId.toString()}`).emit("message_deleted", {
          _id: msg._id,
          conversationId: msg.conversationId,
        });
        cb && cb(null, { ok: true });
      } catch (err) {
        console.error("delete_message", err);
        cb && cb({ error: "failed_delete_message" });
      }
    });

    socket.on("disconnect", (reason) => {
      // automatic cleanup by socket.io
    });
  });

  return io;
}

module.exports = { initSocket };
