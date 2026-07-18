import type {
  BeatMap,
  QualityReport,
  RenderProgress,
  Storyboard,
  StoryboardDraft,
} from '@ai-video-creation/scripts';

export interface ProjectSummary {
  id: string;
  name: string;
  subtitle?: string;
  durationSeconds: number;
  aspect: Storyboard['aspect'];
  sourceMode?: Storyboard['sourceMode'];
  shotCount: number;
  outputAvailable: boolean;
  qualityVerdict?: QualityReport['verdict'];
  warningCount: number;
  posterUrl?: string;
}

export interface SourceInfo {
  shotId: string;
  source: string;
  available: boolean;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  mediaUrl?: string;
  thumbnailUrl?: string;
}

export interface GradeOption {
  id: string;
  name: string;
  intent: string;
}

export interface ProjectDetail {
  summary: ProjectSummary;
  revision: string;
  storyboard: Storyboard;
  draft: StoryboardDraft;
  beatMap: BeatMap | null;
  quality: QualityReport | null;
  sources: SourceInfo[];
  grades: GradeOption[];
  finalMediaUrl?: string;
  musicMediaUrl?: string;
  waveformUrl?: string;
  musicDuration?: number;
}

export type JobKind = 'preview' | 'final';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'superseded';

export interface RenderJobResult {
  mediaUrl: string;
  revision?: string;
  beatMap?: BeatMap;
}

export interface RenderJob {
  id: string;
  projectId: string;
  kind: JobKind;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  progress?: RenderProgress;
  result?: RenderJobResult;
  error?: string;
}

export interface SaveDraftRequest {
  baseRevision: string;
  draft: StoryboardDraft;
}

export interface PreviewRequest {
  baseRevision: string;
  draft: StoryboardDraft;
}

export type MusicAnalysisRequest = PreviewRequest;

export interface MusicAnalysisResult {
  beatMap: BeatMap | null;
}

export interface FinalRenderRequest {
  revision: string;
}
