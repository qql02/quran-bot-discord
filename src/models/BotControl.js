import mongoose from 'mongoose';

// One document (key "global") with the owner's global controls. See utils/botControl.js for what each field does.
const schema = new mongoose.Schema({
  key:              { type: String, required: true, unique: true, index: true },
  disabledCommands: { type: [String], default: [] },
  disabledFeatures: { type: [String], default: [] },
  maxQueue:         { type: Number, default: null },
  hiddenReciters:   { type: [String], default: [] },     // reciter ids the owner removed from every search / menu (running sessions are not touched)
  locked:           { type: Boolean, default: false },
  lockedUntil:      { type: Date, default: null },
  secondBotPaused:  { type: Boolean, default: false },   // the owner switched the second bot (the process started from this project) OFF; it stays off after a restart
  note:             { type: String, default: '', maxlength: 200 },
  modCaps:          { type: Map, of: Boolean, default: {} },
  updatedBy:        { type: String, default: '', maxlength: 100 },
  updatedAt:        { type: Date, default: Date.now }
});

export const BotControl = mongoose.models.BotControl || mongoose.model('BotControl', schema);
