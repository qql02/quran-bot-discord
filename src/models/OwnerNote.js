import mongoose from 'mongoose';

// Private owner-only notes and tags per server (shown in the dashboard only — never sent to Discord).
const schema = new mongoose.Schema({
  guildId:   { type: String, required: true, unique: true, index: true },
  note:      { type: String, default: '', maxlength: 1000 },
  tags:      { type: [String], default: [] },
  updatedBy: { type: String, default: '', maxlength: 100 },
  updatedAt: { type: Date, default: Date.now },
});

export const OwnerNote = mongoose.models.OwnerNote || mongoose.model('OwnerNote', schema);
