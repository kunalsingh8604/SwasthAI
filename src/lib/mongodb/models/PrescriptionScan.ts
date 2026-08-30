import mongoose, { Schema, Document } from "mongoose";

export interface IPrescriptionScan extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  extractedText: string;
  simplifiedExplanation: string;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

const PrescriptionScanSchema = new Schema<IPrescriptionScan>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    extractedText: { type: String, required: true },
    simplifiedExplanation: { type: String, required: true },
    language: { type: String, default: "en" },
  },
  { timestamps: true }
);

export const PrescriptionScan =
  mongoose.models.PrescriptionScan || mongoose.model<IPrescriptionScan>("PrescriptionScan", PrescriptionScanSchema);
