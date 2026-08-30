import mongoose, { Schema, Document } from "mongoose";

export interface ISymptomReport extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  symptoms: string;
  severity: "emergency" | "moderate" | "mild";
  advice: string;
  conversation: Array<{ role: string; content: string }>;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema(
  {
    role: { type: String, required: true },
    content: { type: String, required: true },
  },
  { _id: false }
);

const SymptomReportSchema = new Schema<ISymptomReport>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    symptoms: { type: String, required: true },
    severity: { type: String, enum: ["emergency", "moderate", "mild"], required: true },
    advice: { type: String, required: true },
    conversation: { type: [MessageSchema], default: [] },
    language: { type: String, default: "en" },
  },
  { timestamps: true }
);

export const SymptomReport =
  mongoose.models.SymptomReport || mongoose.model<ISymptomReport>("SymptomReport", SymptomReportSchema);
