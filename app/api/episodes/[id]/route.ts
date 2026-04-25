import { getEpisodeData } from "@/lib/triage/runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const episode = getEpisodeData(id);

  if (!episode) {
    return Response.json({ error: "episode not found" }, { status: 404 });
  }

  return Response.json(episode);
}
