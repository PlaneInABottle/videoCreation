import { z } from 'zod';

const transitionSchema = z
  .object({
    type: z.string().min(1),
    duration: z.number().finite().nonnegative(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const shotSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    source: z.string().min(1).max(4096),
    pexelsId: z.number().int().positive().optional(),
    query: z.string().max(500),
    sourceIn: z.number().finite().nonnegative(),
    duration: z.number().finite().min(0.5),
    storyFunction: z.string().trim().min(1).max(160),
    editorialIntent: z.string().trim().max(1000).optional(),
    anchorX: z.number().finite().min(0).max(1),
    anchorY: z.number().finite().min(0).max(1),
    transitionToNext: transitionSchema.nullable(),
  })
  .strict();

const titlePlanSchema = z
  .object({
    timelineIn: z.number().finite().nonnegative(),
    timelineOut: z.number().finite().positive(),
    anchorX: z.number().finite().min(0).max(1),
    anchorY: z.number().finite().min(0).max(1),
  })
  .strict();

const musicSchema = z
  .object({
    file: z.string().min(1).max(4096),
    start: z.number().finite().nonnegative(),
    beatMap: z.string().min(1).max(4096),
    featuredAt: z.number().finite().optional(),
    featuredSourceTime: z.number().finite().optional(),
    featuredRole: z.enum(['opening', 'payoff']).optional(),
    volumeStart: z.number().finite().min(0).max(1).optional(),
    volumeFullAt: z.number().finite().nonnegative().optional(),
  })
  .strict();

const audioPlanSchema = z
  .object({
    useSourceAudio: z.boolean().optional(),
    sourceVolume: z.number().finite().min(0).max(1).optional(),
    musicVolume: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

export const storyboardDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectId: z.string().trim().min(1).max(160),
    createdAt: z.string().datetime(),
    videoTypeId: z.string().trim().min(1).max(160),
    sourceMode: z
      .enum(['stock-montage', 'continuous-footage', 'single-session-multicam'])
      .optional(),
    aspect: z.enum(['9:16', '16:9']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive().finite(),
    gradeId: z.string().trim().min(1).max(160),
    title: z.string().max(300).optional(),
    subtitle: z.string().max(500).optional(),
    titlePlan: titlePlanSchema.optional(),
    music: musicSchema.optional(),
    voiceoverFile: z.string().min(1).max(4096).optional(),
    captionsFile: z.string().min(1).max(4096).optional(),
    audioPlan: audioPlanSchema.optional(),
    shots: z.array(shotSchema).min(1).max(500),
    output: z.string().min(1).max(4096),
  })
  .strict();

export const saveDraftRequestSchema = z
  .object({
    baseRevision: z.string().regex(/^[a-f0-9]{64}$/),
    draft: storyboardDraftSchema,
  })
  .strict();

export const previewRequestSchema = saveDraftRequestSchema;

export const finalRenderRequestSchema = z
  .object({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
