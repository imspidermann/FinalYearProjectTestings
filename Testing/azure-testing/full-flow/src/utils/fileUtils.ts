import fs from "fs";
import path from "path";

export function appendTranscriptionRecord(filePath: string, record: any) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let arr: any[] = [];
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf8");
      arr = existing ? JSON.parse(existing) : [];
    } catch {
      arr = [];
    }
  }
  arr.push(record);
  try {
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to append transcription record:", err);
  }
}
