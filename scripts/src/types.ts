export type AspectRatio = '9:16' | '16:9';
export type SourceMode = 'stock-montage' | 'continuous-footage' | 'single-session-multicam';

export interface SourceQuery {
  query: string;
  count?: number;
  videoIds?: number[];
  orientation?: 'portrait' | 'landscape';
  sourceIn?: number;
  storyFunction?: string;
  anchorX?: number;
  anchorY?: number;
}

export interface ProjectConfig {
  id: string;
  type: string;
  length: number;
  aspect: AspectRatio;
  queries: SourceQuery[];
  gradeId: string;
  sourceMode?: SourceMode;
  editStyle?: string;
  cutTimes?: number[];
  transitionAccents?: Array<{ time: number; type: string; duration: number }>;
  musicFile?: string;
  musicQuery?: string;
  musicStart?: number;
  musicHookTime?: number;
  musicHookRole?: 'opening' | 'payoff';
  musicVolumeStart?: number;
  musicVolumeFullAt?: number;
  voiceoverFile?: string;
  title?: string;
  subtitle?: string;
  output?: string;
}

export interface TransitionPlan {
  type: string;
  duration: number;
  reason?: string;
}

export interface StoryboardShot {
  id: string;
  source: string;
  pexelsId?: number;
  query: string;
  sourceIn: number;
  sourceDuration: number;
  timelineIn: number;
  timelineOut: number;
  storyFunction: string;
  editorialIntent?: string;
  anchorX: number;
  anchorY: number;
  transitionToNext: TransitionPlan | null;
}

export interface TitlePlan {
  timelineIn: number;
  timelineOut: number;
  anchorX: number;
  anchorY: number;
}

export type MusicMomentKind = 'impact' | 'lift' | 'peak' | 'release';

export interface MusicMoment {
  time: number;
  kind: MusicMomentKind;
  strength: number;
}

export type MusicSectionLabel = 'calm' | 'steady' | 'build' | 'peak' | 'release';

export interface MusicSection {
  start: number;
  end: number;
  label: MusicSectionLabel;
  energy: number;
}

export interface BeatMap {
  schemaVersion: 1;
  source: string;
  sourceHash: string;
  excerpt: { start: number; end: number };
  analyzer: { name: string; version: number; sampleRate: number };
  bpm: number;
  confidence: number;
  beats: number[];
  onsets: number[];
  energy: Array<{ time: number; value: number }>;
  majorMoments?: MusicMoment[];
  sections?: MusicSection[];
  fallback: boolean;
}

export interface Storyboard {
  schemaVersion: 1;
  projectId: string;
  createdAt: string;
  videoTypeId: string;
  sourceMode?: SourceMode;
  aspect: AspectRatio;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  gradeId: string;
  title?: string;
  subtitle?: string;
  titlePlan?: TitlePlan;
  music?: {
    file: string;
    start: number;
    beatMap: string;
    featuredAt?: number;
    featuredSourceTime?: number;
    featuredRole?: 'opening' | 'payoff';
    volumeStart?: number;
    volumeFullAt?: number;
  };
  voiceoverFile?: string;
  captionsFile?: string;
  audioPlan?: {
    useSourceAudio?: boolean;
    sourceVolume?: number;
    musicVolume?: number;
  };
  shots: StoryboardShot[];
  output: string;
}

export type StoryboardDraftShot = Omit<
  StoryboardShot,
  'sourceDuration' | 'timelineIn' | 'timelineOut'
> & {
  duration: number;
};

export type StoryboardDraft = Omit<Storyboard, 'durationSeconds' | 'shots'> & {
  shots: StoryboardDraftShot[];
};

export type RenderProfileName = 'final' | 'proxy';

export type RenderPhase = 'segments' | 'compose' | 'audio' | 'verify' | 'complete';

export interface RenderProgress {
  phase: RenderPhase;
  completed?: number;
  total?: number;
}

export interface RenderStoryboardOptions {
  profile?: RenderProfileName;
  output?: string;
  onProgress?: (progress: RenderProgress) => void;
}

export interface ProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<Record<string, unknown>>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: {
    filename: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    format_name?: string;
  };
}

export interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  link: string;
}

export interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
  video_pictures: Array<{ id: number; picture: string; nr: number }>;
}

export interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  url: string;
  videos: PexelsVideo[];
}

export interface DownloadedVideo {
  path: string;
  sidecarPath: string;
  video: PexelsVideo;
  file: PexelsVideoFile;
  query: string;
}
