import { createServerFn } from "@tanstack/react-start";
import { connectDB } from "@/lib/mongodb/db";
import { SymptomReport } from "@/lib/mongodb/models/SymptomReport";
import { PrescriptionScan } from "@/lib/mongodb/models/PrescriptionScan";
import { PeriodRecord } from "@/lib/mongodb/models/PeriodRecord";
import { verifyToken } from "@/lib/auth";

function getUserId(token?: string): string {
  if (!token) throw new Error("Unauthorized: Missing token");
  const decoded = verifyToken(token);
  if (!decoded) throw new Error("Unauthorized: Invalid token");
  return decoded.userId;
}

// Symptom Reports
export const getSymptomReportsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const reports = await SymptomReport.find({ userId }).sort({ createdAt: -1 });
    return reports.map((r) => ({
      id: r._id.toString(),
      symptoms: r.symptoms,
      severity: r.severity,
      advice: r.advice,
      conversation: r.conversation,
      language: r.language,
      created_at: r.createdAt.toISOString(),
    }));
  });

export const saveSymptomReportFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      symptoms: string;
      severity: "emergency" | "moderate" | "mild";
      advice: string;
      conversation: any[];
      language?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const report = await SymptomReport.create({
      userId,
      symptoms: data.symptoms,
      severity: data.severity,
      advice: data.advice,
      conversation: data.conversation || [],
      language: data.language || "en",
    });
    return {
      id: report._id.toString(),
      success: true,
    };
  });

export const deleteSymptomReportFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    await SymptomReport.deleteOne({ _id: data.id, userId });
    return { success: true };
  });

// Prescription Scans
export const getPrescriptionScansFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const scans = await PrescriptionScan.find({ userId }).sort({ createdAt: -1 });
    return scans.map((s) => ({
      id: s._id.toString(),
      extracted_text: s.extractedText,
      simplified_explanation: s.simplifiedExplanation,
      language: s.language,
      created_at: s.createdAt.toISOString(),
    }));
  });

export const savePrescriptionScanFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      token: string;
      extractedText: string;
      simplifiedExplanation: string;
      language?: string;
    }) => data
  )
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const scan = await PrescriptionScan.create({
      userId,
      extractedText: data.extractedText,
      simplifiedExplanation: data.simplifiedExplanation,
      language: data.language || "en",
    });
    return {
      id: scan._id.toString(),
      success: true,
    };
  });

export const deletePrescriptionScanFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    await PrescriptionScan.deleteOne({ _id: data.id, userId });
    return { success: true };
  });

// Period Records
export const getPeriodRecordsFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const records = await PeriodRecord.find({ userId }).sort({ startDate: -1 });
    return records.map((p) => ({
      id: p._id.toString(),
      start_date: p.startDate,
      end_date: p.endDate,
      notes: p.notes,
      created_at: p.createdAt.toISOString(),
    }));
  });

export const savePeriodRecordFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; startDate: string; endDate: string; notes?: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    const record = await PeriodRecord.create({
      userId,
      startDate: data.startDate,
      endDate: data.endDate,
      notes: data.notes,
    });
    return {
      id: record._id.toString(),
      start_date: record.startDate,
      end_date: record.endDate,
      notes: record.notes,
    };
  });

export const deletePeriodRecordFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; id: string }) => data)
  .handler(async ({ data }) => {
    const userId = getUserId(data.token);
    await connectDB();
    await PeriodRecord.deleteOne({ _id: data.id, userId });
    return { success: true };
  });
