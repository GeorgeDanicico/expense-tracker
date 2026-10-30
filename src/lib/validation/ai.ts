import { z } from "zod";

/** The body of `PATCH /api/account/ai`. */
export const aiSwitchSchema = z.object({
  enabled: z.boolean("Say whether AI may read your statements."),
});
