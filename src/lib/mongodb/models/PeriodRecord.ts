import mongoose, { Schema, Document } from "mongoose";

export interface IPeriodRecord extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  startDate: string;
  endDate: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PeriodRecordSchema = new Schema<IPeriodRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    notes: { type: String },
  },
  { timestamps: true }
);

export const PeriodRecord =
  mongoose.models.PeriodRecord || mongoose.model<IPeriodRecord>("PeriodRecord", PeriodRecordSchema);
