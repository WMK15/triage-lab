import { listLiveTasks } from "@/lib/triage/runtime";

export async function GET() {
  return Response.json({ tasks: listLiveTasks() });
}
