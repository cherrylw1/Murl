import { z } from 'zod';

export const ClickActionSchema = z.object({
  action: z.literal('click'),
  ref: z.number(),
  thought: z.string().optional(),
});

export const TypeActionSchema = z.object({
  action: z.literal('type'),
  ref: z.number(),
  text: z.string(),
  thought: z.string().optional(),
});

export const ScrollActionSchema = z.object({
  action: z.literal('scroll'),
  direction: z.enum(['up', 'down']),
  thought: z.string().optional(),
});

export const ExtractActionSchema = z.object({
  action: z.literal('extract'),
  data: z.unknown(),
  thought: z.string().optional(),
});

export const CompleteActionSchema = z.object({
  action: z.literal('complete'),
  result: z.unknown(),
  thought: z.string().optional(),
});

export const ActionSchema = z.discriminatedUnion('action', [
  ClickActionSchema,
  TypeActionSchema,
  ScrollActionSchema,
  ExtractActionSchema,
  CompleteActionSchema,
]);

export type Action = z.infer<typeof ActionSchema>;

export function parseAction(
  raw: unknown,
): { ok: true; action: Action } | { ok: false; error: string } {
  const result = ActionSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, action: result.data };
  } else {
    const errorMsg = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    return { ok: false, error: errorMsg };
  }
}
